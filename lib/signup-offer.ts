// Het aanbod bij een inschrijving — één resolver voor scherm én Checkout.
//
// Ontwerp: ribbaPro docs/design/mandaat-bij-inschrijving-2026-08-09.md,
// §7e + besluit 10 (16 aug 2026).
//
// ── WAAROM DIT ÉÉN FUNCTIE IS ───────────────────────────────────────────────
//
// Eis Önder: `/api/signup/offer` en `/api/signup/start` gebruiken exact deze
// functie. Daardoor kán de pagina geen ander aanbod tonen dan wat Checkout
// krijgt — niet omdat we dat afspreken, maar omdat er maar één plek is waar
// een aanbod ontstaat.
//
// `start` roept hem opnieuw aan vlak vóór Checkout. Wat de browser eerder van
// `offer` kreeg is weergave, nooit invoer: bedragen en datums uit een client
// zijn een suggestie van iemand anders.
//
// ── DRIE BRONNEN, STRIKT GESCHEIDEN ─────────────────────────────────────────
//
//   ROUTING      welke Price → de lookup key `<plan>_standaard`
//   ENTITLEMENT  welke rechten → UITSLUITEND `plan`-metadata op de Price
//   GRATIS       hoe lang / hoeveel → `trial_interval` op de Price voor het
//                standaardaanbod, of een Coupon voor een campagne
//
// ── WAAROM EEN LOOKUP KEY EN GEEN PRICE-ID ──────────────────────────────────
//
// Een bedrag op een Stripe-Price is ONVERANDERLIJK. Van €45 naar €50 betekent
// dus altijd een NIEUWE Price met een nieuw id. Stond dat id in een
// omgevingsvariabele, dan moest die bij elke prijswijziging worden omgezet —
// één handeling in Ribba bij een besluit dat alleen over Stripe gaat, en
// precies het soort stap dat je vergeet.
//
// Een lookup key is een naam die JIJ aan een Price hangt. Bij een prijswijziging
// versleep je de naam in Stripe naar de nieuwe Price; hier verandert niets.
// Geen variabele, geen deploy, geen handeling. En een nieuw pakket heeft geen
// eigen variabele nodig: de naam volgt uit de plannaam.
//
// De naam is routing en nooit een bron van rechten — die komen uit
// `plan`-metadata, en G5 hieronder bewaakt dat ze overeenkomen.
//
// ── TWEE MECHANISMEN, DIE ELKAAR UITSLUITEN ─────────────────────────────────
//
//   standaard  → trial. `subscription_data.trial_end`, status `trialing`,
//                Stripe's eigen herinneringsmail vóór de eerste incasso.
//   campagne   → coupon. `discounts: [{promotion_code}]`, status `active`.
//
// EEN CAMPAGNE VERVANGT DE TRIAL, HIJ STAPELT ER NIET OP. Zouden ze allebei
// meegaan, dan is STARTGRATIS zeven maanden gratis in plaats van zes: eerst de
// standaardmaand als trial, daarna pas de zes couponmaanden. Dat is precies de
// klasse fout waar niemand op let tot de eerste factuur.
//
// ── POORTEN ─────────────────────────────────────────────────────────────────
//
// G5      een Price zonder geldige, PASSENDE `plan`-metadata wordt geweigerd.
//         De fout strandt dan bij ons vóór het mandaat, in plaats van erna bij
//         een klant die getekend heeft en niets krijgt.
//
// NULPRIJS  een terugkerende Price van €0 wordt geweigerd bij inschrijving.
//         Eén verwisselde secret zou anders een rijschool voor altijd gratis
//         laten draaien — mét werkend entitlement, dus onzichtbaar in de
//         cijfers.
//
// BTW     `tax_behavior` moet expliciet zijn. Op `unspecified` weigert Stripe
//         de Checkout wanneer automatische btw aanstaat.
//
// COUPON  een code die bestaat maar waarvan de coupon niet leesbaar of niet
//         geldig is, is ONZE configuratiefout en wordt zichtbaar geweigerd —
//         niet stil teruggezet naar het standaardaanbod. Iemand met een
//         geldige code hoort nooit minder te krijgen dan beloofd.

