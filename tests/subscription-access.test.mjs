// Fail-closed UI-bevoegdheid (fase 2a, correctie na CodeRabbit-bevinding #39)
// ============================================================================
// De server is de poort: /api/checkout, /api/cancel-subscription en de edge
// functions weigeren een niet-eigenaar met 403. Maar een knop die tóch
// verschijnt en dan 403 geeft, is precies de zichtbare doodlopende weg die
// fase 2a moet wegnemen. Daarom bepaalt één helper wat de UI met het antwoord
// van /api/current-plan doet, en die is fail-closed.
//
// Beide oppervlakken gebruiken deze helper: /mijn-ribba (portaalknop) en
// /upgrade (koop- en opzegacties). Getest wordt de beslissing, niet de render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canManageSubscriptionFrom } from '../lib/subscription-access.ts';

test('expliciet true → eigenaar krijgt de beheeracties', () => {
  assert.equal(canManageSubscriptionFrom(true, { canManageSubscription: true }), true);
});

test('expliciet false → beheerder ziet geen beheeractie (wel de uitleg)', () => {
  assert.equal(canManageSubscriptionFrom(true, { canManageSubscription: false }), false);
});

test('non-OK response → geen beheeractie', () => {
  // Bijvoorbeeld 500 of 403: de body kan van alles zijn, ook een geldig
  // ogende true — een mislukte request mag nooit rechten opleveren.
  assert.equal(canManageSubscriptionFrom(false, { canManageSubscription: true }), false);
  assert.equal(canManageSubscriptionFrom(false, null), false);
});

test('requestfout (body niet te parsen → null) → geen beheeractie', () => {
  assert.equal(canManageSubscriptionFrom(true, null), false);
  assert.equal(canManageSubscriptionFrom(true, undefined), false);
});

test('ontbrekend veld → geen beheeractie', () => {
  assert.equal(canManageSubscriptionFrom(true, { plan: 'premium' }), false);
  assert.equal(canManageSubscriptionFrom(true, {}), false);
});

test('ongeldige waardevormen tellen nooit als toestemming', () => {
  for (const waarde of ['true', 1, [], {}, 'yes', NaN]) {
    assert.equal(
      canManageSubscriptionFrom(true, { canManageSubscription: waarde }),
      false,
      `waarde ${JSON.stringify(waarde)} mag geen rechten geven`,
    );
  }
});

test('body die geen object is → geen beheeractie', () => {
  for (const body of ['ok', 42, true, []]) {
    // Een array is technisch een object; ook die mag niets opleveren.
    assert.equal(canManageSubscriptionFrom(true, body), false);
  }
});
