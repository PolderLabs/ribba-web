// billing-webhook-receipts.ts — canonieke idempotentie-laag voor Mollie-webhooks.
//
// FUNDAMENTEEL ANDERS dan lib/billing-events.ts:
//   - billing_events      = observability. Non-throwing. Mag falen zonder de flow te raken.
//   - billing_webhook_receipts = correctness. THROWING. Als een claim niet gezet kan
//     worden, MOET de webhook falen (500) — zonder claim mag er geen side-effect gebeuren.
//
// De tabel draagt een unique constraint op (provider, event_kind, external_event_id).
// De insert-claim (upsert met ignoreDuplicates) is daardoor atomair: bij twee
// gelijktijdige deliveries van dezelfde payment wint er exact één.
//
// Status-as:  processing → succeeded | failed | discarded  (terminaal: succeeded/discarded)
// Stage-as:   claimed → subscription_created → license_updated → completed
// De twee assen bewegen onafhankelijk: recovery van een failed/stale receipt wordt
// gestuurd door side_effect_stage, zodat een receipt met stage >= subscription_created
// NOOIT een tweede customerSubscriptions.create kan triggeren.
//
// Stage-gebruik per event_kind (Fase 1 Billing Engine):
//   setup_payment_paid       claimed → subscription_created → license_updated → completed
//   recurring_payment_paid   claimed → license_updated → completed (beschermt de
//                            period_end-write; de geschreven waarde is bovendien
//                            deterministisch afgeleid van first_received_at)
//   recurring_payment_failed claimed → license_updated → completed (beschermt de
//                            failed_payment_count-increment tegen dubbele telling)
//
// first_received_at is IMMUTABEL over herclaims heen (alleen last_received_at,
// processing_started_at en attempt_count muteren bij een herclaim). Daardoor is
// het bruikbaar als deterministisch anker per extern event: elke run van
// hetzelfde Payment ID leidt dezelfde marker-/periodewaarde af.
//
// Zie docs: herzien architectuurontwerp v2 (billing fase 2, webhook-idempotentie).

import { createClient } from '@supabase/supabase-js';

const PROVIDER = 'mollie';
export const SETUP_EVENT_KIND = 'setup_payment_paid';
// Fase 1 Billing Engine: recurring-webhooks krijgen dezelfde claim-bescherming.
// external_event_id blijft altijd het originele Mollie Payment ID.
export const RECURRING_PAID_EVENT_KIND = 'recurring_payment_paid';
export const RECURRING_FAILED_EVENT_KIND = 'recurring_payment_failed';

export type WebhookEventKind =
  | typeof SETUP_EVENT_KIND
  | typeof RECURRING_PAID_EVENT_KIND
  | typeof RECURRING_FAILED_EVENT_KIND;

// Een processing-receipt ouder dan dit is vermoedelijk een gecrashte run en mag
// door een volgende delivery worden overgenomen (herclaim + recovery-pad).
const STALE_PROCESSING_MINUTES = 10;

export type ReceiptStatus = 'processing' | 'succeeded' | 'failed' | 'discarded';
export type SideEffectStage = 'claimed' | 'subscription_created' | 'license_updated' | 'completed';

export interface WebhookReceipt {
  id: string;
  provider: string;
  event_kind: string;
  external_event_id: string;
  school_id: string;
  status: ReceiptStatus;
  side_effect_stage: SideEffectStage;
  result_subscription_id: string | null;
  attempt_count: number;
  first_received_at: string;
  last_received_at: string;
  processing_started_at: string;
  payload_fingerprint: string | null;
  last_error: string | null;
}

