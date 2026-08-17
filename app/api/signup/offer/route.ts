// GET /api/signup/offer — het actuele commerciële aanbod.
//
// WAAROM DIT ENDPOINT BESTAAT. Zonder dit stond het aanbod in React:
// "1 maand gratis", "€25 per maand". Dat is dezelfde dubbele waarheid als een
// price-id-mapping, alleen in marketingtekst — en hij loopt gegarandeerd uit
// de pas zodra iemand in Stripe een bedrag of een duur wijzigt.
//
// Regel: een wijziging van €45 → €50, van 1 → 3 maanden gratis, of een nieuwe
// actie met 20% korting, moet zonder codewijziging zichtbaar worden op de
// registratiepagina.
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
// ÉÉN AANBOD, GEEN KEUZE. Sinds 16 aug is er geen plankeuze meer bij
// inschrijving — iedereen start op Premium. Dit endpoint geeft daarom één
// aanbod terug en geen lijst kaarten.
//
// FAIL-CLOSED. Kan het aanbod niet betrouwbaar worden opgehaald, dan geven we
// géén bedragen terug. Een oude hardcoded prijs tonen zou erger zijn dan niets
// tonen: dan schrijft iemand zich in op een bedrag dat niet klopt.

import { NextRequest, NextResponse } from 'next/server';
import { INSCHRIJFPLAN } from '@/lib/signup-plan';
import { resolveSignupOffer } from '@/lib/signup-offer';
import { maakOfferDeps } from '@/lib/signup-offer-deps';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let deps: ReturnType<typeof maakOfferDeps>;
  try {
    deps = maakOfferDeps();
  } catch {
    return NextResponse.json({ beschikbaar: false, reden: 'stripe_not_configured' }, { status: 200 });
  }

  const code = request.nextUrl.searchParams.get('code');
  const aanbod = await resolveSignupOffer(deps, INSCHRIJFPLAN, { promoCode: code });

  if (!aanbod.ok) {
    return NextResponse.json(
      { beschikbaar: false, reden: aanbod.reason, plan: INSCHRIJFPLAN },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      beschikbaar: true,
      plan: aanbod.plan,
      bedragen: aanbod.bedragen,
      /** 0 tijdens een gratis periode. Dit hoort visueel het prominentst. */
      vandaagVerschuldigdCenten: aanbod.vandaagVerschuldigdCenten,
      /** Gevuld bij het standaardaanbod; null wanneer een actie het overneemt. */
      trial: aanbod.trial,
      /** Gevuld bij een actie; sluit `trial` uit. Bevat de zin voor het scherm. */
      korting: aanbod.korting
        ? { code: aanbod.korting.code, tekst: aanbod.korting.tekst }
        : null,
      /** Welke code daadwerkelijk is toegepast; null bij het standaardaanbod. */
      promoToegepast: aanbod.korting?.code ?? null,
      /** Er is een code ingevuld die niet geldig bleek. Het aanbod staat wel. */
      promoGeweigerd: aanbod.promoGeweigerd,
    },
    { status: 200 },
  );
}
