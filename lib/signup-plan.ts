// Het plan bij inschrijving.
//
// Ontwerp: ribbaPro docs/design/mandaat-bij-inschrijving-2026-08-09.md.
//
// WAT HIER WEL HOORT: welk plan een rijschool krijgt. Dat is een PRODUCTkeuze,
// en die hoort bij Ribba.
//
// WAT HIER NIET HOORT: wat dat plan kost, hoe lang het gratis is, en wat er na
// de gratis periode gebeurt. Dat leeft in Stripe.
//
// ── GEEN KEUZE BIJ INSCHRIJVING (besluit Önder, 16 aug 2026) ────────────────
//
// Besluit 3 van het ontwerp is vervangen. Er is bij inschrijving géén
// plankeuze: iedereen start op Premium. Wisselen naar Basic kan daarna op elk
// moment in de app, achter de bestaande Basic-poort.
//
// Waarom dat eenvoudiger is dan het lijkt: de Price op het abonnement bepaalt
// de rechten, de coupon bepaalt wat er wordt afgeschreven. Dat zijn twee losse
// knoppen. Wisselt een rijschool tijdens de gratis periode naar Basic, dan
// verandert alleen de eerste — de gratis periode loopt gewoon door, want de
// coupon is niet aan een product gekoppeld.
//
// Daarmee bestaat er geen keuzemoment vlak vóór de eerste incasso, en hoeft er
// geen downgradepad gebouwd te worden — alleen een prijswissel.
//
// Het BEGRIP plan blijft wel bestaan: `pending_registrations.plan` is NOT NULL,
// het gaat als metadata mee naar Stripe, en A6 (wisselen naar Basic) heeft het
// nodig. Alleen de keuze op het formulier is weg.

/** De metadatasleutel waarmee Stripe het Ribba-entitlement meelevert. */
export const PLAN_METADATA_KEY = 'plan';

export const SIGNUP_PLANS = ['basic', 'premium'] as const;
export type SignupPlan = (typeof SIGNUP_PLANS)[number];

/**
 * Waar iedereen op start.
 *
 * Bewust een constante en geen invoerveld: de server bepaalt dit, niet de
 * client. Een `plan` in de request body wordt genegeerd — zou hij wél worden
 * overgenomen, dan kan iemand zich met een aangepast verzoek op Basic
 * inschrijven en het gratis aanbod krijgen dat voor Premium bedoeld is.
 */
export const INSCHRIJFPLAN: SignupPlan = 'premium';

/**
 * Strikte servergrens. Geen normalisatie van hoofdletters of spaties: iets
 * anders dan exact `basic` of `premium` is onverwacht, en dat willen we zien
 * in plaats van repareren.
 */
export function isSignupPlan(value: unknown): value is SignupPlan {
  return typeof value === 'string' && (SIGNUP_PLANS as readonly string[]).includes(value);
}