import type Stripe from 'stripe';
import { PLAN_METADATA_KEY, isSignupPlan, type SignupPlan } from '@/lib/signup-plan';
import { VAT_RATE_PERCENT } from '@/lib/plan-pricing';
import {
  MINIMALE_TRIAL_SECONDEN,
  parseTrialInterval,
  trialEinde,
  trialTekst,
  type TrialInterval,
} from '@/lib/trial-interval';

/** Metadatasleutel voor de standaardduur van de gratis periode. */
export const TRIAL_INTERVAL_METADATA_KEY = 'trial_interval';

export type OfferFailure =
  | 'price_not_found'           // geen actieve Price met deze lookup key
  | 'price_zoekfout'            // Stripe weigerde de vraag (modus, rechten, storing)
  | 'price_inactive'            // gearchiveerde Price
  | 'price_not_recurring'       // eenmalig bedrag; geen abonnement
  | 'price_without_amount'      // bv. tiered pricing: geen bedrag om te tonen
  | 'price_zero_amount'         // nulprijs-poort
  | 'tax_behavior_unspecified'  // Checkout weigert dit bij automatische btw
  | 'plan_metadata_missing'     // G5
  | 'plan_metadata_invalid'     // G5
  | 'plan_metadata_mismatch'    // G5
  | 'trial_interval_invalid'    // configuratiefout in de standaardduur
  | 'trial_te_kort'             // < 48 uur; Stripe zou weigeren
  | 'coupon_onbruikbaar';       // code bestaat, coupon deugt niet

/** Wat de klant vandaag en straks betaalt. Alles in hele centen. */
export type Bedragen = {
  /** Uit Stripe. De commerciële prijs die we communiceren. */
  nettoCenten: number;
  /** Berekend met het wettelijke tarief; Stripe rekent bij Checkout definitief. */
  btwCenten: number;
  brutoCenten: number;
  btwTariefPercent: number;
  valuta: string;
  /** `month`, `year`, … uit de Price. */
  interval: string;
};

export type TrialWeergave = {
  aantal: number;
  eenheid: 'month' | 'day';
  /** Afgeronde zin, server-gerenderd: "1 maand gratis". */
  tekst: string;
  /** Wanneer de eerste incasso valt. */
  eersteIncassoISO: string;
  /** Precies wat als `subscription_data.trial_end` naar Checkout gaat. */
  trialEndUnix: number;
};

/** Wat Stripe over de coupon achter een promotiecode vertelt. */
export type CouponFeiten = {
  percentOff: number | null;
  amountOffCenten: number | null;
  duur: 'once' | 'repeating' | 'forever';
  /** Alleen gevuld bij `repeating`. */
  duurMaanden: number | null;
  valuta: string | null;
};

export type KortingWeergave = {
  /** Zoals Stripe de code kent. Gaat zo de pending-registratie op. */
  code: string;
  /** Gaat als `discounts: [{promotion_code}]` naar Checkout. */
  promotionCodeId: string;
  coupon: CouponFeiten;
  /** Server-gerenderd: "6 maanden gratis" / "20% korting, 3 maanden". */
  tekst: string;
};

export type Offer = {
  plan: SignupPlan;
  priceId: string;
  bedragen: Bedragen;
  /**
   * Wat er vandaag daadwerkelijk wordt afgeschreven. 0 bij een trial én bij
   * een coupon van 100%. Bij een gedeeltelijke korting het restbedrag —
   * anders zou het scherm €0 tonen terwijl er wel degelijk geïncasseerd wordt.
   */
  vandaagVerschuldigdCenten: number;
  /** null wanneer een campagne de trial vervangt, of bij direct betalen. */
  trial: TrialWeergave | null;
  /** null bij het standaardaanbod. Sluit `trial` uit. */
  korting: KortingWeergave | null;
  /**
   * True als er een code werd meegegeven die niet geldig bleek. Het aanbod
   * staat dan gewoon (met de standaardtrial) — een verkeerd getypte code mag
   * geen inschrijving blokkeren, maar mag ook nooit stilzwijgend als campagne
   * op de registratie belanden.
   */
  promoGeweigerd: boolean;
};

