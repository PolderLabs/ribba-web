// Nightly reconciliation: vind licenses die wel een Mollie customer hebben
// (= eerste iDEAL-betaling is gelukt) maar nog geen recurring subscription,
// en probeer de subscription alsnog aan te maken. Vangnet voor het geval
// onze webhook failed terwijl de betaling al binnen is.
//
// Auth: Vercel Cron stuurt automatisch `Authorization: Bearer ${CRON_SECRET}`.

import { NextRequest, NextResponse } from 'next/server';
import { createMollieClient } from '@mollie/api-client';
import { createClient } from '@supabase/supabase-js';
import { sendAdminNotification } from '@/lib/admin-notifications';
import { logBillingEvent } from '@/lib/billing-events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PLAN_AMOUNTS: Record<string, string> = {
  basic: '25.00',
  premium: '45.00',
};

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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ribba.app';

  // Kandidaten: license is active, NIET in trial, heeft een Mollie customer,
  // maar geen subscription. >1u oud zodat we niet vechten met een normale
  // webhook-flow die net binnenkomt.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: candidates, error } = await getSupabase()
    .from('instructor_licenses')
    .select('id, school_id, billing_plan, mollie_customer_id, updated_at')
    .eq('status', 'active')
    .eq('is_trial', false)
    .not('mollie_customer_id', 'is', null)
    .is('external_subscription_id', null)
    .lt('updated_at', oneHourAgo);

  if (error) {
    console.error('reconcile-subscriptions: query failed', error);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }

  const results: Array<{ school_id: string; status: 'fixed' | 'failed'; reason?: string }> = [];

  for (const license of candidates ?? []) {
    const plan = license.billing_plan === 'premium' ? 'premium' : 'basic';
    try {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() + 1);
      const startDateStr = startDate.toISOString().split('T')[0];

      const subscription = await getMollie().customerSubscriptions.create({
        customerId: license.mollie_customer_id!,
        amount: { currency: 'EUR', value: PLAN_AMOUNTS[plan] },
        interval: '1 month',
        startDate: startDateStr,
        description: `Ribba ${plan === 'premium' ? 'Premium' : 'Basic'} – Maandabonnement`,
        webhookUrl: `${baseUrl}/api/mollie-webhook`,
        metadata: JSON.stringify({ school_id: license.school_id, plan, type: 'recurring' }),
      });

      await getSupabase()
        .from('instructor_licenses')
        .update({
          external_subscription_id: subscription.id,
          period_end: startDate.toISOString(),
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

  return NextResponse.json({
    checked: candidates?.length ?? 0,
    fixed: results.filter((r) => r.status === 'fixed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  });
}
