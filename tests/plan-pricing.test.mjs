// P0.1 — unit-tests voor lib/plan-pricing.ts, de centrale prijs-SSoT.
// Bindend besluit (Önder, 12 jul 2026): prijzen zijn EXCL. 21% btw;
// Mollie incasseert bruto; price_per_month = netto; onbekend plan =
// fail-closed (UnknownPlanError), nooit een fallback-bedrag.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  VAT_RATE_PERCENT,
  isPaidPlan,
  getPlanPricing,
  formatCentsForMollie,
  formatCentsForDisplay,
  netMonthlyEurosForDb,
  planDescription,
  UnknownPlanError,
  INCLUDED_INSTRUCTORS,
  getSubscriptionPricing,
  extraInstructorNetMonthlyCents,
  totalNetMonthlyEurosForDb,
  PlanNotExpandableError,
} = await import('../lib/plan-pricing.ts');

test('P1: Basic — €25,00 excl. → €5,25 btw → €30,25 bruto, alles in integer centen', () => {
  const p = getPlanPricing('basic');
  assert.equal(p.plan, 'basic');
  assert.equal(p.netMonthlyCents, 2500);
  assert.equal(p.vatCents, 525);
  assert.equal(p.grossMonthlyCents, 3025);
  assert.equal(p.vatRatePercent, 21);
  assert.ok(Number.isInteger(p.netMonthlyCents) && Number.isInteger(p.vatCents) && Number.isInteger(p.grossMonthlyCents));
});

test('P2: Premium — €45,00 excl. → €9,45 btw → €54,45 bruto', () => {
  const p = getPlanPricing('premium');
  assert.equal(p.netMonthlyCents, 4500);
  assert.equal(p.vatCents, 945);
  assert.equal(p.grossMonthlyCents, 5445);
});

test('P3: Mollie-grens — exact decimaalformaat met punt', () => {
  assert.equal(formatCentsForMollie(getPlanPricing('basic').grossMonthlyCents), '30.25');
  assert.equal(formatCentsForMollie(getPlanPricing('premium').grossMonthlyCents), '54.45');
  assert.equal(formatCentsForMollie(0), '0.00');
  assert.equal(formatCentsForMollie(5), '0.05');
});

test('P4: Mollie-formatter weigert niet-integere of negatieve centen', () => {
  assert.throws(() => formatCentsForMollie(30.25));
  assert.throws(() => formatCentsForMollie(-1));
  assert.throws(() => formatCentsForMollie(NaN));
});

test('P5: onbekend plan → UnknownPlanError, geen enkel fallback-bedrag', () => {
  for (const bad of ['trial', 'expired', 'legacy_gold', '', null, undefined, 45, {}]) {
    assert.throws(() => getPlanPricing(bad), UnknownPlanError);
  }
  assert.equal(isPaidPlan('basic'), true);
  assert.equal(isPaidPlan('premium'), true);
  assert.equal(isPaidPlan('trial'), false);
  assert.equal(isPaidPlan(undefined), false);
});

test('P6: databasegrens — price_per_month is de NETTO maandprijs', () => {
  assert.equal(netMonthlyEurosForDb(getPlanPricing('basic')), 25);
  assert.equal(netMonthlyEurosForDb(getPlanPricing('premium')), 45);
});

test('P7: presentatiegrens — nl-NL weergave', () => {
  assert.equal(formatCentsForDisplay(3025), '€30,25');
  assert.equal(formatCentsForDisplay(5445), '€54,45');
  assert.equal(formatCentsForDisplay(2500), '€25,00');
});

test('P8: btw-tarief is exact 21% en de som klopt per constructie', () => {
  assert.equal(VAT_RATE_PERCENT, 21);
  for (const plan of ['basic', 'premium']) {
    const p = getPlanPricing(plan);
    assert.equal(p.netMonthlyCents + p.vatCents, p.grossMonthlyCents);
    assert.equal(p.vatCents, Math.round((p.netMonthlyCents * 21) / 100));
  }
});

test('P9: vaste Mollie-omschrijvingen (checkout, webhook én reconcile delen deze)', () => {
  assert.equal(planDescription('basic'), 'Ribba Basic – Maandabonnement');
  assert.equal(planDescription('premium'), 'Ribba Premium – Maandabonnement');
});

