import { NextRequest, NextResponse } from 'next/server';
import { createMollieClient } from '@mollie/api-client';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { sendAdminNotification } from '@/lib/admin-notifications';
import { logBillingEvent } from '@/lib/billing-events';

// Stripe-statussen die als ACTIEF abonnement tellen. Bewust op de ACTUELE
// status (niet "er bestaat ooit een Stripe-rij"): historische of geannuleerde
// Stripe-data mag het Stripe-pad niet kiezen.
const ACTIVE_STRIPE_STATUSES = ['incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused'];

function getMollie() {
  return createMollieClient({ apiKey: process.env.MOLLIE_API_KEY! });
}

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`cancel:${ip}`, { maxRequests: 5, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, { status: 429 });
  }

  try {
    const { school_id } = await request.json();
    if (!school_id) {
      return NextResponse.json({ error: 'school_id is verplicht.' }, { status: 400 });
    }

    // Verify the caller owns this school
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
    }
    const supabase = getSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      return NextResponse.json({ error: 'Ongeldige sessie.' }, { status: 401 });
    }
    // Toegang ÉN bevoegdheid: EIGENAAR-ONLY (fase 2a, productbesluit 27 jul).
    // Opzeggen beëindigt een verplichting van de ondernemíng; dat is geen
    // dagelijkse bedrijfsvoering. Was owner|admin (fase 0), mogelijk gemaakt
    // door migratie B (28 jul), die elke rijschool een eigenaar gaf.
    // Zie docs/design/schoollicentie-epic-canoniek-plan-2026-07-25.md in ribbaPro.
    const { data: instructor } = await supabase
      .from('instructors')
      .select('id')
      .eq('user_id', user.id)
      .eq('drivingschool_id', school_id)
      .eq('status', 'active')
      .eq('school_role', 'owner')
      .maybeSingle();
    if (!instructor) {
      return NextResponse.json(
        {
          error: 'Alleen de eigenaar van deze rijschool kan het abonnement opzeggen.',
          reason: 'subscription_management_forbidden',
        },
        { status: 403 },
      );
    }

    // Provider-bepaling op de ACTUELE actieve Stripe-status (niet "ooit een rij").
    // Fail closed: bij een queryfout mag NIET met onbetrouwbare providerdata
    // worden doorgevallen naar Mollie of Stripe — stoppen, loggen, generieke 500.
    const { data: activeStripe, error: activeStripeError } = await supabase
      .from('school_subscriptions')
      .select('id')
      .eq('school_id', school_id)
      .in('stripe_status', ACTIVE_STRIPE_STATUSES)
      .limit(1);
    if (activeStripeError) {
      await logBillingEvent({
        school_id,
        event_type: 'cancel_provider_lookup_failed',
        source: 'cancel-subscription',
        payload: { query: 'school_subscriptions', error: String(activeStripeError.message ?? activeStripeError).slice(0, 300) },
      });
      return NextResponse.json({ error: 'Kon de abonnementsstatus niet bepalen. Probeer het later opnieuw.' }, { status: 500 });
    }
    const hasActiveStripe = (activeStripe?.length ?? 0) > 0;

    // Actieve licentie — nodig voor de Mollie-tak én de conflictdetectie.
    const { data: license, error: licenseError } = await supabase
      .from('instructor_licenses')
      .select('id, mollie_customer_id, external_subscription_id, billing_plan')
      .eq('school_id', school_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (licenseError) {
      await logBillingEvent({
        school_id,
        event_type: 'cancel_provider_lookup_failed',
        source: 'cancel-subscription',
        payload: { query: 'instructor_licenses', error: String(licenseError.message ?? licenseError).slice(0, 300) },
      });
      return NextResponse.json({ error: 'Kon de abonnementsstatus niet bepalen. Probeer het later opnieuw.' }, { status: 500 });
    }
    const hasMollie = Boolean(license?.mollie_customer_id && license?.external_subscription_id);

    // Fail closed: twee actieve providers tegelijk → niets opzeggen, conflict loggen.
    if (hasActiveStripe && hasMollie) {
      await logBillingEvent({
        school_id,
        event_type: 'cancel_provider_conflict',
        source: 'cancel-subscription',
        payload: {
          billing_plan: license?.billing_plan ?? null,
          note: 'active Stripe subscription AND Mollie identifiers present — manual review required',
        },
      });
      return NextResponse.json(
        { error: 'Abonnementsstatus onduidelijk. Neem contact op met support.' },
        { status: 409 },
      );
    }

    // Stripe-pad: autoritatief delegeren naar de bestaande edge function in
    // ribbaPro. GEEN Stripe-logica of -secret hier; de user-JWT gaat mee en de
    // edge function controleert zelf auth + eigenaarschap en zet cancel_at
    // (opzeggen per einde betaalde periode, nooit direct).
    if (hasActiveStripe) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      // Begrensde timeout: een trage/hangende edge function mag deze handler niet
      // onbegrensd blokkeren. Timer wordt altijd in finally opgeruimd.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);
      try {
        const edgeRes = await fetch(`${supabaseUrl}/functions/v1/stripe-cancel-subscription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({ school_id }),
          signal: controller.signal,
        });
        const edgeData = await edgeRes.json().catch(() => ({}));
        if (!edgeRes.ok) {
          return NextResponse.json(
            { error: edgeData?.error ?? 'Kon het abonnement niet opzeggen.' },
            { status: edgeRes.status },
          );
        }
        return NextResponse.json({ success: true, provider: 'stripe', ...edgeData });
      } catch (edgeErr) {
        // Time-out of netwerkfout richting de edge function → fail closed, er is
        // NIETS lokaal gemuteerd. De fout zit downstream → 504 (time-out) / 502.
        const isTimeout = edgeErr instanceof Error && edgeErr.name === 'AbortError';
        await logBillingEvent({
          school_id,
          event_type: 'stripe_cancel_delegation_unreachable',
          source: 'cancel-subscription',
          payload: { reason: isTimeout ? 'timeout' : 'fetch_error', error: String(edgeErr).slice(0, 300) },
        });
        return NextResponse.json(
          { error: 'De opzegverwerking is tijdelijk niet bereikbaar. Probeer het later opnieuw.' },
          { status: isTimeout ? 504 : 502 },
        );
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Geen enkel actief abonnement (geen live Stripe-sub én geen Mollie-koppeling).
    // Directe null-narrowing (semantisch = !hasMollie) zodat `license` in de
    // Mollie-tak non-null is.
    if (!license?.mollie_customer_id || !license?.external_subscription_id) {
      return NextResponse.json({ error: 'Geen actief abonnement gevonden.' }, { status: 404 });
    }

    // ── Mollie-pad — TIJDELIJK ────────────────────────────────────────────────
    // Blijft uitsluitend voor de resterende Mollie-SaaS-abonnee(s) en wordt
    // verwijderd zodra er NUL actieve Mollie-SaaS-abonnees zijn (aparte migratie).
    // Leerlingbetalingen via Mollie (rijschool → leerling) staan hier volledig
    // los van en blijven ongemoeid.
    //
    // Cancel the Mollie subscription — no more charges will happen.
    // Mollie does not automatically end the current period; the plan stays active
    // until we mark it ended based on the stored next billing date.
    //
    // B3: bij een NIET-recoverable Mollie-fail moeten we NIET stil verder gaan
    // naar de DB-update. Anders zou user "opgezegd" te zien krijgen terwijl de
    // Mollie-subscription doorloopt en volgende maand incasseert. Onderscheid:
    //   - statusCode 410 (Mollie's "Gone" voor al gecancelde sub) → idempotent OK
    //   - message-match "already"/"canceled" als fallback wanneer statusCode ontbreekt
    //   - alle overige errors → 500 + billing_event + admin-notify, GEEN DB-update
    try {
      await getMollie().customerSubscriptions.cancel(license.external_subscription_id, {
        customerId: license.mollie_customer_id,
      });
    } catch (cancelErr) {
      const statusCode =
        cancelErr && typeof cancelErr === 'object' && 'statusCode' in cancelErr
          ? (cancelErr as { statusCode?: unknown }).statusCode
          : undefined;
      const message = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
      const messageLower = message.toLowerCase();

      // Strict detectie:
      //   1. statusCode 410 (Gone) OF 422 (Unprocessable Entity) = idempotent succes.
      //      Mollie retourneert in de praktijk 422 met bericht "The subscription
      //      has been cancelled" wanneer je een reeds gecancelde sub opnieuw
      //      probeert te cancelen (docs.mollie.com/reference/handling-errors +
      //      diverse mollie-api-client issues).
      //   2. Message-match ALLEEN als fallback wanneer statusCode ontbreekt.
      //   3. Bij twijfel: behandelen als echte failure.
      const isAlreadyCancelled =
        statusCode === 410 ||
        statusCode === 422 ||
        (statusCode === undefined &&
          (messageLower.includes('already') || messageLower.includes('canceled')));

      if (!isAlreadyCancelled) {
        // Echte failure: DB NIET updaten, endpoint 500, alarm richting admin.
        console.error('Mollie cancel failed (non-recoverable):', cancelErr);

        const errStr = message.slice(0, 500);
        await logBillingEvent({
          school_id,
          event_type: 'subscription_cancel_failed',
          source: 'cancel-subscription',
          payload: {
            billing_plan: license.billing_plan,
            external_subscription_id: license.external_subscription_id,
            mollie_customer_id: license.mollie_customer_id,
            mollie_status_code: typeof statusCode === 'number' ? statusCode : null,
            error: errStr,
          },
        });

        try {
          const { data: schoolRow } = await supabase
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
              billing_plan: license.billing_plan,
              extra: {
                reason: 'cancel_failed',
                external_subscription_id: license.external_subscription_id,
                mollie_customer_id: license.mollie_customer_id,
                mollie_status_code:
                  typeof statusCode === 'number' ? String(statusCode) : null,
                error: errStr,
              },
            }).catch((e) => console.error('Admin notify (cancel_failed) failed:', e));
          }
        } catch (notifyErr) {
          console.error('Admin notify lookup failed:', notifyErr);
        }

        return NextResponse.json(
          { error: 'Er ging iets mis bij het annuleren. Probeer het opnieuw.' },
          { status: 500 },
        );
      }

      // Idempotent succes: subscription was al gecanceld bij Mollie. Doorlopen
      // naar de DB-update alsof de cancel-call zojuist succesvol was.
      console.warn(
        `Mollie subscription ${license.external_subscription_id} was already cancelled — treating as idempotent success`,
      );
    }

    // Mark the license as cancelled (still active until the end of the paid period).
    // `cancelled_at` = when cancellation was requested. The monthly job or webhook
    // should downgrade access once the current paid period ends.
    await supabase
      .from('instructor_licenses')
      .update({
        cancelled_at: new Date().toISOString(),
        external_subscription_id: null,
      })
      .eq('id', license.id);

    await logBillingEvent({
      school_id,
      event_type: 'subscription_cancelled',
      source: 'cancel-subscription',
      payload: {
        billing_plan: license.billing_plan,
        cancelled_external_subscription_id: license.external_subscription_id,
        mollie_customer_id: license.mollie_customer_id,
      },
    });

    // Admin notification — fire-and-forget
    try {
      const { data: schoolRow } = await supabase
        .from('drivingschools')
        .select('name, email, city')
        .eq('id', school_id)
        .maybeSingle();
      if (schoolRow) {
        sendAdminNotification('subscription_cancelled', {
          id: school_id,
          name: schoolRow.name,
          email: schoolRow.email,
          city: schoolRow.city,
          billing_plan: license.billing_plan,
        }).catch((e) => console.error('Admin notify (subscription_cancelled) failed:', e));
      }
    } catch (e) {
      console.error('Admin notify lookup failed:', e);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return NextResponse.json({ error: 'Er ging iets mis bij het annuleren.' }, { status: 500 });
  }
}