export type OfferResult =
  | ({ ok: true } & Offer)
  | { ok: false; reason: OfferFailure; detail?: string };

/**
 * Uitkomst van het opzoeken van een promotiecode bij Stripe.
 *
 * Geeft bewust geen reden terug: onbekend, inactief, verlopen en uitgeput zien
 * er identiek uit. Anders is dit een orakel waarmee je codes kunt aftasten.
 */
export type PromoResolutie =
  | { geldig: true; code: string; promotionCodeId: string; coupon: CouponFeiten }
  /** De code bestaat en is actief, maar de coupon eronder deugt niet. */
  | { geldig: false; configuratiefout: string }
  | { geldig: false; configuratiefout?: undefined };

export type OfferDeps = {
  stripe: Pick<Stripe, 'prices'>;
  /** Slaat Stripe aan. Alleen aangeroepen als er een code is ingevuld. */
  valideerPromo(code: string): Promise<PromoResolutie>;
};

export type OfferOpties = {
  promoCode?: string | null;
  /** Injecteerbaar zodat de kalenderrekensom testbaar is. */
  nu?: Date;
};

/**
 * Routing: onder welke naam staat de standaardprijs van dit plan in Stripe.
 *
 * Afgeleid van de plannaam, niet uit een lijst of een variabele — dan hoeft er
 * bij een nieuw pakket niets aan deze kant bij. Géén entitlementbetekenis: dat
 * blijft `plan`-metadata op de Price, bewaakt door G5.
 */
export function lookupKeyForPlan(plan: SignupPlan): string {
  return `${plan}_standaard`;
}

/** De standaardduur zoals die op de Price staat. */
export function trialIntervalUitPrice(
  price: { metadata?: Record<string, string> | null },
): { aanwezig: false } | { aanwezig: true; interval: TrialInterval | null } {
  const raw = price?.metadata?.[TRIAL_INTERVAL_METADATA_KEY];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { aanwezig: false };
  }
  return { aanwezig: true, interval: parseTrialInterval(raw) };
}

function berekenBedragen(price: Stripe.Price): Bedragen | OfferFailure {
  const bedrag = price.unit_amount;
  if (typeof bedrag !== 'number') return 'price_without_amount';
  if (bedrag <= 0) return 'price_zero_amount';

  const gedrag = price.tax_behavior;
  if (gedrag !== 'exclusive' && gedrag !== 'inclusive') {
    return 'tax_behavior_unspecified';
  }

  // Het tarief komt uit plan-pricing (ADR 2026-07-12). Dat is wetgeving, geen
  // commerciële keuze, en het staat er al — een tweede constante zou een
  // tweede waarheid zijn. Het BEDRAG komt wél uit Stripe.
  const nettoCenten = gedrag === 'exclusive'
    ? bedrag
    : Math.round((bedrag * 100) / (100 + VAT_RATE_PERCENT));
  const brutoCenten = gedrag === 'inclusive'
    ? bedrag
    : nettoCenten + Math.round((nettoCenten * VAT_RATE_PERCENT) / 100);

  return {
    nettoCenten,
    btwCenten: brutoCenten - nettoCenten,
    brutoCenten,
    btwTariefPercent: VAT_RATE_PERCENT,
    valuta: (price.currency ?? 'eur').toUpperCase(),
    interval: price.recurring?.interval ?? 'month',
  };
}

/**
 * Wat er ná de korting overblijft, inclusief btw.
 *
 * Stripe past een korting toe op het SUBTOTAAL en berekent de btw daarna. Deze
 * functie doet hetzelfde, zodat het scherm niet iets anders zegt dan de eerste
 * factuur. Stripe blijft de bron: dit is weergave.
 */
