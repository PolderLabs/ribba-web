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
