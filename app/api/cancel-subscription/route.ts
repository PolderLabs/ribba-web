import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { logBillingEvent } from '@/lib/billing-events';

// Stripe-statussen die als ACTIEF abonnement tellen. Bewust op de ACTUELE
// status (niet "er bestaat ooit een Stripe-rij"): historische of geannuleerde
// Stripe-data mag het Stripe-pad niet kiezen.
const ACTIVE_STRIPE_STATUSES = ['incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused'];

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
    // worden doorgevallen naar een ander pad — stoppen, loggen, generieke 500.
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

    // Geen actief Stripe-abonnement. Sinds 25 aug 2026 is dat het enige
    // overgebleven geval: het Mollie-pad is verwijderd toen er nul Mollie-SaaS-
    // abonnees over waren (0 van 14 licenties met een `mollie_customer_id`,
    // 0 van 81 facturen met een `mollie_invoice_id`).
    //
    // Leerlingbetalingen via Mollie — rijschool naar leerling — staan hier
    // volledig los van en zijn ongemoeid gebleven.
    return NextResponse.json({ error: 'Geen actief abonnement gevonden.' }, { status: 404 });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return NextResponse.json({ error: 'Er ging iets mis bij het annuleren.' }, { status: 500 });
  }
}