export type ClaimResult =
  // Verse claim gewonnen — normale eerste verwerking.
  | { outcome: 'claimed'; receipt: WebhookReceipt; recovered: false }
  // Herclaim gewonnen van een failed of stale-processing receipt — recovery-pad
  // volgen op basis van receipt.side_effect_stage.
  | { outcome: 'reclaimed'; receipt: WebhookReceipt; recovered: true }
  // Receipt is terminaal (succeeded/discarded) — no-op, webhook hoort 200 te geven.
  | { outcome: 'already_terminal'; receipt: WebhookReceipt }
  // Een andere run is (vermoedelijk) nog bezig — webhook hoort 500 te geven zodat
  // Mollie later retryt; tegen die tijd is de andere run klaar of stale.
  | { outcome: 'in_flight' };

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function staleCutoffIso(): string {
  return new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000).toISOString();
}

/**
 * Atomaire claim voor een billing-webhook-event. Aanroepen VÓÓR elke
 * side-effect. Throwt bij DB-fouten — de caller moet dan 500 retourneren.
 * Zelfde semantiek voor alle event-kinds; de unique constraint
 * (provider, event_kind, external_event_id) maakt de claim atomair.
 */
export async function claimWebhookEvent(params: {
  eventKind: WebhookEventKind;
  paymentId: string;
  schoolId: string;
  fingerprint: string;
}): Promise<ClaimResult> {
  const supabase = getSupabase();

  // Stap 1 — insert-claim. ignoreDuplicates=true vertaalt naar
  // INSERT ... ON CONFLICT DO NOTHING; .select() werkt als RETURNING.
  // Rij terug = claim gewonnen. Lege set = er bestaat al een receipt.
  const { data: inserted, error: insertError } = await supabase
    .from('billing_webhook_receipts')
    .upsert(
      {
        provider: PROVIDER,
        event_kind: params.eventKind,
        external_event_id: params.paymentId,
        school_id: params.schoolId,
        status: 'processing',
        side_effect_stage: 'claimed',
        payload_fingerprint: params.fingerprint,
      },
      { onConflict: 'provider,event_kind,external_event_id', ignoreDuplicates: true },
    )
    .select();

  if (insertError) {
    throw new Error(`receipt claim insert failed: ${insertError.message}`);
  }
  if (inserted && inserted.length > 0) {
    return { outcome: 'claimed', receipt: inserted[0] as WebhookReceipt, recovered: false };
  }

  // Stap 2 — bestaande receipt lezen en per status handelen.
  const existing = await fetchReceipt(params.eventKind, params.paymentId);

  if (existing.status === 'succeeded' || existing.status === 'discarded') {
    await bumpAttempt(existing);
    return { outcome: 'already_terminal', receipt: existing };
  }

  // failed, of processing: herclaim proberen. De conditionele UPDATE laat exact
  // één gelijktijdige herclaimer winnen; verliezers krijgen een lege result-set.
  const nowIso = new Date().toISOString();
  const { data: reclaimed, error: reclaimError } = await supabase
    .from('billing_webhook_receipts')
    .update({
      status: 'processing',
      processing_started_at: nowIso,
      last_received_at: nowIso,
      attempt_count: existing.attempt_count + 1,
    })
    .eq('provider', PROVIDER)
    .eq('event_kind', params.eventKind)
    .eq('external_event_id', params.paymentId)
    .or(`status.eq.failed,and(status.eq.processing,processing_started_at.lt.${staleCutoffIso()})`)
    .select();

  if (reclaimError) {
    throw new Error(`receipt reclaim failed: ${reclaimError.message}`);
  }
  if (reclaimed && reclaimed.length > 0) {
    return { outcome: 'reclaimed', receipt: reclaimed[0] as WebhookReceipt, recovered: true };
  }

  // Herclaim verloren: óf een concurrent won 'm net, óf de receipt is jong-processing.
  // Nog één keer lezen voor het geval de concurrent inmiddels terminaal is.
  const after = await fetchReceipt(params.eventKind, params.paymentId);
  if (after.status === 'succeeded' || after.status === 'discarded') {
    await bumpAttempt(after);
    return { outcome: 'already_terminal', receipt: after };
  }
  return { outcome: 'in_flight' };
}

/**
 * Atomaire claim voor een setup-payment webhook. Aanroepen VÓÓR elke side-effect.
 * Throwt bij DB-fouten — de caller moet dan 500 retourneren.
 */
