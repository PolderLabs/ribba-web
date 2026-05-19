import { NextRequest, NextResponse } from 'next/server';
import { createMollieClient } from '@mollie/api-client';
import { createClient } from '@supabase/supabase-js';
import { sendAdminNotification } from '@/lib/admin-notifications';

function getMollie() {
  return createMollieClient({ apiKey: process.env.MOLLIE_API_KEY! });
}

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const PLAN_AMOUNTS: Record<string, string> = {
  basic: '25.00',
  premium: '45.00',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.formData();
    const paymentId = body.get('id') as string;

    if (!paymentId) {
      return NextResponse.json({ error: 'Missing payment id' }, { status: 400 });
    }

    const payment = await getMollie().payments.get(paymentId);
    const metadata = JSON.parse((payment.metadata as string) || '{}');
    const { school_id, plan, type } = metadata;

    if (!school_id || !plan) {
      console.error('Webhook: missing metadata', metadata);
      return NextResponse.json({ status: 'ok' });
    }

    // Verify the school exists and matches the payment
    const { data: school } = await getSupabase()
      .from('drivingschools')
      .select('id')
      .eq('id', school_id)
      .maybeSingle();
    if (!school) {
      console.error('Webhook: school_id does not exist', school_id);
      return NextResponse.json({ status: 'ok' });
    }

    // Only process paid first payments (subscription setup)
    if (payment.status === 'paid' && type === 'subscription_setup') {
      // Get the license record
      const { data: license } = await getSupabase()
        .from('instructor_licenses')
        .select('id, mollie_customer_id')
        .eq('school_id', school_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const customerId = license?.mollie_customer_id || payment.customerId;

      if (customerId) {
        // Create recurring subscription (next charge in 1 month — first payment already done)
        try {
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ribba.app';

          // Start recurring billing 1 month from now (first payment already covers this month)
          const startDate = new Date();
          startDate.setMonth(startDate.getMonth() + 1);
          const startDateStr = startDate.toISOString().split('T')[0]; // YYYY-MM-DD

          const subscription = await getMollie().customerSubscriptions.create({
            customerId,
            amount: { currency: 'EUR', value: PLAN_AMOUNTS[plan] || '45.00' },
            interval: '1 month',
            startDate: startDateStr,
            description: `Ribba ${plan === 'premium' ? 'Premium' : 'Basic'} – Maandabonnement`,
            webhookUrl: `${baseUrl}/api/mollie-webhook`,
            metadata: JSON.stringify({ school_id, plan, type: 'recurring' }),
          });

          // period_end = next billing date (startDate). First month is already paid for
          // so access is valid until that date at minimum.
          await getSupabase()
            .from('instructor_licenses')
            .update({
              billing_plan: plan,
              external_subscription_id: subscription.id,
              mollie_customer_id: customerId,
              is_trial: false,
              price_per_month: parseFloat(PLAN_AMOUNTS[plan] || '45'),
              period_end: startDate.toISOString(),
              cancelled_at: null,
            })
            .eq('id', license?.id);

          console.log(`Subscription ${subscription.id} created for school ${school_id}, starts ${startDateStr}`);
        } catch (subError) {
          console.error('Failed to create subscription:', subError);
        }
      } else if (license) {
        // Subscription creation failed — still update the plan
        await getSupabase()
          .from('instructor_licenses')
          .update({
            billing_plan: plan,
            is_trial: false,
            price_per_month: parseFloat(PLAN_AMOUNTS[plan] || '45'),
          })
          .eq('id', license.id);
      }

      // Admin notification — fire-and-forget
      try {
        const { data: schoolRow } = await getSupabase()
          .from('drivingschools')
          .select('name, email, city')
          .eq('id', school_id)
          .maybeSingle();
        if (schoolRow) {
          sendAdminNotification('subscription_activated', {
            id: school_id,
            name: schoolRow.name,
            email: schoolRow.email,
            city: schoolRow.city,
            billing_plan: plan,
          }).catch((e) => console.error('Admin notify (subscription_activated) failed:', e));
        }
      } catch (e) {
        console.error('Admin notify lookup failed:', e);
      }
    }

    // Handle recurring payments — extend period_end by 1 month
    if (payment.status === 'paid' && type === 'recurring') {
      const newPeriodEnd = new Date();
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

      await getSupabase()
        .from('instructor_licenses')
        .update({ period_end: newPeriodEnd.toISOString() })
        .eq('school_id', school_id)
        .eq('status', 'active');

      console.log(`Recurring payment received for school ${school_id}, period_end extended to ${newPeriodEnd.toISOString()}`);
    }

    // Handle failed recurring payment
    if (payment.status === 'failed' && type === 'recurring') {
      console.warn(`Recurring payment FAILED for school ${school_id}`);
      // Optionally downgrade after X failed attempts
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
