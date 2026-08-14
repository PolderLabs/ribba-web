/**
 * Centrale prijs-Single-Source-of-Truth voor Ribba-abonnementen.
 *
 * BESLUIT (Önder, 12 jul 2026 — vastgelegd in ribbaPro
 * docs/architecture_decisions/2026-07-12-btw-abonnementsprijzen.md):
 * - Commerciële abonnementsprijzen zijn EXCLUSIEF 21% btw.
 * - Mollie incasseert het bruto bedrag (incl. btw): Basic €30,25 ·
 *   Premium €54,45.
 * - `instructor_licenses.price_per_month` bevat de NETTO maandprijs
 *   (excl. btw) — schrijf daar uitsluitend `netMonthlyEurosForDb()` heen,
 *   of `totalNetMonthlyEurosForDb()` als het bedrag met de teamgrootte
 *   meeschaalt.
 * - Premium bevat 5 instructeurs; daarboven €34 netto per extra instructeur
 *   per maand (`getSubscriptionPricing`). Basic is niet uitbreidbaar en faalt
 *   closed met PlanNotExpandableError.
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

/**
 * Aantal instructeurs dat in de vaste maandprijs van het plan zit.
 * Basic is single-seat; Premium bevat 5 instructeurs.
 */
export const INCLUDED_INSTRUCTORS: Record<PaidPlan, number> = {
  basic: 1,
  premium: 5,
};

/**
 * Netto maandprijs per instructeur bóven INCLUDED_INSTRUCTORS.
 * Alleen Premium kan uitbreiden; Basic blijft hard op 1 instructeur.
 */
const EXTRA_INSTRUCTOR_NET_MONTHLY_CENTS: Record<PaidPlan, number | null> = {
  basic: null, // niet uitbreidbaar — upgraden naar Premium
  premium: 3_400, // €34,00 excl. btw per extra instructeur
};

export class PlanNotExpandableError extends Error {
  constructor(plan: PaidPlan) {
    super(
      `Plan ${plan} kan niet per instructeur uitbreiden — upgrade naar een plan dat dat wel kan`,
    );
    this.name = 'PlanNotExpandableError';
  }
}

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
function vatCentsOf(netCents: number): number {
  return Math.round((netCents * VAT_RATE_PERCENT) / 100);
}

export function getPlanPricing(plan: unknown): PlanPricing {
  if (!isPaidPlan(plan)) {
    throw new UnknownPlanError(plan);
  }
  const netMonthlyCents = NET_MONTHLY_CENTS[plan];
  const vatCents = vatCentsOf(netMonthlyCents);
  return {
    plan,
    netMonthlyCents,
    vatCents,
    grossMonthlyCents: netMonthlyCents + vatCents,
    vatRatePercent: VAT_RATE_PERCENT,
  };
}

export interface SubscriptionPricing extends PlanPricing {
  /** Aantal actieve instructeurs waarop dit bedrag is gebaseerd. */
  instructors: number;
  /** Instructeurs die in de vaste planprijs zitten. */
  includedInstructors: number;
  /** Instructeurs bóven het inbegrepen aantal (0 als er niets bijkomt). */
  extraInstructors: number;
  /** Netto maandprijs per extra instructeur, in centen (0 bij geen extra's). */
  extraInstructorNetMonthlyCents: number;
  /** Plan + extra instructeurs, netto per maand, in centen. */
  totalNetMonthlyCents: number;
  /** 21% btw over totalNetMonthlyCents, in centen. */
  totalVatCents: number;
  /** Wat Mollie voor het geheel incasseert (netto + btw), in centen. */
  totalGrossMonthlyCents: number;
}

/**
 * Het volledige maandbedrag voor een rijschool: de vaste planprijs plus
 * €34 (excl. btw) per instructeur boven het inbegrepen aantal.
 *
 * Fail-closed op elke onduidelijkheid: onbekend plan → UnknownPlanError,
 * een niet-uitbreidbaar plan met te veel instructeurs → PlanNotExpandableError.
 * Btw wordt over het TOTAAL berekend, niet per regel, zodat er geen
 * afrondingsverschil tussen weergave en incasso kan ontstaan.
 */
export function getSubscriptionPricing(
  plan: unknown,
  instructors: number,
): SubscriptionPricing {
  const base = getPlanPricing(plan);
  if (!Number.isInteger(instructors) || instructors < 1) {
    throw new Error(
      `Ongeldig aantal instructeurs voor prijsberekening: ${instructors}`,
    );
  }

  const includedInstructors = INCLUDED_INSTRUCTORS[base.plan];
  const extraInstructors = Math.max(0, instructors - includedInstructors);
  const perExtra = EXTRA_INSTRUCTOR_NET_MONTHLY_CENTS[base.plan];

  if (extraInstructors > 0 && perExtra === null) {
    throw new PlanNotExpandableError(base.plan);
  }

  const extraInstructorNetMonthlyCents = perExtra ?? 0;
  const totalNetMonthlyCents =
    base.netMonthlyCents + extraInstructors * extraInstructorNetMonthlyCents;
  const totalVatCents = vatCentsOf(totalNetMonthlyCents);

  return {
    ...base,
    instructors,
    includedInstructors,
    extraInstructors,
    extraInstructorNetMonthlyCents,
    totalNetMonthlyCents,
    totalVatCents,
    totalGrossMonthlyCents: totalNetMonthlyCents + totalVatCents,
  };
}

/**
 * Presentatiehulp voor de prijspagina's: de netto maandprijs per extra
 * instructeur van een uitbreidbaar plan, in centen.
 */
export function extraInstructorNetMonthlyCents(plan: unknown): number {
  const { plan: paid } = getPlanPricing(plan);
  const perExtra = EXTRA_INSTRUCTOR_NET_MONTHLY_CENTS[paid];
  if (perExtra === null) {
    throw new PlanNotExpandableError(paid);
  }
  return perExtra;
}

/** Mollie-API-grens: exact decimaalformaat met punt, bv. 3025 → '30.25'. */
export function formatCentsForMollie(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`Ongeldig centenbedrag voor Mollie: ${cents}`);
  }
  return (cents / 100).toFixed(2);
}

/**
 * Terugweg over de Mollie-grens: '95.59' → 9559 centen. Nodig om het bedrag
 * van een bestaande subscription te vergelijken met wat we vandaag zouden
 * rekenen. Fail-closed op alles wat niet exact een bedrag met twee decimalen
 * is — een verkeerd gelezen bedrag zou een onterechte incassowijziging
 * kunnen triggeren.
 */
export function centsFromMollieValue(value: string): number {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) {
    throw new Error(`Onleesbaar Mollie-bedrag: ${String(value)}`);
  }
  return Math.round(Number(value) * 100);
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

/**
 * Databasegrens voor een abonnement mét extra instructeurs: de NETTO
 * maandprijs van plan + extra instructeurs. Gebruik deze — niet
 * `netMonthlyEurosForDb()` — zodra het bedrag met de teamgrootte meeschaalt;
 * die eerste geeft bewust alleen de vaste planprijs terug.
 */
export function totalNetMonthlyEurosForDb(pricing: SubscriptionPricing): number {
  return pricing.totalNetMonthlyCents / 100;
}

/** Vaste Mollie-omschrijving per plan (checkout, webhook én reconcile). */
export function planDescription(plan: PaidPlan): string {
  return `Ribba ${plan === 'premium' ? 'Premium' : 'Basic'} – Maandabonnement`;
}