// ── Extra instructeurs: Premium bevat 5, daarboven €34 netto p/m ──────

test('P10: inbegrepen instructeurs — Basic 1, Premium 5', () => {
  assert.equal(INCLUDED_INSTRUCTORS.basic, 1);
  assert.equal(INCLUDED_INSTRUCTORS.premium, 5);
});

test('P11: Premium tot en met 5 instructeurs rekent geen extra kosten', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const p = getSubscriptionPricing('premium', n);
    assert.equal(p.extraInstructors, 0);
    assert.equal(p.totalNetMonthlyCents, 4500);
    assert.equal(p.totalGrossMonthlyCents, 5445);
  }
});

test('P12: Premium met 6 instructeurs — €45 + €34 = €79 excl. → €95,59 bruto', () => {
  const p = getSubscriptionPricing('premium', 6);
  assert.equal(p.extraInstructors, 1);
  assert.equal(p.extraInstructorNetMonthlyCents, 3400);
  assert.equal(p.totalNetMonthlyCents, 7900);
  assert.equal(p.totalVatCents, 1659);
  assert.equal(p.totalGrossMonthlyCents, 9559);
  assert.equal(formatCentsForMollie(p.totalGrossMonthlyCents), '95.59');
});

test('P13: Premium met 7 instructeurs — €45 + 2 × €34 = €113 excl. btw', () => {
  const p = getSubscriptionPricing('premium', 7);
  assert.equal(p.extraInstructors, 2);
  assert.equal(p.totalNetMonthlyCents, 11300);
  assert.equal(formatCentsForDisplay(p.totalNetMonthlyCents), '€113,00');
});

test('P14: de vaste planprijs blijft naast het totaal beschikbaar', () => {
  const p = getSubscriptionPricing('premium', 8);
  assert.equal(p.netMonthlyCents, 4500);
  assert.equal(p.grossMonthlyCents, 5445);
  assert.equal(p.totalNetMonthlyCents, 4500 + 3 * 3400);
});

test('P15: btw wordt over het TOTAAL berekend, som klopt per constructie', () => {
  for (const n of [1, 5, 6, 9, 25]) {
    const p = getSubscriptionPricing('premium', n);
    assert.equal(p.totalNetMonthlyCents + p.totalVatCents, p.totalGrossMonthlyCents);
    assert.equal(p.totalVatCents, Math.round((p.totalNetMonthlyCents * 21) / 100));
    assert.ok(Number.isInteger(p.totalNetMonthlyCents) && Number.isInteger(p.totalVatCents));
  }
});

test('P16: Basic is niet uitbreidbaar — fail-closed boven 1 instructeur', () => {
  assert.equal(getSubscriptionPricing('basic', 1).totalNetMonthlyCents, 2500);
  assert.throws(() => getSubscriptionPricing('basic', 2), PlanNotExpandableError);
  assert.throws(() => extraInstructorNetMonthlyCents('basic'), PlanNotExpandableError);
});

test('P17: onbekend plan en onzinnige aantallen falen closed', () => {
  assert.throws(() => getSubscriptionPricing('gratis', 3), UnknownPlanError);
  assert.throws(() => getSubscriptionPricing(null, 3), UnknownPlanError);
  for (const n of [0, -1, 1.5, NaN, '6']) {
    assert.throws(() => getSubscriptionPricing('premium', n), /Ongeldig aantal instructeurs/);
  }
});

test('P18: databasegrens met extra instructeurs — totaal netto, niet de planprijs', () => {
  assert.equal(totalNetMonthlyEurosForDb(getSubscriptionPricing('premium', 5)), 45);
  assert.equal(totalNetMonthlyEurosForDb(getSubscriptionPricing('premium', 7)), 113);
  // netMonthlyEurosForDb blijft bewust de vaste planprijs teruggeven.
  assert.equal(netMonthlyEurosForDb(getSubscriptionPricing('premium', 7)), 45);
});

test('P19: presentatiehulp — €34 netto per extra instructeur bij Premium', () => {
  assert.equal(extraInstructorNetMonthlyCents('premium'), 3400);
  assert.equal(formatCentsForDisplay(extraInstructorNetMonthlyCents('premium')), '€34,00');
});
