// POST /api/portal — maakt voor de ingelogde rijschoolhouder een VERSE
// Stripe Customer Portal-sessie (S4-ontwerp: Ribba authenticeert, Stripe
// host het beheer; sessies zijn efemeer, nooit een vaste portal-URL).
// Bedrading rond de bestaande stripe_customers-koppeling — geen
// Customer-aanmaak of andere billinglogica (die leeft in de edge functions).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  expectedLivemodeForKey,
  selectPortalCustomer,
  NO_CUSTOMER_MESSAGE,
  PORTAL_CONFIG_ERROR,
} from '@/lib/portal-session';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const { school_id } = (await req.json().catch(() => ({}))) as { school_id?: string };
    if (!school_id) {
      return NextResponse.json({ error: 'school_id is verplicht.' }, { status: 400 });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY ?? '';
    const mode = expectedLivemodeForKey(stripeKey);
    if (!mode.ok) {
      // Geen (herkenbare) Stripe-key op deze omgeving → fail-closed.
      return NextResponse.json({ error: PORTAL_CONFIG_ERROR }, { status: 500 });
    }

    const supabase = getSupabase();

    // Zelfde auth-conventie als /api/current-plan: Bearer-token → user →
    // actieve instructeur van precies deze rijschool.
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
    }
    const { data: { user }, error: authError } =
      await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      return NextResponse.json({ error: 'Ongeldige sessie.' }, { status: 401 });
    }
    const { data: instructor } = await supabase
      .from('instructors')
      .select('id')
      .eq('user_id', user.id)
      .eq('drivingschool_id', school_id)
      .eq('status', 'active')
      .maybeSingle();
    if (!instructor) {
      return NextResponse.json({ error: 'Geen toegang tot deze rijschool.' }, { status: 403 });
    }

    const { data: rows, error: rowsError } = await supabase
      .from('stripe_customers')
      .select('stripe_customer_id, livemode, status')
      .eq('driving_school_id', school_id);
    if (rowsError) {
      return NextResponse.json({ error: PORTAL_CONFIG_ERROR }, { status: 500 });
    }

    const decision = selectPortalCustomer(rows ?? [], mode.livemode);
    if (decision.action === 'no_customer') {
      return NextResponse.json({ error: NO_CUSTOMER_MESSAGE, reason: 'no_customer' }, { status: 409 });
    }
    if (decision.action === 'ambiguous') {
      return NextResponse.json({ error: PORTAL_CONFIG_ERROR, reason: 'ambiguous' }, { status: 500 });
    }

    const returnUrl = `${req.nextUrl.origin}/mijn-ribba`;
    const stripeRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: decision.stripeCustomerId,
        return_url: returnUrl,
      }),
    });
    const session = await stripeRes.json().catch(() => ({}));
    if (!stripeRes.ok || typeof session.url !== 'string') {
      return NextResponse.json(
        { error: 'De beheerpagina kon niet worden geopend. Probeer het opnieuw of mail team@ribba.app.' },
        { status: 502 },
      );
    }
    // Objectbewijs (zelfde principe als F4): de sessie moet in de verwachte
    // modus staan — anders weigeren, nooit stil doorlinken.
    if (session.livemode !== mode.livemode) {
      return NextResponse.json({ error: PORTAL_CONFIG_ERROR }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json(
      { error: 'Er ging iets mis. Probeer het opnieuw of mail team@ribba.app.' },
      { status: 500 },
    );
  }
}
