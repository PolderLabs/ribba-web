// GET /api/signup/offer — het actuele commerciële aanbod.
//
// WAAROM DIT ENDPOINT BESTAAT. Zonder dit stond het aanbod in React:
// "1 maand gratis", "€25 per maand". Dat is dezelfde dubbele waarheid als een
// price-id-mapping, alleen in marketingtekst — en hij loopt gegarandeerd uit
// de pas zodra iemand in Stripe een bedrag of een duur wijzigt.
//
// Regel: een wijziging van €25 → €30, of van 1 → 3 maanden gratis, moet
// zonder codewijziging zichtbaar worden op de registratiepagina.
//
// DE BROWSER REKENT NIETS. Bedragen, btw, "vandaag €0", de zin "6 maanden
// gratis" en de datum van de eerste incasso komen alle vijf hiervandaan. Zou
// de pagina zelf 21% erbij rekenen of uit `aantal` een zin bouwen, dan is er
// weer een tweede plek waar het aanbod ontstaat.
//
// EN HET IS DEZELFDE FUNCTIE als `/api/signup/start` gebruikt. Dat is geen
// nette gewoonte maar de garantie: het scherm kan niets tonen wat Checkout
// niet krijgt.
//
// FAIL-CLOSED. Kan het aanbod niet betrouwbaar worden opgehaald, dan geven we
// géén bedragen terug. Een oude hardcoded prijs tonen zou erger zijn dan niets
// tonen: dan schrijft iemand zich in op een bedrag dat niet klopt.

import { NextRequest, NextResponse } from 'next/server';
import { SIGNUP_PLANS, type SignupPlan } from '@/lib/signup-plan';
import { resolveSignupOffer, type Bedragen, type TrialWeergave } from '@/lib/signup-offer';
import { maakOfferDeps } from '@/lib/signup-offer-deps';
import { PLAN_FEATURES } from '@/lib/plan-features';

export const dynamic = 'force-dynamic';

type AanbodKaart = {
  plan: SignupPlan;
  naam: string;
  samenvatting: string;
  punten: string[];
  /** Uit Stripe; netto is de prijs die we communiceren, bruto staat eronder. */
  bedragen: Bedragen;
  /** 0 tijdens een gratis periode. Dit hoort visueel het prominentst. */
  vandaagVerschuldigdCenten: number;
  /** null = geldig aanbod zonder gratis periode. */
  trial: TrialWeergave | null;
};

export async function GET(request: NextRequest) {
  let deps: ReturnType<typeof maakOfferDeps>;
  try {
    deps = maakOfferDeps();
  } catch {
    return NextResponse.json({ beschikbaar: false, reden: 'stripe_not_configured' }, { status: 200 });
  }

  const code = request.nextUrl.searchParams.get('code');

  // Eén moment voor alle kaarten. Anders kan Basic net over een dagovergang
  // vallen en Premium niet, en verschillen de getoonde einddatums een dag.
  const nu = new Date();

  const kaarten: AanbodKaart[] = [];
  let promoGeweigerd = false;
  let promoToegepast: string | null = null;

  for (const plan of SIGNUP_PLANS) {
    const aanbod = await resolveSignupOffer(deps, plan, { promoCode: code, nu });
    if (!aanbod.ok) {
      // Eén kapot aanbod maakt de hele pagina onbetrouwbaar: dan weet de
      // bezoeker niet of het andere plan wél klopt. Alles of niets.
      return NextResponse.json({ beschikbaar: false, reden: aanbod.reason, plan }, { status: 200 });
    }

    if (aanbod.promoGeweigerd) promoGeweigerd = true;
    if (aanbod.trial?.viaPromocode) promoToegepast = aanbod.trial.viaPromocode;

    const kenmerken = PLAN_FEATURES[plan];
    kaarten.push({
      plan,
      naam: kenmerken.naam,
      samenvatting: kenmerken.samenvatting,
      punten: kenmerken.punten,
      bedragen: aanbod.bedragen,
      vandaagVerschuldigdCenten: aanbod.vandaagVerschuldigdCenten,
      trial: aanbod.trial,
    });
  }

  return NextResponse.json(
    {
      beschikbaar: true,
      kaarten,
      /** Welke code daadwerkelijk is toegepast; null bij het standaardaanbod. */
      promoToegepast,
      /** Er is een code ingevuld die niet geldig bleek. Het aanbod staat wel. */
      promoGeweigerd,
    },
    { status: 200 },
  );
}
