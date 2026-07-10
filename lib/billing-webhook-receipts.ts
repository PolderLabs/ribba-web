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
// Zie docs: herzien architectuurontwerp v2 (billing fase 2, webhook-idempotentie).

import { createClient } from '@supabase/supabase-js';

const PROVIDER = 'mollie';
export const SETUP_EVENT_KIND = 'setup_payment_paid';

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
 * Atomaire claim voor een setup-payment webhook. Aanroepen VÓÓR elke side-effect.
 * Throwt bij DB-fouten — de caller moet dan 500 retourneren.
 */
export async function claimSetupWebhook(params: {
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
        event_kind: SETUP_EVENT_KIND,
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
  const existing = await fetchReceipt(params.paymentId);

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
    .eq('event_kind', SETUP_EVENT_KIND)
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
  const after = await fetchReceipt(params.paymentId);
  if (after.status === 'succeeded' || after.status === 'discarded') {
    await bumpAttempt(after);
    return { outcome: 'already_terminal', receipt: after };
  }
  return { outcome: 'in_flight' };
}

/** Stage vooruitzetten; optioneel result_subscription_id vastleggen. Throwt bij fout. */
export async function advanceReceiptStage(
  receiptId: string,
  stage: SideEffectStage,
  resultSubscriptionId?: string,
): Promise<void> {
  const update: Record<string, unknown> = { side_effect_stage: stage };
  if (resultSubscriptionId !== undefined) {
    update.result_subscription_id = resultSubscriptionId;
  }
  const { error } = await getSupabase()
    .from('billing_webhook_receipts')
    .update(update)
    .eq('id', receiptId);
  if (error) {
    throw new Error(`receipt stage advance (${stage}) failed: ${error.message}`);
  }
}

/** Terminaal succes: status succeeded + stage completed. Throwt bij fout. */
export async function markReceiptSucceeded(receiptId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('billing_webhook_receipts')
    .update({ status: 'succeeded', side_effect_stage: 'completed' })
    .eq('id', receiptId);
  if (error) {
    throw new Error(`receipt mark succeeded failed: ${error.message}`);
  }
}

/**
 * Retriable failure: status failed, stage blijft staan (recovery weet dan waar
 * de run strandde). NIET throwing — wordt aangeroepen vanuit catch-paden waar een
 * tweede throw de foutafhandeling zou verstoren; als deze write faalt, wordt de
 * receipt vanzelf stale-processing en pakt de herclaim 'm later op.
 */
export async function markReceiptFailed(receiptId: string, error: string): Promise<void> {
  try {
    const { error: dbError } = await getSupabase()
      .from('billing_webhook_receipts')
      .update({ status: 'failed', last_error: error.slice(0, 500) })
      .eq('id', receiptId);
    if (dbError) {
      console.error('receipt mark failed write error:', dbError.message);
    }
  } catch (e) {
    console.error('receipt mark failed unexpected error:', e);
  }
}

/** Terminaal genegeerd (stale/foreign payment): status discarded, stage blijft. Throwt. */
export async function markReceiptDiscarded(receiptId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('billing_webhook_receipts')
    .update({ status: 'discarded' })
    .eq('id', receiptId);
  if (error) {
    throw new Error(`receipt mark discarded failed: ${error.message}`);
  }
}

async function fetchReceipt(paymentId: string): Promise<WebhookReceipt> {
  const { data, error } = await getSupabase()
    .from('billing_webhook_receipts')
    .select('*')
    .eq('provider', PROVIDER)
    .eq('event_kind', SETUP_EVENT_KIND)
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
