// Het aanbod bij een inschrijving — één resolver voor scherm én Checkout.
//
// Ontwerp: ribbaPro docs/design/mandaat-bij-inschrijving-2026-08-09.md.
// Trial-besluit: 11 aug 2026 — Checkout met absolute `trial_end`, geen Stripe
// Trial Offers zolang Checkout ze niet ondersteunt.
//
// ── WAAROM DIT ÉÉN FUNCTIE IS ───────────────────────────────────────────────
//
// Eis Önder: `/api/signup/offer` en `/api/signup/start` gebruiken exact deze
// functie. Daardoor kán de pagina geen ander aanbod tonen dan wat Checkout
// krijgt — niet omdat we dat afspreken, maar omdat er maar één plek is waar
// een aanbod ontstaat.
//
// `start` roept hem opnieuw aan vlak vóór Checkout. Wat de browser eerder van
// `offer` kreeg is weergave, nooit invoer: bedragen en trialdatum uit een
// client zijn een suggestie van iemand anders.
//
// ── DRIE BRONNEN, STRIKT GESCHEIDEN ─────────────────────────────────────────
//
//   ROUTING      welke Price → STRIPE_PRICE_BASIC / _PREMIUM (secrets)
//   ENTITLEMENT  welke rechten → UITSLUITEND `plan`-metadata op de Price
//   DUUR         hoe lang gratis → `trial_interval` op de Price, of de
//                promocode die hem overschrijft
//
// De Price-ID-secrets zijn routing en nooit een bron van rechten. Daardoor
// kan een rijschool met een eigen prijs van €17,50 gewoon Basic-rechten
// krijgen, en kan een prijswijziging in Stripe zonder release.
//
// ── POORTEN ─────────────────────────────────────────────────────────────────
//
// G5      een Price zonder geldige, PASSENDE `plan`-metadata wordt geweigerd.
//         De fout strandt dan bij ons vóór het mandaat, in plaats van erna bij
//         een klant die betaald heeft en niets krijgt.
//
// NULPRIJS  een terugkerende Price van €0 wordt geweigerd bij inschrijving.
//         Sinds 10 aug staan er zulke prijzen in het account (restanten van
//         een proefperiode-experiment). Eén verwisselde secret zou anders een
//         rijschool voor altijd gratis laten draaien — mét werkend
//         entitlement, dus volledig onzichtbaar in de cijfers.
//
// BTW     `tax_behavior` moet expliciet zijn. Op `unspecified` weigert Stripe
//         de Checkout wanneer automatische btw aanstaat.

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
  | 'price_not_configured'      // secret ontbreekt
  | 'price_not_found'           // secret wijst nergens heen
  | 'price_inactive'            // gearchiveerde Price
  | 'price_not_recurring'       // eenmalig bedrag; geen abonnement
  | 'price_without_amount'      // bv. tiered pricing: geen bedrag om te tonen
  | 'price_zero_amount'         // nulprijs-poort
  | 'tax_behavior_unspecified'  // Checkout weigert dit bij automatische btw
  | 'plan_metadata_missing'     // G5
  | 'plan_metadata_invalid'     // G5
  | 'plan_metadata_mismatch'    // G5
  | 'trial_interval_invalid'    // configuratiefout in duur
  | 'trial_te_kort';            // < 48 uur; Stripe zou weigeren

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
  /** Afgeronde zin, server-gerenderd: "1 maand gratis" / "6 maanden gratis". */
  tekst: string;
  /** Wanneer de eerste incasso valt. */
  eersteIncassoISO: string;
  /** Precies wat als `subscription_data.trial_end` naar Checkout gaat. */
  trialEndUnix: number;
  /** Welke code deze duur veroorzaakte; null bij het standaardaanbod. */
  viaPromocode: string | null;
};

