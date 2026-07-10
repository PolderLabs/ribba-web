import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createMollieClient } from '@mollie/api-client';
import { createClient } from '@supabase/supabase-js';
import { sendAdminNotification } from '@/lib/admin-notifications';
import {
  sendRecurringPaymentFailedMail,
  sendSubscriptionSuspendedMail,
  sendSubscriptionActivatedMail,
} from '@/lib/school-emails';
import { logBillingEvent } from '@/lib/billing-events';
import {
  claimSetupWebhook,
  advanceReceiptStage,
  markReceiptSucceeded,
  markReceiptFailed,
  markReceiptDiscarded,
} from '@/lib/billing-webhook-receipts';

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

// Recovery-correlatie: zoek bij Mollie de subscription die door deze setup-payment
// is aangemaakt. Correleert UITSLUITEND op metadata.setup_payment_id (harde sleutel)
// — nooit op description of school_id, want bij planwissels bestaan meerdere
// (historische) subscriptions voor dezelfde school/customer.
async function findSubscriptionBySetupPayment(customerId: string, setupPaymentId: string) {
  const page = await getMollie().customerSubscriptions.page({ customerId, limit: 250 });
  for (const sub of page) {
    if (sub.status !== 'active' && sub.status !== 'pending') continue;
    try {
      const meta = typeof sub.metadata === 'string' ? JSON.parse(sub.metadata) : sub.metadata;
      if (meta && (meta as { setup_payment_id?: string }).setup_payment_id === setupPaymentId) {
        return sub;
      }
    } catch {
      // metadata niet parseerbaar → kan onze subscription niet zijn
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.formData();
    const paymentId = body.get('id') as string;

    if (!paymentId) {
      return NextResponse.json({ error: 'Missing payment id' }, { status: 400 });
    }

    const payment = await getMollie().payments.get(paymentId);
    const metadata = JSON.parse((payment.metadata as string) || '{}');
    const { school_id, plan, type, replaces_subscription_id } = metadata;

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
      // ── Canonieke idempotentie-claim (billing_webhook_receipts, throwing) ──
      // Vóór elke side-effect. Bij twee gelijktijdige deliveries wint er exact
      // één via de unique constraint; de rest krijgt terminal-hit of in-flight.
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            id: payment.id,
            status: payment.status,
            customerId: payment.customerId ?? null,
            metadata: payment.metadata ?? null,
          }),
        )
        .digest('hex');

      const claim = await claimSetupWebhook({
        paymentId,
        schoolId: school_id,
        fingerprint,
      });

      if (claim.outcome === 'already_terminal') {
        // Reeds verwerkt (succeeded) of bewust genegeerd (discarded): no-op.
        // 200 zodat Mollie stopt met retryen.
        await logBillingEvent({
          school_id,
          event_type: 'ignored_duplicate_setup_webhook',
          source: 'mollie-webhook',
          payload: {
            plan,
            payment_id: paymentId,
            receipt_status: claim.receipt.status,
            receipt_stage: claim.receipt.side_effect_stage,
            attempt_count: claim.receipt.attempt_count,
          },
        });
        return NextResponse.json({ status: 'ok' });
      }

      if (claim.outcome === 'in_flight') {
        // Een andere run is (vermoedelijk) nog bezig. 500 → Mollie retryt later;
        // tegen die tijd is de andere run terminaal of stale (herclaimbaar).
        console.warn(`Setup webhook ${paymentId}: verwerking al in flight, retry later`);
        return NextResponse.json({ status: 'in_flight' }, { status: 500 });
      }

      const receipt = claim.receipt;
      let stage = receipt.side_effect_stage;
      let subscriptionId = receipt.result_subscription_id;

      // Get the license record — updated_at is nodig voor de freshness-gate
      const { data: license } = await getSupabase()
        .from('instructor_licenses')
        .select('id, mollie_customer_id, external_subscription_id, billing_plan, is_trial, updated_at')
        .eq('school_id', school_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Mail-idempotentie (tweede slot naast de receipts): was deze license al
      // actief op een betaald plan?
      const wasAlreadyActivated = Boolean(
        license &&
          !license.is_trial &&
          (license.billing_plan === 'basic' || license.billing_plan === 'premium') &&
          license.external_subscription_id,
      );

      // ── Freshness-gate: alleen op verse claims (receipts-tabel start leeg, dus
      // historische payments winnen altijd hun eerste claim). Twee gevallen:
      //   a. foreign customer — payment hoort bij een andere Mollie-customer dan
      //      de license (bv. oude payment van een eerdere customer-koppeling);
      //   b. stale duplicate — license draait al op ditzelfde plan via een
      //      subscription die NA deze payment is opgezet.
      // Beide: bewust negeren (discarded) + audit + 200. ──
      if (!claim.recovered && stage === 'claimed') {
        const licenseCustomerId = license?.mollie_customer_id ?? null;
        const foreignCustomer = Boolean(
          licenseCustomerId && payment.customerId && payment.customerId !== licenseCustomerId,
        );
        const paymentCreatedAt = payment.createdAt ? new Date(payment.createdAt) : null;
        const licenseUpdatedAt = license?.updated_at ? new Date(license.updated_at) : null;
        const staleDuplicate = Boolean(
          license?.external_subscription_id &&
            plan === license.billing_plan &&
            paymentCreatedAt &&
            licenseUpdatedAt &&
            paymentCreatedAt < licenseUpdatedAt,
        );

        if (foreignCustomer || staleDuplicate) {
          await markReceiptDiscarded(receipt.id);
          await logBillingEvent({
            school_id,
            event_type: 'ignored_duplicate_setup_webhook',
            source: 'mollie-webhook',
            payload: {
              plan,
              payment_id: paymentId,
              reason: foreignCustomer ? 'foreign_customer' : 'stale_duplicate',
              payment_customer_id: payment.customerId ?? null,
              license_customer_id: licenseCustomerId,
              current_external_subscription_id: license?.external_subscription_id ?? null,
            },
          });
          return NextResponse.json({ status: 'ok' });
        }
      }

      const customerId = license?.mollie_customer_id || payment.customerId;

      if (customerId) {
        // Stage-driven verwerking: de receipt bepaalt welke side-effects nog
        // moeten gebeuren. Een receipt met stage >= subscription_created kan
        // hierdoor NOOIT een tweede customerSubscriptions.create triggeren.
        try {
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ribba.app';
          let periodEndIso: string;
          let createdThisRun = false;

          if (stage === 'claimed') {
            // Recovery vanaf 'claimed': de vorige run kan gecrasht zijn ná de
            // Mollie-create maar vóór de stage-write (het enige blinde venster).
            // Daarom eerst Mollie consulteren op de harde correlatiesleutel.
            let existingSub = null;
            if (claim.recovered) {
              existingSub = await findSubscriptionBySetupPayment(customerId, paymentId);
            }

            if (existingSub) {
              subscriptionId = existingSub.id;
              periodEndIso = new Date(`${existingSub.startDate}T00:00:00Z`).toISOString();
            } else {
              // Start recurring billing 1 month from now (first payment covers this month)
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
                // setup_payment_id = harde correlatiesleutel voor crash-recovery.
                // Nooit correleren op description of school_id alleen.
                metadata: JSON.stringify({ school_id, plan, type: 'recurring', setup_payment_id: paymentId }),
                // Derde slot: Mollie replayt de eerdere response bij dezelfde key,
                // dus zelfs een gemiste consult kan geen duplicaat opleveren.
                idempotencyKey: paymentId,
              });
              subscriptionId = subscription.id;
              periodEndIso = startDate.toISOString();
              createdThisRun = true;
            }

            await advanceReceiptStage(receipt.id, 'subscription_created', subscriptionId);
            stage = 'subscription_created';
          } else {
            // Recovery vanaf subscription_created/license_updated: sub-id staat in
            // de receipt; startDate bij Mollie ophalen voor een correcte period_end.
            const sub = await getMollie().customerSubscriptions.get(subscriptionId!, { customerId });
            periodEndIso = new Date(`${sub.startDate}T00:00:00Z`).toISOString();
          }

          if (stage === 'subscription_created') {
            // period_end = next billing date. First month is already paid for
            // so access is valid until that date at minimum.
            await getSupabase()
              .from('instructor_licenses')
              .update({
                billing_plan: plan,
                external_subscription_id: subscriptionId,
                mollie_customer_id: customerId,
                is_trial: false,
                price_per_month: parseFloat(PLAN_AMOUNTS[plan] || '45'),
                period_end: periodEndIso,
                cancelled_at: null,
                failed_payment_count: 0,
                last_failed_payment_at: null,
              })
              .eq('id', license?.id);

            await advanceReceiptStage(receipt.id, 'license_updated');
            stage = 'license_updated';
          }

          console.log(
            `Subscription ${subscriptionId} verwerkt voor school ${school_id} (recovered=${claim.recovered}, created=${createdThisRun})`,
          );

          if (claim.recovered) {
            await logBillingEvent({
              school_id,
              event_type: 'setup_webhook_recovered',
              source: 'mollie-webhook',
              payload: {
                plan,
                payment_id: paymentId,
                external_subscription_id: subscriptionId,
                mollie_customer_id: customerId,
                from_stage: receipt.side_effect_stage,
                created_in_recovery: createdThisRun,
              },
            });
          } else {
            await logBillingEvent({
              school_id,
              event_type: 'subscription_created',
              source: 'mollie-webhook',
              payload: {
                plan,
                payment_id: paymentId,
                external_subscription_id: subscriptionId,
                mollie_customer_id: customerId,
                period_end: periodEndIso,
                already_activated: wasAlreadyActivated,
              },
            });
          }

          // B1: Cancel oude subscription pas NÁ succesvolle nieuwe setup + DB-update.
          // replaces_subscription_id is meegegeven door /api/checkout in payment.metadata.
          // Falen is niet fataal: klant krijgt kort dubbele Mollie-sub die admin
          // handmatig moet opruimen; we loggen + notify. Webhook returnt sowieso 200
          // om te voorkomen dat Mollie retryt en we een tweede nieuwe sub aanmaken.
          //
          // Idempotency: hergebruik van bestaande `wasAlreadyActivated`-gate. Op
          // webhook re-delivery is de eerste cancel al gedaan (of geprobeerd);
          // opnieuw cancelen zou een 422 "already canceled" geven en een
          // false-positive `old_subscription_cancel_failed` + admin-notify triggeren.
          if (
            !wasAlreadyActivated &&
            replaces_subscription_id &&
            typeof replaces_subscription_id === 'string' &&
            replaces_subscription_id !== subscriptionId
          ) {
            try {
              await getMollie().customerSubscriptions.cancel(
                replaces_subscription_id,
                { customerId },
              );
              console.log(
                `Cancelled old subscription ${replaces_subscription_id} for school ${school_id} after new setup`,
              );
              await logBillingEvent({
                school_id,
                event_type: 'old_subscription_cancelled',
                source: 'mollie-webhook',
                payload: {
                  plan,
                  payment_id: paymentId,
                  old_subscription_id: replaces_subscription_id,
                  new_subscription_id: subscriptionId,
                  mollie_customer_id: customerId,
                },
              });
            } catch (oldCancelErr) {
              const errStr = String(oldCancelErr).slice(0, 500);
              console.error(
                `Failed to cancel old subscription ${replaces_subscription_id} after new setup:`,
                oldCancelErr,
              );
              await logBillingEvent({
                school_id,
                event_type: 'old_subscription_cancel_failed',
                source: 'mollie-webhook',
                payload: {
                  plan,
                  payment_id: paymentId,
                  old_subscription_id: replaces_subscription_id,
                  new_subscription_id: subscriptionId,
                  mollie_customer_id: customerId,
                  error: errStr,
                },
              });
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
                      reason: 'old_subscription_cancel_failed',
                      old_subscription_id: replaces_subscription_id,
                      new_subscription_id: subscriptionId,
                      mollie_customer_id: customerId,
                      error: errStr,
                    },
                  }).catch((e) =>
                    console.error('Admin notify (old_subscription_cancel_failed) failed:', e),
                  );
                }
              } catch (notifyErr) {
                console.error('Admin notify lookup failed:', notifyErr);
              }
            }
          }

          // Terminaal succes VÓÓR de mails (bewuste ontwerpkeuze: crasht de run
          // hierna, dan gaan mails verloren i.p.v. dubbel — succeeded is een
          // terminale status, dus er komt geen recovery-run meer die mails stuurt).
          await markReceiptSucceeded(receipt.id);
        } catch (subError) {
          // Eerste betaling is gelukt, maar subscription aanmaken mislukte.
          // Receipt op failed (stage blijft staan → recovery weet waar de run
          // strandde), admin notify + 500 zodat Mollie retryt.
          // Fallback: nightly reconciliation cron probeert het ook nog.
          console.error('Failed to create subscription:', subError);
          await markReceiptFailed(receipt.id, String(subError));

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
        // Geen Mollie customer-id beschikbaar — subscription kan niet worden
        // aangemaakt. Plan wél alvast zetten (bestaand gedrag); receipt op failed
        // zodat een volgende delivery kan herclaimen zodra de customer er wel is.
        await getSupabase()
          .from('instructor_licenses')
          .update({
            billing_plan: plan,
            is_trial: false,
            price_per_month: parseFloat(PLAN_AMOUNTS[plan] || '45'),
          })
          .eq('id', license.id);
        await markReceiptFailed(receipt.id, 'no_customer_id');
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
      // B2: pre-fetch huidige license state om te controleren of de rijschool
      // inmiddels heeft opgezegd. Zo ja: dit is een onterechte incasso die
      // period_end niet meer mag verlengen (zou toegang na opzegging verlengen).
      const { data: licenseState } = await getSupabase()
        .from('instructor_licenses')
        .select('id, cancelled_at, period_end, billing_plan')
        .eq('school_id', school_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (licenseState?.cancelled_at) {
        // Opgezegd → NIET verlengen, NIET failed_payment_count resetten,
        // NIET het normale recurring_payment_paid event loggen (zou tegenstrijdig
        // zijn met _ignored). Alleen audit + admin-notify. Webhook returnt
        // sowieso 200 aan het einde (voorkomt Mollie-retry).
        console.warn(
          `Recurring payment ${paymentId} received for school ${school_id} AFTER cancellation (${licenseState.cancelled_at}) — period_end NOT extended`,
        );

        await logBillingEvent({
          school_id,
          event_type: 'recurring_payment_after_cancel_ignored',
          source: 'mollie-webhook',
          payload: {
            plan,
            payment_id: paymentId,
            cancelled_at: licenseState.cancelled_at,
            period_end_kept: licenseState.period_end,
            billing_plan: licenseState.billing_plan,
          },
        });

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
              billing_plan: licenseState.billing_plan,
              extra: {
                reason: 'unexpected_recurring_after_cancel',
                payment_id: paymentId,
                cancelled_at: licenseState.cancelled_at,
                period_end_kept: licenseState.period_end,
              },
            }).catch((e) =>
              console.error('Admin notify (unexpected_recurring_after_cancel) failed:', e),
            );
          }
        } catch (notifyErr) {
          console.error('Admin notify lookup failed:', notifyErr);
        }
      } else {
        // Normaal pad: verlengen + counter reset + bestaand billing_event.
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
