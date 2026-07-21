// Portal-session-beslislogica (/api/portal): bewijst dat "Mijn Ribba"
// uitsluitend opent op de bestaande actieve stripe_customers-koppeling in
// de juiste modus, dat het ontbreken van een koppeling netjes wordt
// afgehandeld (no_customer, geen aanmaak) en dat dubbelzinnigheid nooit
// stil wordt opgelost. Fail-closed bij een onherkenbare key — zelfde
// principe als de edge function (F3-ontwerp).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  expectedLivemodeForKey,
  selectPortalCustomer,
} = await import('../lib/portal-session.ts');

// ── Keyprefix → verwachte modus (fail-closed) ───────────────────────────────

test('sk_test_/rk_test_ → testmodus; sk_live_/rk_live_ → livemodus', () => {
  assert.deepEqual(expectedLivemodeForKey('sk_test_abc'), { ok: true, livemode: false });
  assert.deepEqual(expectedLivemodeForKey('rk_test_abc'), { ok: true, livemode: false });
  assert.deepEqual(expectedLivemodeForKey('sk_live_abc'), { ok: true, livemode: true });
  assert.deepEqual(expectedLivemodeForKey('rk_live_abc'), { ok: true, livemode: true });
});

test('onherkenbare of lege key → fail-closed', () => {
  for (const bad of ['', 'pk_test_abc', 'whsec_x', 'sleutel']) {
    assert.deepEqual(expectedLivemodeForKey(bad), { ok: false });
  }
});

// ── Customer-selectie voor de portal ────────────────────────────────────────

const actiefTest = { stripe_customer_id: 'cus_A', livemode: false, status: 'active' };

test('precies één actieve koppeling in de juiste modus → open', () => {
  assert.deepEqual(selectPortalCustomer([actiefTest], false), {
    action: 'open',
    stripeCustomerId: 'cus_A',
  });
});

test('geen rijen → no_customer (nette afhandeling, geen aanmaak)', () => {
  assert.deepEqual(selectPortalCustomer([], false), { action: 'no_customer' });
});

test('alleen rijen in de ANDERE modus tellen niet mee', () => {
  const liveRow = { stripe_customer_id: 'cus_L', livemode: true, status: 'active' };
  assert.deepEqual(selectPortalCustomer([liveRow], false), { action: 'no_customer' });
});

test('pending/recovery_required of ontbrekend customer-id telt niet mee', () => {
  const pending = { stripe_customer_id: null, livemode: false, status: 'pending' };
  const recovery = { stripe_customer_id: 'cus_R', livemode: false, status: 'recovery_required' };
  const leeg = { stripe_customer_id: '', livemode: false, status: 'active' };
  assert.deepEqual(selectPortalCustomer([pending, recovery, leeg], false), {
    action: 'no_customer',
  });
});

test('meer dan één actieve kandidaat → ambiguous, nooit stil kiezen', () => {
  const tweede = { stripe_customer_id: 'cus_B', livemode: false, status: 'active' };
  assert.deepEqual(selectPortalCustomer([actiefTest, tweede], false), {
    action: 'ambiguous',
  });
});

test('test- en liverij naast elkaar: alleen de rij van de actieve modus wint', () => {
  const liveRow = { stripe_customer_id: 'cus_L', livemode: true, status: 'active' };
  assert.deepEqual(selectPortalCustomer([actiefTest, liveRow], false), {
    action: 'open',
    stripeCustomerId: 'cus_A',
  });
  assert.deepEqual(selectPortalCustomer([actiefTest, liveRow], true), {
    action: 'open',
    stripeCustomerId: 'cus_L',
  });
});
