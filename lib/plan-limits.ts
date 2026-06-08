/**
 * Centrale limieten per abonnementstier.
 *
 * Bron van waarheid is gedeeld met de Ribba app
 * (`src/contexts/PlanContext.tsx` — `BASIC_MAX_STUDENTS`, `BASIC_MAX_INSTRUCTORS`).
 * Wijzig je iets hier, doe het ook in de app-repo, anders zien gebruikers
 * inconsistente limieten.
 *
 * Premium heeft geen harde leerling-limiet en max 5 instructeurs (zie handoff
 * docs/handoff/abonnement-leerling-limiet-billing.md in ribbaPro).
 */

export const BASIC_MAX_STUDENTS = 30;
export const BASIC_MAX_INSTRUCTORS = 1;

export const PREMIUM_MAX_INSTRUCTORS = 5;
