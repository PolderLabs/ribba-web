/**
 * Centrale prijs-Single-Source-of-Truth voor Ribba-abonnementen.
 *
 * BESLUIT (Önder, 12 jul 2026 — vastgelegd in ribbaPro
 * docs/architecture_decisions/2026-07-12-btw-abonnementsprijzen.md):
 * - Commerciële abonnementsprijzen zijn EXCLUSIEF 21% btw.
 * - Mollie incasseert het bruto bedrag (incl. btw): Basic €30,25 ·
 *   Premium €54,45.
 * - `instructor_licenses.price_per_month` bevat de NETTO maandprijs
 *   (excl. btw) — schrijf daar uitsluitend `netMonthlyEurosForDb()` heen.
 * - Onafhankelijke hardcoded prijsconstanten buiten dit bestand zijn
 *   verboden; onbekende plannen falen closed (UnknownPlanError).
 *
 * Alle geldberekeningen gebeuren in INTEGER CENTEN. Een decimaal getal
 * mag uitsluitend ontstaan aan een expliciete grens: de Mollie-API
 * (formatCentsForMollie), de database (netMonthlyEurosForDb) of
 * presentatie (formatCentsForDisplay).
 */

export const VAT_RATE_PERCENT = 21;

export type PaidPlan = 'basic' | 'premium';

const NET_MONTHLY_CENTS: Record<PaidPlan, number> = {
  basic: 2_500, // €25,00 excl. btw
  premium: 4_500, // €45,00 excl. btw
};

export class UnknownPlanError extends Error {
  constructor(plan: unknown) {
    super(
      `Onbekend abonnementsplan: ${String(plan)} — fail-closed, geen bedrag beschikbaar`,
    );
    this.name = 'UnknownPlanError';
  }
}

export function isPaidPlan(plan: unknown): plan is PaidPlan {
  return plan === 'basic' || plan === 'premium';
}

export interface PlanPricing {
  plan: PaidPlan;
  /** Commerciële maandprijs excl. btw, in centen (2500 = €25,00). */
  netMonthlyCents: number;
  /** 21% btw over de netto maandprijs, in centen. */
  vatCents: number;
  /** Wat Mollie daadwerkelijk incasseert (netto + btw), in centen. */
  grossMonthlyCents: number;
  vatRatePercent: typeof VAT_RATE_PERCENT;
}

/**
 * Enige toegestane bron van abonnementsbedragen.
 * Fail-closed: gooit UnknownPlanError bij elk onbekend/niet-betaald plan —
 * er bestaat bewust géén default- of fallback-bedrag.
 */
export function getPlanPricing(plan: unknown): PlanPricing {
  if (!isPaidPlan(plan)) {
    throw new UnknownPlanError(plan);
  }
  const netMonthlyCents = NET_MONTHLY_CENTS[plan];
  const vatCents = Math.round((netMonthlyCents * VAT_RATE_PERCENT) / 100);
  return {
    plan,
    netMonthlyCents,
    vatCents,
    grossMonthlyCents: netMonthlyCents + vatCents,
    vatRatePercent: VAT_RATE_PERCENT,
  };
}

/** Mollie-API-grens: exact decimaalformaat met punt, bv. 3025 → '30.25'. */
export function formatCentsForMollie(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`Ongeldig centenbedrag voor Mollie: ${cents}`);
  }
  return (cents / 100).toFixed(2);
}

/** Presentatiegrens: nl-NL-weergave, bv. 3025 → '€30,25'. */
export function formatCentsForDisplay(cents: number): string {
  return `€${formatCentsForMollie(cents).replace('.', ',')}`;
}

/**
 * Databasegrens voor `instructor_licenses.price_per_month`: de NETTO
 * maandprijs (excl. btw) als numeriek euro-bedrag. Alleen op deze grens
 * mag een decimaal prijsgetal richting opslag ontstaan.
 */
export function netMonthlyEurosForDb(pricing: PlanPricing): number {
  return pricing.netMonthlyCents / 100;
}

/** Vaste Mollie-omschrijving per plan (checkout, webhook én reconcile). */
export function planDescription(plan: PaidPlan): string {
  return `Ribba ${plan === 'premium' ? 'Premium' : 'Basic'} – Maandabonnement`;
}
