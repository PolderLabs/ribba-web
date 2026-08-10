// Het Stripe-aanbod bij een inschrijving ophalen — fase 3B.3.
//
// Ontwerp: ribbaPro docs/design/mandaat-bij-inschrijving-2026-08-09.md.
//
// TWEE DINGEN DIE STRIKT GESCHEIDEN BLIJVEN:
//
//   ROUTING      welke Stripe Price krijgt Checkout mee?
//                → voorlopig uit STRIPE_PRICE_BASIC / STRIPE_PRICE_PREMIUM.
//
//   ENTITLEMENT  welke rechten krijgt de school?
//                → UITSLUITEND uit `plan`-metadata op de Price.
//
// > De Price-ID-secrets zijn voorlopig alleen routing/configuratie voor
// > Checkout en nooit een bron van entitlement.
//
// Daardoor kan de lookup-key/promocode-route deze selectie later vervangen
// zonder dat er ergens productrechten aan een price-ID blijken te hangen.
//
// G5 (ontwerp §7a): een Price zonder geldige `plan`-metadata mag niet in een
// Checkout terechtkomen. De fout strandt dan vóór het mandaat, bij ons, in
// plaats van erna bij een klant die betaald heeft en niets krijgt.
//
// Aangescherpt op verzoek: het is niet genoeg dát er een geldig plan staat —
// het moet OVEREENKOMEN met wat de rijschool koos. Een verwisselde secret zou
// anders iemand die Basic kiest naar de Premium-Price sturen.

import type Stripe from 'stripe';
import { PLAN_METADATA_KEY, isSignupPlan, type SignupPlan } from '@/lib/signup-plan';

export type OfferFailure =
  | 'price_not_configured'   // secret ontbreekt
  | 'price_not_found'        // secret wijst nergens heen
  | 'price_inactive'         // gearchiveerde Price
  | 'price_not_recurring'    // eenmalig bedrag; geen abonnement
  | 'plan_metadata_missing'  // G5: geen plan op de Price
  | 'plan_metadata_invalid'  // G5: wel plan, geen geldige waarde
  | 'plan_metadata_mismatch'; // G5: geldig, maar niet het gekozen plan

export type OfferResult =
  | {
      ok: true;
      priceId: string;
      /** Uit de Price-metadata — nooit uit het secret of het verzoek. */
      plan: SignupPlan;
      /**
       * Optioneel. Stripe bepaalt de gratis periode; Ribba geeft dit getal
       * uitsluitend door aan Checkout en bewaart of interpreteert het nooit.
       * Ontbreekt het, dan is dat een geldig aanbod: direct betalen.
       */
      trialDays: number | null;
    }
  | { ok: false; reason: OfferFailure; detail?: string };

/** Routing: welk secret hoort bij welke keuze. Géén entitlementbetekenis. */
export function priceIdForPlan(plan: SignupPlan, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = plan === 'basic' ? env.STRIPE_PRICE_BASIC : env.STRIPE_PRICE_PREMIUM;
  const id = typeof raw === 'string' ? raw.trim() : '';
  return id === '' ? null : id;
}

/**
 * Leest `trial_days` uit Price-metadata. Alleen een positief geheel getal
 * telt; al het andere is "geen trial" en niet stilzwijgend iets anders.
 */
export function trialDaysFromPrice(price: { metadata?: Record<string, string> | null }): number | null {
  const raw = price?.metadata?.trial_days;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  if (!/^\d+$/.test(String(raw).trim())) return null;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Haalt het aanbod op en voert G5 uit. Faalt hij, dan wordt er GEEN
 * Checkout aangemaakt en geen pending registratie afgerond.
 */
export async function resolveSignupOffer(
  stripe: Pick<Stripe, 'prices'>,
  plan: SignupPlan,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OfferResult> {
  const priceId = priceIdForPlan(plan, env);
  if (!priceId) return { ok: false, reason: 'price_not_configured', detail: plan };

  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(priceId);
  } catch {
    return { ok: false, reason: 'price_not_found', detail: priceId };
  }

  if (price.active === false) return { ok: false, reason: 'price_inactive', detail: priceId };
  if (!price.recurring) return { ok: false, reason: 'price_not_recurring', detail: priceId };

  // ── G5 ────────────────────────────────────────────────────────────────
  const raw = price.metadata?.[PLAN_METADATA_KEY];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: false, reason: 'plan_metadata_missing', detail: priceId };
  }
  const genormaliseerd = String(raw).trim().toLowerCase();
  if (!isSignupPlan(genormaliseerd)) {
    return { ok: false, reason: 'plan_metadata_invalid', detail: `${priceId}: ${raw}` };
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

  return { ok: true, priceId, plan: genormaliseerd, trialDays: trialDaysFromPrice(price) };
}
