import { NextRequest, NextResponse } from 'next/server';
import { createMollieClient } from '@mollie/api-client';
import { createClient } from '@supabase/supabase-js';
import { sendAdminNotification } from '@/lib/admin-notifications';
import {
  sendRecurringPaymentFailedMail,
  sendSubscriptionSuspendedMail,
  sendSubscriptionActivatedMail,
} from '@/lib/school-emails';
import { logBillingEvent } from '@/lib/billing-events';

const FAILED_PAYMENT_LIMIT = 3;

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
      // Get the license record — incl. velden voor idempotency-check
      const { data: license } = await getSupabase()
        .from('instructor_licenses')
        .select('id, mollie_customer_id, external_subscription_id, billing_plan, is_trial')
        .eq('school_id', school_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Idempotency: was deze license al actief op een betaald plan?
      // Voorkomt dubbele mails als Mollie de setup-webhook re-deliveryt.
      const wasAlreadyActivated = Boolean(
        license &&
          !license.is_trial &&
          (license.billing_plan === 'basic' || license.billing_plan === 'premium') &&
          license.external_subscription_id,
      );

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
              failed_payment_count: 0,
              last_failed_payment_at: null,
            })
            .eq('id', license?.id);

          console.log(`Subscription ${subscription.id} created for school ${school_id}, starts ${startDateStr}`);

          await logBillingEvent({
            school_id,
            event_type: 'subscription_created',
            source: 'mollie-webhook',
            payload: {
              plan,
              payment_id: paymentId,
              external_subscription_id: subscription.id,
              mollie_customer_id: customerId,
              period_end: startDate.toISOString(),
              already_activated: wasAlreadyActivated,
            },
          });
        } catch (subError) {
          // Eerste betaling is gelukt, maar subscription aanmaken mislukte.
          // Admin notify + return 500 zodat Mollie de webhook retried.
          // Fallback: nightly reconciliation cron probeert het ook nog.
          console.error('Failed to create subscription:', subError);

          try {
            const { data: schoolRow } = await getSupabase()
              .from('drivingschools')
              .select('name, email, city')
              .eq('id', school_id)
              .maybeSingle();
            if (schoolRow) {
              await sendAdminNotification('subscription_creation_failed', {
                id: school_id,
                name: schoolRow.name,
                email: schoolRow.email,
                city: schoolRow.city,
                billing_plan: plan,
                extra: {
                  payment_id: paymentId,
                  mollie_customer_id: customerId,
                  error: String(subError).slice(0, 500),
                },
              });
            }
          } catch (notifyErr) {
            console.error('Admin notify (subscription_creation_failed) failed:', notifyErr);
          }

          await logBillingEvent({
            school_id,
            event_type: 'subscription_creation_failed',
            source: 'mollie-webhook',
            payload: {
              plan,
              payment_id: paymentId,
              mollie_customer_id: customerId,
              error: String(subError).slice(0, 500),
            },
          });

          return NextResponse.json({ status: 'retry' }, { status: 500 });
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

      // Notificaties — alleen op de eerste activering, niet bij webhook-retries
      // van dezelfde setup-payment. await zodat ze niet door Vercel worden
      // afgekapt na de response.
      if (!wasAlreadyActivated) {
        try {
          const { data: schoolRow } = await getSupabase()
            .from('drivingschools')
            .select('name, email, city')
            .eq('id', school_id)
            .maybeSingle();
          if (schoolRow) {
            // 1. Platformmelding naar Ribba beheerder
            await sendAdminNotification('subscription_activated', {
              id: school_id,
              name: schoolRow.name,
              email: schoolRow.email,
              city: schoolRow.city,
              billing_plan: plan,
            }).catch((e) => console.error('Admin notify (subscription_activated) failed:', e));

            // 2. Bevestigingsmail naar de rijschool
            if (schoolRow.email) {
              const nextChargeDate = new Date();
              nextChargeDate.setMonth(nextChargeDate.getMonth() + 1);
              await sendSubscriptionActivatedMail(
                school_id,
                schoolRow.email,
                schoolRow.name,
                plan as 'basic' | 'premium',
                parseFloat(PLAN_AMOUNTS[plan] || '45'),
                nextChargeDate,
              ).catch((e) => console.error('School subscription-activated mail failed:', e));
            }
          }
        } catch (e) {
          console.error('Notification lookup failed:', e);
        }
      } else {
        console.log(`Subscription_setup webhook re-delivery voor school ${school_id} — mails overgeslagen (idempotent)`);
      }
    }

    // Handle recurring payments — extend period_end by 1 month + reset failure counter
    if (payment.status === 'paid' && type === 'recurring') {
      const newPeriodEnd = new Date();
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

      await getSupabase()
        .from('instructor_licenses')
        .update({
          period_end: newPeriodEnd.toISOString(),
          failed_payment_count: 0,
          last_failed_payment_at: null,
        })
        .eq('school_id', school_id)
        .eq('status', 'active');

      console.log(`Recurring payment received for school ${school_id}, period_end extended to ${newPeriodEnd.toISOString()}`);

      await logBillingEvent({
        school_id,
        event_type: 'recurring_payment_paid',
        source: 'mollie-webhook',
        payload: { plan, payment_id: paymentId, new_period_end: newPeriodEnd.toISOString() },
      });
    }

    // Handle failed recurring payment — escalatieladder:
    //   poging 1/2/3: mail rijschool ("controleer saldo, we proberen opnieuw")
    //   poging >= 3 : cancel subscription bij Mollie + admin notify + opzeg-mail naar rijschool
    if (payment.status === 'failed' && type === 'recurring') {
      console.warn(`Recurring payment FAILED for school ${school_id}`);

      const { data: license } = await getSupabase()
        .from('instructor_licenses')
        .select('id, failed_payment_count, mollie_customer_id, external_subscription_id')
        .eq('school_id', school_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (license) {
        const newCount = (license.failed_payment_count ?? 0) + 1;

        await getSupabase()
          .from('instructor_licenses')
          .update({
            failed_payment_count: newCount,
            last_failed_payment_at: new Date().toISOString(),
          })
          .eq('id', license.id);

        await logBillingEvent({
          school_id,
          event_type: 'recurring_payment_failed',
          source: 'mollie-webhook',
          payload: { plan, payment_id: paymentId, attempt: newCount, limit: FAILED_PAYMENT_LIMIT },
        });

        const { data: schoolRow } = await getSupabase()
          .from('drivingschools')
          .select('name, email, city')
          .eq('id', school_id)
          .maybeSingle();

        if (newCount >= FAILED_PAYMENT_LIMIT) {
          // Cancel de Mollie subscription
          if (license.external_subscription_id && license.mollie_customer_id) {
            try {
              await getMollie().customerSubscriptions.cancel(
                license.external_subscription_id,
                { customerId: license.mollie_customer_id },
              );
            } catch (cancelErr) {
              console.error('Could not cancel Mollie subscription after failures:', cancelErr);
            }
          }

          // Markeer license als opgeschort: terug naar trial, behoud customer-id voor reactivatie
          await getSupabase()
            .from('instructor_licenses')
            .update({
              billing_plan: 'trial',
              is_trial: true,
              external_subscription_id: null,
              cancelled_at: new Date().toISOString(),
            })
            .eq('id', license.id);

          await logBillingEvent({
            school_id,
            event_type: 'subscription_suspended',
            source: 'mollie-webhook',
            payload: {
              plan,
              payment_id: paymentId,
              failed_payment_count: newCount,
              limit: FAILED_PAYMENT_LIMIT,
              cancelled_external_subscription_id: license.external_subscription_id,
            },
          });

          if (schoolRow?.email) {
            await sendSubscriptionSuspendedMail(school_id, schoolRow.email, schoolRow.name).catch((e) =>
              console.error('School suspended mail failed:', e),
            );
          }

          if (schoolRow) {
            await sendAdminNotification('subscription_suspended', {
              id: school_id,
              name: schoolRow.name,
              email: schoolRow.email,
              city: schoolRow.city,
              extra: { failed_payment_count: newCount, payment_id: paymentId },
            }).catch((e) => console.error('Admin notify (subscription_suspended) failed:', e));
          }
        } else {
          if (schoolRow?.email) {
            await sendRecurringPaymentFailedMail(
              school_id,
              schoolRow.email,
              schoolRow.name,
              newCount,
            ).catch((e) => console.error('School payment-failed mail failed:', e));
          }

          if (schoolRow) {
            await sendAdminNotification('recurring_payment_failed', {
              id: school_id,
              name: schoolRow.name,
              email: schoolRow.email,
              city: schoolRow.city,
              extra: { attempt: newCount, payment_id: paymentId },
            }).catch((e) => console.error('Admin notify (recurring_payment_failed) failed:', e));
          }
        }
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