export async function claimSetupWebhook(params: {
  paymentId: string;
  schoolId: string;
  fingerprint: string;
}): Promise<ClaimResult> {
  return claimWebhookEvent({ eventKind: SETUP_EVENT_KIND, ...params });
}

// ── Fencing ────────────────────────────────────────────────────────────────
// Alle mutaties na de claim zijn geconditioneerd op:
//   status = 'processing'  EN  processing_started_at = <claim-token>
// Het claim-token is receipt.processing_started_at zoals de gewonnen claim
// 'm heeft gezet (insert: DB now(); herclaim: onze nowIso). Een zombie-run
// (traag geworden, waarna een ander de receipt bij staleness heeft
// overgenomen) heeft een verouderd token, raakt 0 rijen en krijgt een throw
// — hij kan de voortgang van de overnemende run dus nooit overschrijven.
// Terminale receipts (succeeded/discarded) zijn hierdoor ook onmuteerbaar
// via deze functies: status is dan niet meer 'processing'.

// Toegestane voorgaande stage per doel-stage — dwingt de volgorde
// claimed → subscription_created → license_updated af.
const STAGE_PRECONDITION: Record<'subscription_created' | 'license_updated', SideEffectStage> = {
  subscription_created: 'claimed',
  license_updated: 'subscription_created',
};

/**
 * Stage vooruitzetten; optioneel result_subscription_id in dezelfde update.
 * Conditioneel op ownership (claim-token) + de verwachte huidige stage.
 * Throwt bij DB-fout én bij 0 geraakte rijen (ownership verloren of
 * onverwachte staat) — de caller hoort dan te stoppen met side-effects.
 */