export type Offer = {
  plan: SignupPlan;
  priceId: string;
  bedragen: Bedragen;
  /** 0 zolang er een gratis periode is. Eén getal, geen conditie in de UI. */
  vandaagVerschuldigdCenten: number;
  /** null betekent een geldig aanbod zonder gratis periode: direct betalen. */
  trial: TrialWeergave | null;
  /**
   * True als er een code werd meegegeven die niet geldig bleek. Het aanbod
   * staat dan gewoon (zonder promo) — een verkeerd getypte code mag geen
   * inschrijving blokkeren, maar mag ook nooit stilzwijgend als campagne op de
   * registratie belanden.
   */
  promoGeweigerd: boolean;
};

export type OfferResult =
  | ({ ok: true } & Offer)
  | { ok: false; reason: OfferFailure; detail?: string };

/** Uitkomst van `validate_promo_code`. Geeft bewust geen reden terug. */
export type PromoResolutie =
  | { geldig: true; code: string; interval: string }
  | { geldig: false };

export type OfferDeps = {
  stripe: Pick<Stripe, 'prices'>;
  /** Slaat de promotabel aan. Alleen aangeroepen als er een code is. */
  valideerPromo(code: string): Promise<PromoResolutie>;
};

export type OfferOpties = {
  promoCode?: string | null;
  /** Injecteerbaar zodat de kalenderrekensom testbaar is. */
  nu?: Date;
  env?: NodeJS.ProcessEnv;
};

/** Routing: welk secret hoort bij welke keuze. Géén entitlementbetekenis. */
export function priceIdForPlan(
  plan: SignupPlan,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = plan === 'basic' ? env.STRIPE_PRICE_BASIC : env.STRIPE_PRICE_PREMIUM;
  const id = typeof raw === 'string' ? raw.trim() : '';
  return id === '' ? null : id;
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
 * Bepaalt het volledige aanbod voor één plan.
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
  const env = opties.env ?? process.env;
  const nu = opties.nu ?? new Date();

  const priceId = priceIdForPlan(plan, env);
  if (!priceId) return { ok: false, reason: 'price_not_configured', detail: plan };

  let price: Stripe.Price;
  try {
    price = await deps.stripe.prices.retrieve(priceId);
  } catch {
    return { ok: false, reason: 'price_not_found', detail: priceId };
  }

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
    // Basic kiest en Premium-rechten krijgt, of andersom.
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

  // ── Duur: standaard van de Price, eventueel overschreven ────────────────
  const standaard = trialIntervalUitPrice(price);
  if (standaard.aanwezig && standaard.interval === null) {
    return {
      ok: false,
      reason: 'trial_interval_invalid',
      detail: `${priceId}: ${price.metadata?.[TRIAL_INTERVAL_METADATA_KEY]}`,
    };
  }

  let interval: TrialInterval | null = standaard.aanwezig ? standaard.interval : null;
  let viaPromocode: string | null = null;
  let promoGeweigerd = false;

  const ingevoerdeCode = typeof opties.promoCode === 'string' ? opties.promoCode.trim() : '';
  if (ingevoerdeCode !== '') {
    const promo = await deps.valideerPromo(ingevoerdeCode.toUpperCase());
    if (promo.geldig) {
      const promoInterval = parseTrialInterval(promo.interval);
      if (promoInterval === null) {
        // De code klopt, de configuratie erachter niet. Dat is onze fout en
        // moet zichtbaar zijn — niet stil terugvallen op het standaardaanbod,
        // want dan krijgt iemand met een geldige code minder dan beloofd.
        return {
          ok: false,
          reason: 'trial_interval_invalid',
          detail: `promocode ${promo.code}: ${promo.interval}`,
        };
      }
      // Overschrijven, niet optellen: STARTGRATIS zegt zes maanden, geen vijf
      // extra bovenop de standaardmaand.
      interval = promoInterval;
      viaPromocode = promo.code;
    } else {
      promoGeweigerd = true;
    }
  }

  let trial: TrialWeergave | null = null;
  if (interval) {
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
      viaPromocode,
    };
  }

  return {
    ok: true,
    plan: genormaliseerd,
    priceId,
    bedragen,
    vandaagVerschuldigdCenten: trial ? 0 : bedragen.brutoCenten,
    trial,
    promoGeweigerd,
  };
}
