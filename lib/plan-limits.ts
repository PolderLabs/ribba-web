/**
 * Centrale limieten per abonnementstier.
 *
 * Bron van waarheid is gedeeld met de Ribba app
 * (`src/contexts/PlanContext.tsx` — `BASIC_MAX_STUDENTS`, `BASIC_MAX_INSTRUCTORS`).
 * Wijzig je iets hier, doe het ook in de app-repo, anders zien gebruikers
 * inconsistente limieten.
 *
 * Premium heeft geen harde leerling-limiet. Sinds 14 aug 2026 óók geen harde
 * instructeur-limiet meer: de eerste 5 zitten in de planprijs, daarboven
 * rekent het abonnement €35 netto per instructeur per maand bij
 * (`INCLUDED_INSTRUCTORS` / `getSubscriptionPricing` in lib/plan-pricing.ts).
 * Het aantal is dus een PRIJS-grens geworden, geen TOEGANGS-grens.
 */

export const BASIC_MAX_STUDENTS = 30;
export const BASIC_MAX_INSTRUCTORS = 1;

/**
 * Premium kent geen bovengrens meer aan het aantal instructeurs.
 * Bewust `Infinity` in plaats van het weghalen van de constante: de app-repo
 * (`ribbaPro/src/contexts/PlanContext.tsx`) leest dezelfde limiet en zou bij
 * een ontbrekende waarde terugvallen op een default.
 */
export const PREMIUM_MAX_INSTRUCTORS = Infinity;