export async function advanceReceiptStage(
  receiptId: string,
  claimToken: string,
  stage: 'subscription_created' | 'license_updated',
  resultSubscriptionId?: string,
): Promise<void> {
  const update: Record<string, unknown> = { side_effect_stage: stage };
  if (resultSubscriptionId !== undefined) {
    update.result_subscription_id = resultSubscriptionId;
  }
  const { data, error } = await getSupabase()
    .from('billing_webhook_receipts')
    .update(update)
    .eq('id', receiptId)
    .eq('status', 'processing')
    .eq('processing_started_at', claimToken)
    .eq('side_effect_stage', STAGE_PRECONDITION[stage])
    .select();
  if (error) {
    throw new Error(`receipt stage advance (${stage}) failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`receipt stage advance (${stage}): ownership lost or unexpected state`);
  }
}

/**
 * Recurring-pad (paid én failed): claimed → license_updated in één gefencede
 * update. Beschermt de license-write van het pad: een herclaim die deze stage
 * aantreft, weet dat de write al is toegepast en voert hem nooit opnieuw uit
 * (failed: teller-increment; paid: period_end/teller-reset).
 * result_subscription_id is verplicht — de DB-constraint
 * (result_required_check) eist een resultaat vanaf deze stage.
 * Throwt bij DB-fout én bij 0 geraakte rijen.
 */
export async function advanceReceiptClaimedToLicenseUpdated(
  receiptId: string,
  claimToken: string,
  resultSubscriptionId: string,
): Promise<void> {
  const { data, error } = await getSupabase()
    .from('billing_webhook_receipts')
    .update({
      side_effect_stage: 'license_updated',
      result_subscription_id: resultSubscriptionId,
    })
    .eq('id', receiptId)
    .eq('status', 'processing')
    .eq('processing_started_at', claimToken)
    .eq('side_effect_stage', 'claimed')
    .select();
  if (error) {
    throw new Error(`receipt stage advance (claimed→license_updated) failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error('receipt stage advance (claimed→license_updated): ownership lost or unexpected state');
  }
}

/**
 * Terminaal succes: status succeeded + stage completed, in één update.
 * Conditioneel op ownership + stage license_updated. Throwt bij fout of 0 rijen.
 */
export async function markReceiptSucceeded(receiptId: string, claimToken: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from('billing_webhook_receipts')
    .update({ status: 'succeeded', side_effect_stage: 'completed' })
    .eq('id', receiptId)
    .eq('status', 'processing')
    .eq('processing_started_at', claimToken)
    .eq('side_effect_stage', 'license_updated')
    .select();
  if (error) {
    throw new Error(`receipt mark succeeded failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error('receipt mark succeeded: ownership lost or unexpected state');
  }
}

/**
 * Retriable failure: status failed, stage blijft staan (recovery weet dan waar
 * de run strandde).
 *
 * BEWUST non-throwing, als enige mutatie-functie. Contract:
 *   - mag UITSLUITEND vanuit catch-paden worden aangeroepen, nadat de primaire
 *     fout al vaststaat en de caller al besloten heeft 500 te retourneren;
 *   - de 500-beslissing hangt af van de primaire fout, nooit van deze write —
 *     een mislukte failed-markering kan de 200/500-keuze dus niet beïnvloeden;
 *   - faalt de write, dan blijft de receipt processing en wordt hij na de
 *     staleness-drempel vanzelf herclaimbaar (zelfde herstel, iets later).
 * Wel gefenced op het claim-token: een zombie-run kan een receipt die
 * inmiddels door een ander is overgenomen (of terminaal is) niet op failed
 * zetten.
 */
export async function markReceiptFailed(
  receiptId: string,
  claimToken: string,
  error: string,
): Promise<void> {
  try {
    const { data, error: dbError } = await getSupabase()
      .from('billing_webhook_receipts')
      .update({ status: 'failed', last_error: error.slice(0, 500) })
      .eq('id', receiptId)
      .eq('status', 'processing')
      .eq('processing_started_at', claimToken)
      .select();
    if (dbError) {
      console.error('receipt mark failed write error:', dbError.message);
    } else if (!data || data.length === 0) {
      console.warn('receipt mark failed: ownership lost — receipt ongemoeid gelaten');
    }
  } catch (e) {
    console.error('receipt mark failed unexpected error:', e);
  }
}

/**
 * Terminaal genegeerd (stale/foreign payment): status discarded, stage blijft.
 * Alleen geldig vanuit stage 'claimed' (vóór enige side-effect), conditioneel
 * op ownership. Throwt bij fout of 0 rijen.
 */
export async function markReceiptDiscarded(receiptId: string, claimToken: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from('billing_webhook_receipts')
    .update({ status: 'discarded' })
    .eq('id', receiptId)
    .eq('status', 'processing')
    .eq('processing_started_at', claimToken)
    .eq('side_effect_stage', 'claimed')
    .select();
  if (error) {
    throw new Error(`receipt mark discarded failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error('receipt mark discarded: ownership lost or unexpected state');
  }
}

async function fetchReceipt(eventKind: WebhookEventKind, paymentId: string): Promise<WebhookReceipt> {
  const { data, error } = await getSupabase()
    .from('billing_webhook_receipts')
    .select('*')
    .eq('provider', PROVIDER)
    .eq('event_kind', eventKind)
    .eq('external_event_id', paymentId)
    .single();
  if (error || !data) {
    throw new Error(`receipt fetch failed: ${error?.message ?? 'not found'}`);
  }
  return data as WebhookReceipt;
}

// Audit-teller op terminale hits. Cosmetisch (attempt_count kan bij extreme
// gelijktijdigheid één tellen missen) — bewust geen rpc/lock, correctness hangt
// hier niet van af.
async function bumpAttempt(receipt: WebhookReceipt): Promise<void> {
  const { error } = await getSupabase()
    .from('billing_webhook_receipts')
    .update({
      last_received_at: new Date().toISOString(),
      attempt_count: receipt.attempt_count + 1,
    })
    .eq('id', receipt.id);
  if (error) {
    // Niet fataal voor de no-op-flow; alleen loggen.
    console.error('receipt attempt bump failed:', error.message);
  }
}