export function restbedragCenten(bedragen: Bedragen, coupon: CouponFeiten): number {
  const netto = bedragen.nettoCenten;

  let nettoNaKorting: number;
  if (typeof coupon.percentOff === 'number') {
    // 100% is het normale geval bij onze campagnes; het rondt exact op 0 uit.
    nettoNaKorting = Math.round((netto * (100 - coupon.percentOff)) / 100);
  } else if (typeof coupon.amountOffCenten === 'number') {
    nettoNaKorting = Math.max(0, netto - coupon.amountOffCenten);
  } else {
    // Een coupon zonder percentage én zonder bedrag korting niets. Dan is het
    // volle bedrag verschuldigd; de aanroeper heeft dit al als
    // configuratiefout kunnen weigeren.
    nettoNaKorting = netto;
  }

  if (nettoNaKorting <= 0) return 0;
  return nettoNaKorting + Math.round((nettoNaKorting * bedragen.btwTariefPercent) / 100);
}

function maandenTekst(aantal: number): string {
  return aantal === 1 ? '1 maand' : `${aantal} maanden`;
}

/** De zin die het scherm toont. Server-gerenderd, nooit uit de browser. */
export function kortingTekst(coupon: CouponFeiten): string {
  const volledig = coupon.percentOff === 100;

  let periode: string;
  if (coupon.duur === 'forever') periode = 'blijvend';
  else if (coupon.duur === 'once') periode = 'de eerste maand';
  else periode = maandenTekst(coupon.duurMaanden ?? 1);

  if (volledig) {
    if (coupon.duur === 'forever') return 'blijvend gratis';
    if (coupon.duur === 'once') return 'de eerste maand gratis';
    return `${maandenTekst(coupon.duurMaanden ?? 1)} gratis`;
  }

  const hoeveel = typeof coupon.percentOff === 'number'
    ? `${coupon.percentOff}% korting`
    : `€ ${((coupon.amountOffCenten ?? 0) / 100).toFixed(2).replace('.', ',')} korting`;

  return `${hoeveel}, ${periode}`;
}

/**
 * Bepaalt het volledige aanbod.
 *
 * Faalt hij, dan wordt er GEEN Checkout aangemaakt en geen pending registratie
 * afgerond — liever hier stoppen dan een klant laten tekenen voor iets wat we
 * daarna niet kunnen leveren.
 */
