/**
 * effective-license — deterministische school-plan-keuze uit instructor_licenses
 *
 * Poort van `src/lib/effectiveLicense.ts` uit de Pro-app (ribbaPro), zodat de
 * website en de app hetzelfde antwoord geven op "welk plan heeft deze school?".
 *
 * `instructor_licenses` is per instructeur, maar het plan is een schoolgegeven.
 * De Stripe-functions schrijven planwijzigingen school-breed naar álle actieve
 * licentierijen — de rijen zijn dus een spiegel van het schoolplan. Zolang er
 * één rij per school bestond was "pak er één" onschuldig; met een tweede
 * instructeur (en dus een tweede rij) niet meer.
 *
 * Deze reducer maakt de keuze deterministisch: het hóógste plan wint
 * (premium > basic > trial > expired), bij gelijke plannen de nieuwste rij.
 * Daarmee kan een betalende school nooit als onbetaald lezen, ook niet als één
 * rij een school-brede write heeft gemist (bv. de Mollie-webhook hier, die
 * rij-gescoped schrijft).
 *
 * Wordt vervangen door één rij per school (`school_licenses`) in fase 3 van
 * docs/design/schoollicentie-epic-canoniek-plan-2026-07-25.md (ribbaPro); tot
 * die tijd is dit de gedeelde waarheid.
 */

export interface LicensePlanRow {
  billing_plan: string | null;
  is_trial: boolean | null;
  trial_ends_at: string | null;
  cancelled_at: string | null;
  period_end: string | null;
  created_at: string | null;
}

const PLAN_PRECEDENCE: Record<string, number> = {
  premium: 3,
  basic: 2,
  trial: 1,
  expired: 0,
};

function precedence(row: LicensePlanRow): number {
  return PLAN_PRECEDENCE[row.billing_plan ?? ''] ?? 0;
}

/**
 * Kies uit de actieve licentierijen van één school de rij die het schoolplan
 * vertegenwoordigt. Retourneert null bij een lege lijst (= geen licentie).
 */
export function pickEffectiveLicense<T extends LicensePlanRow>(rows: T[]): T | null {
  if (!rows.length) return null;

  return rows.reduce((best, row) => {
    const diff = precedence(row) - precedence(best);
    if (diff > 0) return row;
    if (diff < 0) return best;
    // Zelfde plan: nieuwste rij wint (gedrag van de oude order by created_at desc)
    return (row.created_at ?? '') > (best.created_at ?? '') ? row : best;
  });
}
