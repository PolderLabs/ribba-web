// Dagelijkse referral-payout-verwerking (Vercel Cron, CRON_SECRET-bearer):
//
//   1. milestone-mails: partners informeren dat hun commissie klaarstaat en
//      op bevestiging van de rijschool wacht (RPC's zijn side-effect-vrij,
//      dus deze sweep verstuurt de mail — milestone_notified_at is de marker);
//   2. incasso's starten: bevestigde cash-payouts → gefenced confirmed→charging
//      → SEPA PaymentIntent (off-session, bedrag = commissie + Ribba-fee).
//      Eén automatische retry voor mislukte incasso's (attempt_count < 2);
//      daarna is herstel aan de school via referral_retry_payout.
//      NOOIT incasseren als de partner niet kan ontvangen (payouts_enabled)
//      of het mandaat niet actief is — we innen geen geld dat we niet kunnen
//      doorbetalen;
//   3. KYC-nudges: partners met bevestigde commissie maar zonder afgeronde
//      Stripe-onboarding, gethrotteld op 7 dagen (kyc_nudge_sent_at).
//
// SEPA is asynchroon: de payout blijft na stap 2 in 'charging' staan tot de
// payment_intent.succeeded/.payment_failed-webhook hem verder beweegt.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe';
import { logBillingEvent } from '@/lib/billing-events';
import {
  sendPartnerKycNudgeMail,
  sendPartnerMilestoneMail,
  sendPartnerPayoutConfirmedMail,
  sendSchoolChargeFailedMail,
} from '@/lib/referral-emails';
import type {
  ReferralPartnerRow,
  ReferralPayoutRow,
  ReferralProgramRow,
} from '@/lib/referral-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const KYC_NUDGE_INTERVAL_DAYS = 7;
const MAX_AUTO_ATTEMPTS = 2;

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function fetchByIds<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  ids: string[],
): Promise<Map<string, T>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from(table).select(columns).in('id', [...new Set(ids)]);
  return new Map(((data ?? []) as unknown as Array<T & { id: string }>).map((row) => [row.id, row]));
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const summary = {
    milestone_mails: 0,
    charges_started: 0,
    charges_failed: 0,
    kyc_nudges: 0,
    skipped: [] as Array<{ payout_id: string; reason: string }>,
  };

  // ── 1. Milestone-mails ────────────────────────────────────────────────────
  const { data: unnotified } = await supabase
    .from('referral_payouts')
    .select('id, referral_id, partner_id, drivingschool_id, milestone, reward_kind, amount_cents')
    .eq('status', 'pending')
    .is('milestone_notified_at', null)
    .limit(200);

  if (unnotified && unnotified.length > 0) {
    const partners = await fetchByIds<Pick<ReferralPartnerRow, 'id' | 'email'>>(
      supabase, 'referral_partners', 'id, email', unnotified.map((p) => p.partner_id));
    const referrals = await fetchByIds<{ id: string; referred_first_name: string }>(
      supabase, 'referrals', 'id, referred_first_name', unnotified.map((p) => p.referral_id));
    const schools = await fetchByIds<{ id: string; name: string }>(
      supabase, 'drivingschools', 'id, name', unnotified.map((p) => p.drivingschool_id));

    for (const payout of unnotified) {
      const partner = partners.get(payout.partner_id);
      if (!partner) continue;
      await sendPartnerMilestoneMail({
        schoolId: payout.drivingschool_id,
        partnerEmail: partner.email,
        schoolName: schools.get(payout.drivingschool_id)?.name ?? 'je rijschool',
        referredFirstName: referrals.get(payout.referral_id)?.referred_first_name ?? 'Je aanmelding',
        milestone: payout.milestone,
        reward: {
          milestone: payout.milestone,
          reward_kind: payout.reward_kind,
          amount_cents: payout.amount_cents,
        },
      });
      await supabase
        .from('referral_payouts')
        .update({ milestone_notified_at: new Date().toISOString() })
        .eq('id', payout.id);
      summary.milestone_mails++;
    }
  }

  // ── 2. Incasso's starten ─────────────────────────────────────────────────
  const { data: chargeable } = await supabase
    .from('referral_payouts')
    .select('*')
    .eq('reward_kind', 'cash')
    .or(`status.eq.confirmed,and(status.eq.failed,attempt_count.lt.${MAX_AUTO_ATTEMPTS})`)
    .limit(100);

  const cashPayouts = (chargeable ?? []) as ReferralPayoutRow[];
  if (cashPayouts.length > 0) {
    const partners = await fetchByIds<ReferralPartnerRow>(
      supabase, 'referral_partners', '*', cashPayouts.map((p) => p.partner_id));
    const schools = await fetchByIds<{ id: string; name: string; email: string | null }>(
      supabase, 'drivingschools', 'id, name, email', cashPayouts.map((p) => p.drivingschool_id));
    const { data: programRows } = await supabase
      .from('referral_programs')
      .select('*')
      .in('drivingschool_id', [...new Set(cashPayouts.map((p) => p.drivingschool_id))]);
    const programs = new Map(
      ((programRows ?? []) as ReferralProgramRow[]).map((p) => [p.drivingschool_id, p]),
    );

    const stripe = getStripe();

    for (const payout of cashPayouts) {
      const partner = partners.get(payout.partner_id);
      const program = programs.get(payout.drivingschool_id);

      if (!partner?.payouts_enabled || !partner.stripe_account_id) {
        summary.skipped.push({ payout_id: payout.id, reason: 'partner_onboarding_incompleet' });
        continue;
      }
      if (!program || program.sepa_mandate_status !== 'active'
        || !program.stripe_customer_id || !program.stripe_payment_method_id) {
        summary.skipped.push({ payout_id: payout.id, reason: 'mandaat_niet_actief' });
        continue;
      }
      if (payout.amount_cents == null) {
        summary.skipped.push({ payout_id: payout.id, reason: 'geen_bedrag' });
        continue;
      }

      // Gefencede claim: alleen de verwachte huidige status mag bewegen.
      const { data: claimed } = await supabase
        .from('referral_payouts')
        .update({ status: 'charging', attempt_count: payout.attempt_count + 1 })
        .eq('id', payout.id)
        .eq('status', payout.status)
        .eq('attempt_count', payout.attempt_count)
        .select('id');
      if (!claimed || claimed.length === 0) continue; // een andere run was ons voor

      const attempt = payout.attempt_count + 1;
      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: payout.amount_cents + payout.ribba_fee_cents,
            currency: payout.currency,
            customer: program.stripe_customer_id,
            payment_method: program.stripe_payment_method_id,
            payment_method_types: ['sepa_debit'],
            off_session: true,
            confirm: true,
            description: `Referral-uitbetaling ${payout.milestone} (incl. servicekosten)`,
            metadata: { payout_id: payout.id, drivingschool_id: payout.drivingschool_id },
            transfer_group: `payout_${payout.id}`,
          },
          { idempotencyKey: `referral-payout-charge-${payout.id}-a${attempt}` },
        );

        await supabase
          .from('referral_payouts')
          .update({ stripe_payment_intent_id: intent.id })
          .eq('id', payout.id);

        await logBillingEvent({
          school_id: payout.drivingschool_id,
          event_type: 'referral_charge_started',
          source: 'cron-referral-payouts',
          payload: {
            payout_id: payout.id,
            payment_intent_id: intent.id,
            amount_cents: payout.amount_cents,
            ribba_fee_cents: payout.ribba_fee_cents,
            attempt,
          },
        });

        await sendPartnerPayoutConfirmedMail({
          schoolId: payout.drivingschool_id,
          partnerEmail: partner.email,
          schoolName: schools.get(payout.drivingschool_id)?.name ?? 'je rijschool',
          amountCents: payout.amount_cents,
        });
        summary.charges_started++;
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.error(`referral-payouts: incasso ${payout.id} mislukt`, reason);
        await supabase
          .from('referral_payouts')
          .update({
            status: 'failed',
            failed_at: new Date().toISOString(),
            failure_reason: reason.slice(0, 500),
          })
          .eq('id', payout.id)
          .eq('status', 'charging');
        const school = schools.get(payout.drivingschool_id);
        if (school?.email) {
          await sendSchoolChargeFailedMail({
            schoolId: payout.drivingschool_id,
            schoolEmail: school.email,
            schoolName: school.name,
            totalCents: payout.amount_cents + payout.ribba_fee_cents,
            reason,
          });
        }
        summary.charges_failed++;
      }
    }

    // ── 3. KYC-nudges ────────────────────────────────────────────────────────
    const nudgeCutoff = new Date(Date.now() - KYC_NUDGE_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    const blockedByPartner = new Map<string, { amount: number; schoolId: string }>();
    for (const payout of cashPayouts) {
      const partner = partners.get(payout.partner_id);
      if (!partner || partner.payouts_enabled || payout.status !== 'confirmed') continue;
      const entry = blockedByPartner.get(partner.id) ?? { amount: 0, schoolId: payout.drivingschool_id };
      entry.amount += payout.amount_cents ?? 0;
      blockedByPartner.set(partner.id, entry);
    }
    for (const [partnerId, entry] of blockedByPartner) {
      const partner = partners.get(partnerId);
      if (!partner) continue;
      if (partner.kyc_nudge_sent_at && new Date(partner.kyc_nudge_sent_at) > nudgeCutoff) continue;
      await sendPartnerKycNudgeMail({
        schoolId: entry.schoolId,
        partnerEmail: partner.email,
        pendingAmountCents: entry.amount,
      });
      await supabase
        .from('referral_partners')
        .update({ kyc_nudge_sent_at: new Date().toISOString() })
        .eq('id', partnerId);
      summary.kyc_nudges++;
    }
  }

  return NextResponse.json(summary);
}