export async function resolveSignupOffer(
  deps: OfferDeps,
  plan: SignupPlan,
  opties: OfferOpties = {},
): Promise<OfferResult> {
  const nu = opties.nu ?? new Date();
  const lookupKey = lookupKeyForPlan(plan);

  // `active: true` staat er bewust bij. Een lookup key is uniek onder ACTIEVE
  // prijzen; wordt een prijs gearchiveerd, dan komt de naam vrij voor zijn
  // opvolger. Zonder dit filter zou een oude, gearchiveerde prijs met dezelfde
  // naam kunnen terugkomen — met het oude bedrag.
  // De fout van Stripe wordt NIET weggegooid.
  //
  // Hier stond één `catch` die alles op `price_not_found` gooide. Daardoor
  // zagen drie verschillende oorzaken er identiek uit: een testmodus-sleutel
  // (waar deze naam niet bestaat), een sleutel zonder leesrecht op prijzen, en
  // een naam die echt nergens op wijst. Bij het eerste echte gebruik kostte dat
  // een ronde heen en weer om te achterhalen welke van de drie het was.
  //
  // `zoekfout` gaat mee in `detail`, en `detail` staat in de serverlog én in
  // het antwoord van /api/signup/offer. Dat is geen gevoelige informatie: het
  // is de eigen configuratie, geen klantgegeven.
  let price: Stripe.Price | undefined;
  try {
    const lijst = await deps.stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    price = lijst.data[0];
  } catch (e) {
    const boodschap = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: 'price_zoekfout', detail: `${lookupKey}: ${boodschap}` };
  }
  if (!price) {
    // Geen fout, gewoon geen resultaat: de sleutel werkt, maar in deze
    // Stripe-modus bestaat er geen actieve prijs met deze naam.
    return { ok: false, reason: 'price_not_found', detail: lookupKey };
  }

  const priceId = price.id;
  if (price.active === false) return { ok: false, reason: 'price_inactive', detail: priceId };
  if (!price.recurring) return { ok: false, reason: 'price_not_recurring', detail: priceId };

  // ── G5 ──────────────────────────────────────────────────────────────────
  const rawPlan = price.metadata?.[PLAN_METADATA_KEY];
  if (rawPlan === undefined || rawPlan === null || String(rawPlan).trim() === '') {
    return { ok: false, reason: 'plan_metadata_missing', detail: priceId };
  }
  const genormaliseerd = String(rawPlan).trim().toLowerCase();
  if (!isSignupPlan(genormaliseerd)) {
    return { ok: false, reason: 'plan_metadata_invalid', detail: `${priceId}: ${rawPlan}` };
  }
  if (genormaliseerd !== plan) {
    // Verwisselde of verouderde secret. Doorlaten zou betekenen dat iemand
    // Premium-rechten verwacht en Basic krijgt, of andersom.
    return {
      ok: false,
      reason: 'plan_metadata_mismatch',
      detail: `gekozen=${plan} price=${priceId} metadata=${genormaliseerd}`,
    };
  }

  // ── Bedragen, nulprijs-poort en btw-gedrag ──────────────────────────────
  const bedragen = berekenBedragen(price);
  if (typeof bedragen === 'string') {
    return { ok: false, reason: bedragen, detail: priceId };
  }

  // ── Campagne? Die vervangt de trial ─────────────────────────────────────
  let korting: KortingWeergave | null = null;
  let promoGeweigerd = false;

  const ingevoerdeCode = typeof opties.promoCode === 'string' ? opties.promoCode.trim() : '';
  if (ingevoerdeCode !== '') {
    const promo = await deps.valideerPromo(ingevoerdeCode.toUpperCase());
    if (promo.geldig) {
      korting = {
        code: promo.code,
        promotionCodeId: promo.promotionCodeId,
        coupon: promo.coupon,
        tekst: kortingTekst(promo.coupon),
      };
    } else if (promo.configuratiefout) {
      // De code klopt, de configuratie erachter niet. Onze fout, en die moet
      // zichtbaar zijn — niet stil terugvallen op het standaardaanbod, want
      // dan krijgt iemand met een geldige code minder dan beloofd.
      return { ok: false, reason: 'coupon_onbruikbaar', detail: promo.configuratiefout };
    } else {
      promoGeweigerd = true;
    }
  }

  // ── Standaardaanbod: de trial uit de Price ──────────────────────────────
  // Alleen wanneer geen campagne het overneemt. Een ongeldige standaardduur is
  // ook dán een configuratiefout: hij wordt straks weer gebruikt.
  const standaard = trialIntervalUitPrice(price);
  if (standaard.aanwezig && standaard.interval === null) {
    return {
      ok: false,
      reason: 'trial_interval_invalid',
      detail: `${priceId}: ${price.metadata?.[TRIAL_INTERVAL_METADATA_KEY]}`,
    };
  }

  let trial: TrialWeergave | null = null;
  if (!korting && standaard.aanwezig && standaard.interval) {
    const interval = standaard.interval;
    const einde = trialEinde(nu, interval);
    const trialEndUnix = Math.floor(einde.getTime() / 1000);
    if (trialEndUnix - Math.floor(nu.getTime() / 1000) < MINIMALE_TRIAL_SECONDEN) {
      return {
        ok: false,
        reason: 'trial_te_kort',
        detail: `${interval.aantal} ${interval.eenheid}`,
      };
    }
    trial = {
      aantal: interval.aantal,
      eenheid: interval.eenheid,
      tekst: trialTekst(interval),
      eersteIncassoISO: einde.toISOString(),
      trialEndUnix,
    };
  }

  const vandaagVerschuldigdCenten = trial
    ? 0
    : korting
      ? restbedragCenten(bedragen, korting.coupon)
      : bedragen.brutoCenten;

  return {
    ok: true,
    plan: genormaliseerd,
    priceId,
    bedragen,
    vandaagVerschuldigdCenten,
    trial,
    korting,
    promoGeweigerd,
  };
}
