// De plankeuze bij inschrijving — fase 3B.2.
//
// Ontwerp: ribbaPro docs/design/mandaat-bij-inschrijving-2026-08-09.md.
//
// WAT HIER WEL HOORT: welk plan een rijschool kiest. Dat is een PRODUCTkeuze,
// en die hoort bij Ribba.
//
// WAT HIER NIET HOORT: wat dat plan kost, hoe lang het gratis is, en wat er na
// de gratis periode gebeurt. Dat leeft in Stripe. De bedragen hieronder zijn
// uitsluitend WEERGAVE — ze komen uit de bestaande `plan-pricing`-bron zodat er
// geen tweede prijslijst ontstaat, en er hangt geen enkel recht aan.
//
// WAT ER IN DEZE FASE MEE GEBEURT: niets. De keuze wordt gevalideerd en verder
// nergens op toegepast. Pas in 3B.3 bepaalt hij welk Stripe-aanbod wordt
// opgezocht, en pas in 3B.5 welk entitlement de school krijgt — en dan nog
// steeds via `plan`-metadata op de Price, niet via deze constante.

/** De metadatasleutel waarmee Stripe het Ribba-entitlement meelevert. */
export const PLAN_METADATA_KEY = 'plan';

export const SIGNUP_PLANS = ['basic', 'premium'] as const;
export type SignupPlan = (typeof SIGNUP_PLANS)[number];

/**
 * Strikte servergrens. Het formulier is UX; dit is de plek waar het wordt
 * afgedwongen. Geen normalisatie van hoofdletters of spaties: een client die
 * iets anders stuurt dan exact `basic` of `premium` stuurt iets onverwachts,
 * en dat willen we zien in plaats van repareren.
 */
export function isSignupPlan(value: unknown): value is SignupPlan {
  return typeof value === 'string' && (SIGNUP_PLANS as readonly string[]).includes(value);
}
