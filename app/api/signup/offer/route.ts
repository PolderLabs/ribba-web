// GET /api/signup/offer — het actuele commerciële aanbod, fase 3B.3.
//
// WAAROM DIT ENDPOINT BESTAAT. Zonder dit stond het aanbod in React:
// "1 maand gratis", "€25 per maand". Dat is dezelfde dubbele waarheid als een
// price-id-mapping, alleen in marketingtekst — en hij loopt gegarandeerd uit
// de pas zodra iemand in Stripe een bedrag of een trial wijzigt.
//
// Regel: een wijziging van €25 → €30, of van 1 → 3 maanden gratis, moet
// zonder codewijziging zichtbaar worden op de registratiepagina.
//
// De kaart is een COMBINATIE van twee bronnen die bewust gescheiden blijven:
//
//   Stripe → bedrag, valuta, interval, gratis periode
//   Ribba  → wat Basic en Premium functioneel mogen (lib/plan-features.ts)
//
// FAIL-CLOSED. Kan het aanbod niet betrouwbaar worden opgehaald, dan geven we
// géén bedragen terug en valt de pagina terug op een eerlijke melding. Een
// oude hardcoded prijs tonen zou erger zijn dan niets tonen: dan schrijft
// iemand zich in op een bedrag dat niet klopt.

import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { SIGNUP_PLANS, type SignupPlan } from '@/lib/signup-plan';
import { resolveSignupOffer } from '@/lib/signup-offer';
import { PLAN_FEATURES } from '@/lib/plan-features';

export const dynamic = 'force-dynamic';

type AanbodKaart = {
  plan: SignupPlan;
  naam: string;
  samenvatting: string;
  punten: string[];
  /** Bruto maandbedrag in centen, uit Stripe. */
  bedragCenten: number;
  valuta: string;
  interval: string;
  /** Aantal gratis dagen uit Stripe-metadata; null = direct betalen. */
  gratisDagen: number | null;
};

export async function GET() {
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json({ beschikbaar: false, reden: 'stripe_not_configured' }, { status: 200 });
  }

  const kaarten: AanbodKaart[] = [];

  for (const plan of SIGNUP_PLANS) {
    const aanbod = await resolveSignupOffer(stripe, plan);
    if (!aanbod.ok) {
      // Eén kapot aanbod maakt de hele pagina onbetrouwbaar: dan weet de
      // bezoeker niet of het andere plan wél klopt. Alles of niets.
      return NextResponse.json(
        { beschikbaar: false, reden: aanbod.reason, plan },
        { status: 200 },
      );
    }

    let prijs;
    try {
      prijs = await stripe.prices.retrieve(aanbod.priceId);
    } catch {
      return NextResponse.json({ beschikbaar: false, reden: 'price_not_found', plan }, { status: 200 });
    }

    const bedrag = prijs.unit_amount;
    if (typeof bedrag !== 'number') {
      // Bijvoorbeeld een tiered price. Geen bedrag om te tonen ⇒ niet tonen.
      return NextResponse.json({ beschikbaar: false, reden: 'price_without_amount', plan }, { status: 200 });
    }

    const kenmerken = PLAN_FEATURES[plan];
    kaarten.push({
      plan,
      naam: kenmerken.naam,
      samenvatting: kenmerken.samenvatting,
      punten: kenmerken.punten,
      bedragCenten: bedrag,
      valuta: (prijs.currency ?? 'eur').toUpperCase(),
      interval: prijs.recurring?.interval ?? 'month',
      gratisDagen: aanbod.trialDays,
    });
  }

  return NextResponse.json({ beschikbaar: true, kaarten }, { status: 200 });
}
