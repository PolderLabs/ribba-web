// Nightly reconciliation, twee passen:
//
// 1. Vind licenses die wel een Mollie customer hebben (= eerste iDEAL-betaling
//    is gelukt) maar nog geen recurring subscription, en maak die alsnog aan.
//    Vangnet voor het geval onze webhook failed terwijl de betaling al binnen is.
//
// 2. Synchroniseer het bedrag van bestaande subscriptions met de teamgrootte.
//    Premium bevat 5 instructeurs, daarboven €34 netto per extra instructeur.
//    Instructeurs worden in de app direct in Supabase aangemaakt, dus dit is
//    het enige moment waarop wij dat verschil kunnen zien en doorzetten.
//
// Auth: Vercel Cron stuurt automatisch `Authorization: Bearer ${CRON_SECRET}`.

import { NextRequest, NextResponse } from 'next/server';
import { DOMAIN } from '@/lib/domains';
import { createMollieClient } from '@mollie/api-client';
import { createClient } from '@supabase/supabase-js';
import { sendAdminNotification } from '@/lib/admin-notifications';
import { logBillingEvent } from '@/lib/billing-events';
import {
  isPaidPlan,
  getSubscriptionPricing,
  formatCentsForMollie,
  centsFromMollieValue,
  totalNetMonthlyEurosForDb,
  planDescription,
} from '@/lib/plan-pricing';
import { countActiveInstructors } from '@/lib/active-instructors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getMollie() {
  return createMollieClient({ apiKey: process.env.MOLLIE_API_KEY! });
}

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || DOMAIN.account;

  // Kandidaten: license is active, NIET in trial, heeft een Mollie customer,
  // maar geen subscription. >1u oud zodat we niet vechten met een normale
  // webhook-flow die net binnenkomt.
  //
  // P0: cancelled_at IS NULL is verplicht. Een opgezegde license zit in
  // CANCELLED_GRACE (status='active', external_subscription_id=null,
  // mollie_customer_id nog gevuld) en matchte vóór deze fix alle filters —
  // waardoor de cron een NIEUWE subscription aanmaakte voor een klant die
  // net had opgezegd (bewezen: sub_4nb9hcBarR, 11 juli 03:09 UTC).
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: candidates, error } = await getSupabase()
    .from('instructor_licenses')
    .select('id, school_id, billing_plan, mollie_customer_id, updated_at')
    .eq('status', 'active')
    .eq('is_trial', false)
    .not('mollie_customer_id', 'is', null)
    .is('external_subscription_id', null)
    .is('cancelled_at', null)
    .lt('updated_at', oneHourAgo);

  if (error) {
    console.error('reconcile-subscriptions: query failed', error);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }

  const results: Array<{ school_id: string; status: 'fixed' | 'failed' | 'skipped'; reason?: string }> = [];

  for (const license of candidates ?? []) {
    // Fail-closed: alleen bekende betaalde plannen krijgen een subscription.
    // De oude `=== 'premium' ? 'premium' : 'basic'`-afleiding was een stille
    // fallback naar Basic; een onbekend plan wordt nu overgeslagen + gelogd.
    if (!isPaidPlan(license.billing_plan)) {
      const reason = `unknown_plan:${String(license.billing_plan)}`;
      results.push({ school_id: license.school_id, status: 'skipped', reason });
      console.error(`reconcile: skipped school ${license.school_id} — ${reason}`);
      await logBillingEvent({
        school_id: license.school_id,
        event_type: 'unknown_plan_rejected',
        source: 'cron:reconcile-subscriptions',
        payload: { plan: String(license.billing_plan), mollie_customer_id: license.mollie_customer_id },
      });
      continue;
    }
    const plan = license.billing_plan;
    try {
      // Prijzen zijn excl. 21% btw; Mollie incasseert bruto (SSoT). Het bedrag
      // schaalt mee met het aantal actieve instructeurs.
      const instructors = await countActiveInstructors(getSupabase(), license.school_id);
      const pricing = getSubscriptionPricing(plan, Math.max(1, instructors));
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() + 1);
      const startDateStr = startDate.toISOString().split('T')[0];

      const subscription = await getMollie().customerSubscriptions.create({
        customerId: license.mollie_customer_id!,
        amount: { currency: 'EUR', value: formatCentsForMollie(pricing.totalGrossMonthlyCents) },
        interval: '1 month',
        startDate: startDateStr,
        description: planDescription(pricing.plan),
        webhookUrl: `${baseUrl}/api/mollie-webhook`,
        metadata: JSON.stringify({ school_id: license.school_id, plan, type: 'recurring' }),
      });

      await getSupabase()
        .from('instructor_licenses')
        .update({
          external_subscription_id: subscription.id,
          period_end: startDate.toISOString(),
          price_per_month: totalNetMonthlyEurosForDb(pricing),
        })
        .eq('id', license.id);

      results.push({ school_id: license.school_id, status: 'fixed' });
      console.log(`reconcile: fixed school ${license.school_id} → subscription ${subscription.id}`);

      await logBillingEvent({
        school_id: license.school_id,
        event_type: 'subscription_reconciled',
        source: 'cron:reconcile-subscriptions',
        payload: {
          plan,
          external_subscription_id: subscription.id,
          mollie_customer_id: license.mollie_customer_id,
          period_end: startDate.toISOString(),
          instructors,
          net_monthly: totalNetMonthlyEurosForDb(pricing),
        },
      });
    } catch (err) {
      const reason = String(err).slice(0, 200);
      results.push({ school_id: license.school_id, status: 'failed', reason });
      console.error(`reconcile: failed for school ${license.school_id}:`, err);

      await logBillingEvent({
        school_id: license.school_id,
        event_type: 'subscription_reconcile_failed',
        source: 'cron:reconcile-subscriptions',
        payload: {
          plan,
          mollie_customer_id: license.mollie_customer_id,
          error: reason,
        },
      });

      const { data: schoolRow } = await getSupabase()
        .from('drivingschools')
        .select('name, email, city')
        .eq('id', license.school_id)
        .maybeSingle();
      if (schoolRow) {
        await sendAdminNotification('subscription_creation_failed', {
          id: license.school_id,
          name: schoolRow.name,
          email: schoolRow.email,
          city: schoolRow.city,
          billing_plan: plan,
          extra: {
            source: 'reconcile-cron',
            mollie_customer_id: license.mollie_customer_id,
            error: reason,
          },
        }).catch((e) => console.error('Admin notify (reconcile) failed:', e));
      }
    }
  }

  // ── Pas 2: bedragen synchroniseren met de teamgrootte ────────────────
  //
  // Premium bevat 5 instructeurs; daarboven €34 netto per extra instructeur.
  // Instructeurs worden in de app direct in Supabase aangemaakt — er is geen
  // route in deze repo die dat afvangt — dus is er geen moment waarop we het
  // Mollie-bedrag live kunnen bijwerken. Deze pas is dat moment.
  //
  // Besluit 14 aug 2026: GEEN proratie. Het subscription-bedrag bij Mollie
  // wordt bijgewerkt en geldt vanaf de volgende incasso; de lopende maand
  // blijft op het oude bedrag staan. Dat geldt beide kanten op — krimpt het
  // team, dan gaat het bedrag op dezelfde manier omlaag.
  const amountResults: Array<{
    school_id: string;
    status: 'synced' | 'unchanged' | 'failed' | 'skipped';
    from?: string;
    to?: string;
    instructors?: number;
    reason?: string;
  }> = [];

  const { data: subscribed, error: subscribedError } = await getSupabase()
    .from('instructor_licenses')
    .select('id, school_id, billing_plan, mollie_customer_id, external_subscription_id')
    .eq('status', 'active')
    .eq('is_trial', false)
    .not('mollie_customer_id', 'is', null)
    .not('external_subscription_id', 'is', null)
    .is('cancelled_at', null);

  if (subscribedError) {
    console.error('reconcile-subscriptions: amount-sync query failed', subscribedError);
  }

  for (const license of subscribed ?? []) {
    if (!isPaidPlan(license.billing_plan)) {
      amountResults.push({
        school_id: license.school_id,
        status: 'skipped',
        reason: `unknown_plan:${String(license.billing_plan)}`,
      });
      continue;
    }
    const plan = license.billing_plan;
    try {
      const instructors = await countActiveInstructors(getSupabase(), license.school_id);
      const pricing = getSubscriptionPricing(plan, Math.max(1, instructors));
      const expectedValue = formatCentsForMollie(pricing.totalGrossMonthlyCents);

      const sub = await getMollie().customerSubscriptions.get(
        license.external_subscription_id!,
        { customerId: license.mollie_customer_id! },
      );

      // Alleen een lopend abonnement bijwerken. Een gepauzeerde/gecancelde
      // subscription laten we met rust; die wordt elders opgepakt.
      if (sub.status !== 'active') {
        amountResults.push({
          school_id: license.school_id,
          status: 'skipped',
          reason: `subscription_status:${String(sub.status)}`,
        });
        continue;
      }

      const currentCents = centsFromMollieValue(sub.amount.value);
      if (currentCents === pricing.totalGrossMonthlyCents) {
        amountResults.push({ school_id: license.school_id, status: 'unchanged', instructors });
        continue;
      }

      await getMollie().customerSubscriptions.update(license.external_subscription_id!, {
        customerId: license.mollie_customer_id!,
        amount: { currency: 'EUR', value: expectedValue },
        description: planDescription(pricing.plan),
      });

      await getSupabase()
        .from('instructor_licenses')
        .update({ price_per_month: totalNetMonthlyEurosForDb(pricing) })
        .eq('id', license.id);

      amountResults.push({
        school_id: license.school_id,
        status: 'synced',
        from: sub.amount.value,
        to: expectedValue,
        instructors,
      });
      console.log(
        `reconcile: school ${license.school_id} bedrag ${sub.amount.value} → ${expectedValue} (${instructors} instructeurs)`,
      );

      await logBillingEvent({
        school_id: license.school_id,
        event_type: 'subscription_amount_synced',
        source: 'cron:reconcile-subscriptions',
        payload: {
          plan,
          external_subscription_id: license.external_subscription_id,
          instructors,
          included_instructors: pricing.includedInstructors,
          extra_instructors: pricing.extraInstructors,
          amount_from: sub.amount.value,
          amount_to: expectedValue,
          net_monthly: totalNetMonthlyEurosForDb(pricing),
        },
      });
    } catch (err) {
      const reason = String(err).slice(0, 200);
      amountResults.push({ school_id: license.school_id, status: 'failed', reason });
      console.error(`reconcile: amount-sync failed for school ${license.school_id}:`, err);

      await logBillingEvent({
        school_id: license.school_id,
        event_type: 'subscription_amount_sync_failed',
        source: 'cron:reconcile-subscriptions',
        payload: {
          plan,
          external_subscription_id: license.external_subscription_id,
          error: reason,
        },
      });
    }
  }

  return NextResponse.json({
    checked: candidates?.length ?? 0,
    fixed: results.filter((r) => r.status === 'fixed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
    amount_checked: subscribed?.length ?? 0,
    amount_synced: amountResults.filter((r) => r.status === 'synced').length,
    amount_failed: amountResults.filter((r) => r.status === 'failed').length,
    amount_results: amountResults,
  });
}
