// POST /api/stripe-webhook — Stripe-events voor het referral-programma.
//
// Idempotentie in twee lagen:
//   1. stripe_webhook_events: insert-claim op event.id (dedupe van dubbele
//      deliveries). Faalt de verwerking, dan geven we de claim weer vrij en
//      retourneren 500, zodat de Stripe-retry het event opnieuw verwerkt.
//   2. de gefencede payout-statusmachine: elke mutatie is een conditionele
//      UPDATE op de verwachte huidige status — de échte side-effect-guard.
//      Transfers dragen bovendien een idempotency-key per payout, dus ook een
//      herverwerking na een crash kan nooit dubbel uitbetalen.
//
// SEPA-incasso's zijn asynchroon: payment_intent.succeeded komt dagen na de
// cron-run die de charge startte (payout wacht dan in 'charging').

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe';
import { syncPartnerAccountState } from '@/lib/referral-stripe';
import { logBillingEvent } from '@/lib/billing-events';
import {
  sendPartnerPayoutPaidMail,
  sendSchoolChargeFailedMail,
  sendTeamReferralAlertMail,
} from '@/lib/referral-emails';
import type { ReferralPayoutRow } from '@/lib/referral-types';

export const dynamic = 'force-dynamic';

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(req: NextRequest) {
  // Twee endpoints delen deze route: het platform-endpoint (setup_intent.*,
  // payment_intent.*, charge.*) en het Connect-endpoint (account.updated van
  // Express-partners). Elk Stripe-endpoint heeft zijn eigen signing secret,
  // dus we verifiëren tegen beide.
  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_WEBHOOK_SECRET_CONNECT,
  ].filter((s): s is string => Boolean(s));
  if (secrets.length === 0) {
    console.error('stripe-webhook: STRIPE_WEBHOOK_SECRET niet gezet');
    return NextResponse.json({ error: 'Niet geconfigureerd.' }, { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  const rawBody = await req.text();

  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = getStripe().webhooks.constructEvent(rawBody, signature ?? '', secret);
      break;
    } catch {
      // volgende secret proberen
    }
  }
  if (!event) {
    console.error('stripe-webhook: signature-verificatie mislukt voor alle secrets');
    return NextResponse.json({ error: 'Ongeldige signature.' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Laag 1: dedupe-claim. Rij terug = claim gewonnen; leeg = al verwerkt.
  const { data: claimed, error: claimError } = await supabase
    .from('stripe_webhook_events')
    .upsert(
      { event_id: event.id, type: event.type },
      { onConflict: 'event_id', ignoreDuplicates: true },
    )
    .select('event_id');
  if (claimError) {
    console.error('stripe-webhook: claim mislukt', claimError.message);
    return NextResponse.json({ error: 'Claim mislukt.' }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'setup_intent.succeeded':
        await handleSetupSucceeded(supabase, event.data.object);
        break;
      case 'setup_intent.setup_failed':
        await handleSetupFailed(supabase, event.data.object);
        break;
      case 'payment_intent.succeeded':
        await handleChargeSucceeded(supabase, event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await handleChargeFailed(supabase, event.data.object);
        break;
      case 'account.updated':
        await handleAccountUpdated(supabase, event.data.object);
        break;
      case 'charge.dispute.created':
        await handleDispute(supabase, event.data.object.payment_intent, 'dispute');
        break;
      case 'charge.refunded':
        await handleDispute(supabase, event.data.object.payment_intent, 'refund');
        break;
      default:
        // Niet-geabonneerde events negeren we bewust met een 200.
        break;
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error(`stripe-webhook: verwerking ${event.type} mislukt`, e);
    // Claim vrijgeven zodat de Stripe-retry het event opnieuw kan verwerken.
    // De gefencede payout-transities maken herverwerking veilig.
    await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
    return NextResponse.json({ error: 'Verwerking mislukt.' }, { status: 500 });
  }
}

async function handleSetupSucceeded(supabase: SupabaseClient, si: Stripe.SetupIntent) {
  const programId = si.metadata?.referral_program_id;
  if (!programId) return;
  const paymentMethodId = typeof si.payment_method === 'string'
    ? si.payment_method
    : si.payment_method?.id ?? null;

  const { error } = await supabase
    .from('referral_programs')
    .update({
      stripe_payment_method_id: paymentMethodId,
      sepa_mandate_status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', programId);
  if (error) throw new Error(`mandaat activeren mislukt: ${error.message}`);

  await logBillingEvent({
    school_id: si.metadata?.drivingschool_id ?? '',
    event_type: 'referral_sepa_mandate_active',
    source: 'stripe-webhook',
    payload: { program_id: programId, setup_intent_id: si.id },
  });
}

async function handleSetupFailed(supabase: SupabaseClient, si: Stripe.SetupIntent) {
  const programId = si.metadata?.referral_program_id;
  if (!programId) return;
  // Een eerder actief mandaat niet overschrijven door een mislukte her-setup.
  const { error } = await supabase
    .from('referral_programs')
    .update({ sepa_mandate_status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', programId)
    .neq('sepa_mandate_status', 'active');
  if (error) throw new Error(`mandaat-failed markeren mislukt: ${error.message}`);
}

// Incasso geslaagd → charged → transfer naar de partner → paid.
// Recovery-pad: is de payout al 'charged' (eerdere run crashte ná de
// statusflip maar vóór/tijdens de transfer), dan proberen we de transfer
// opnieuw — de idempotency-key voorkomt een dubbele uitbetaling.
async function handleChargeSucceeded(supabase: SupabaseClient, pi: Stripe.PaymentIntent) {
  const payoutId = pi.metadata?.payout_id;
  if (!payoutId) return; // niet van het referral-programma

  const { data: flipped, error: flipError } = await supabase
    .from('referral_payouts')
    .update({ status: 'charged', charged_at: new Date().toISOString() })
    .eq('id', payoutId)
    .eq('status', 'charging')
    .select('*');
  if (flipError) throw new Error(`charging→charged mislukt: ${flipError.message}`);

  let payout = (flipped?.[0] ?? null) as ReferralPayoutRow | null;
  if (!payout) {
    const { data: current } = await supabase
      .from('referral_payouts')
      .select('*')
      .eq('id', payoutId)
      .maybeSingle();
    if (!current || current.status !== 'charged') return; // al paid of niet van ons
    payout = current as ReferralPayoutRow;
  }
  if (payout.amount_cents == null) return; // cash-payouts hebben altijd een bedrag

  const { data: partner } = await supabase
    .from('referral_partners')
    .select('id, email, stripe_account_id')
    .eq('id', payout.partner_id)
    .single();
  if (!partner?.stripe_account_id) {
    throw new Error(`payout ${payoutId}: partner zonder stripe_account_id`);
  }

  const latestCharge = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
  const transfer = await getStripe().transfers.create(
    {
      amount: payout.amount_cents,
      currency: payout.currency,
      destination: partner.stripe_account_id,
      transfer_group: `payout_${payoutId}`,
      // Bind de transfer aan de gesettelde charge: geen afhankelijkheid van
      // het vrije platformsaldo, en de Ribba-fee blijft als marge achter.
      ...(latestCharge ? { source_transaction: latestCharge } : {}),
      metadata: { payout_id: payoutId },
    },
    { idempotencyKey: `referral-payout-transfer-${payoutId}` },
  );

  const { data: paidRows, error: paidError } = await supabase
    .from('referral_payouts')
    .update({
      status: 'paid',
      stripe_transfer_id: transfer.id,
      paid_at: new Date().toISOString(),
    })
    .eq('id', payoutId)
    .eq('status', 'charged')
    .select('id');
  if (paidError) throw new Error(`charged→paid mislukt: ${paidError.message}`);
  // 0 rijen = een concurrent run won de flip (transfer was idempotent) —
  // dan ook geen tweede partnermail.
  if (!paidRows || paidRows.length === 0) return;

  await logBillingEvent({
    school_id: payout.drivingschool_id,
    event_type: 'referral_payout_paid',
    source: 'stripe-webhook',
    payload: { payout_id: payoutId, transfer_id: transfer.id, amount_cents: payout.amount_cents },
  });

  const { data: school } = await supabase
    .from('drivingschools')
    .select('name')
    .eq('id', payout.drivingschool_id)
    .single();
  await sendPartnerPayoutPaidMail({
    schoolId: payout.drivingschool_id,
    partnerEmail: partner.email,
    schoolName: school?.name ?? 'je rijschool',
    amountCents: payout.amount_cents,
  });
}

async function handleChargeFailed(supabase: SupabaseClient, pi: Stripe.PaymentIntent) {
  const payoutId = pi.metadata?.payout_id;
  if (!payoutId) return;

  const reason = pi.last_payment_error?.message ?? 'incasso mislukt';
  const { data: flipped, error } = await supabase
    .from('referral_payouts')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_reason: reason.slice(0, 500),
    })
    .eq('id', payoutId)
    .eq('status', 'charging')
    .select('*');
  if (error) throw new Error(`charging→failed mislukt: ${error.message}`);
  const payout = (flipped?.[0] ?? null) as ReferralPayoutRow | null;
  if (!payout) return; // al afgehandeld

  await logBillingEvent({
    school_id: payout.drivingschool_id,
    event_type: 'referral_charge_failed',
    source: 'stripe-webhook',
    payload: { payout_id: payoutId, reason: reason.slice(0, 500) },
  });

  const { data: school } = await supabase
    .from('drivingschools')
    .select('name, email')
    .eq('id', payout.drivingschool_id)
    .single();
  if (school?.email && payout.amount_cents != null) {
    await sendSchoolChargeFailedMail({
      schoolId: payout.drivingschool_id,
      schoolEmail: school.email,
      schoolName: school.name,
      totalCents: payout.amount_cents + payout.ribba_fee_cents,
      reason,
    });
  }
}

async function handleAccountUpdated(supabase: SupabaseClient, account: Stripe.Account) {
  const { data: partner } = await supabase
    .from('referral_partners')
    .select('id')
    .eq('stripe_account_id', account.id)
    .maybeSingle();
  if (!partner) return;
  await syncPartnerAccountState(supabase, partner.id, account);
}

// Dispute/refund op een referral-incasso: alleen signaleren (ops-alert +
// audit). Terugdraaien van de transfer is in v1 een handmatige ops-actie —
// de payout-status blijft staan zodat het grootboek de werkelijkheid van de
// uitbetaling blijft beschrijven.
async function handleDispute(
  supabase: SupabaseClient,
  paymentIntent: string | Stripe.PaymentIntent | null,
  kind: 'dispute' | 'refund',
) {
  const piId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id;
  if (!piId) return;

  const { data: payout } = await supabase
    .from('referral_payouts')
    .select('id, drivingschool_id, amount_cents, ribba_fee_cents, status, stripe_transfer_id')
    .eq('stripe_payment_intent_id', piId)
    .maybeSingle();
  if (!payout) return;

  await logBillingEvent({
    school_id: payout.drivingschool_id,
    event_type: kind === 'dispute' ? 'referral_charge_disputed' : 'referral_charge_refunded',
    source: 'stripe-webhook',
    payload: { payout_id: payout.id, payment_intent_id: piId, payout_status: payout.status },
  });

  await sendTeamReferralAlertMail({
    schoolId: payout.drivingschool_id,
    subject: kind === 'dispute'
      ? 'SEPA-dispute op referral-incasso'
      : 'Refund op referral-incasso',
    lines: [
      `Payout: ${payout.id} (status: ${payout.status})`,
      `PaymentIntent: ${piId}`,
      `Bedrag: ${payout.amount_cents ?? 0} + fee ${payout.ribba_fee_cents} centen`,
      payout.stripe_transfer_id
        ? `Transfer ${payout.stripe_transfer_id} is al uitgevoerd — beoordeel een handmatige transfer-reversal in het Stripe-dashboard.`
        : 'Er is nog geen transfer uitgevoerd.',
    ],
  });
}
