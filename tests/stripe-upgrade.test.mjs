// Stripe-upgrade-wiring (/upgrade → stripe-create-checkout): bewijst de
// GO-eisen van 21 jul 2026 — juiste aanroep per plan, dubbelklik-blokkade,
// attempt_id-hergebruik bij bewuste retry, Nederlandse foutafhandeling en
// de dynamische Basic/Premium-succestekst. Geen billinglogica hier: de
// checkout zelf is in de sandbox-ketentest al end-to-end bewezen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  createCheckoutController,
  startStripeCheckout,
  checkoutFunctionUrl,
  successPlanLabel,
  GENERIC_CHECKOUT_ERROR,
  NETWORK_CHECKOUT_ERROR,
} = await import('../lib/stripe-upgrade.ts');

// ── Controller: dubbelklik + attempt_id-semantiek ───────────────────────────

test('dubbelklik: tweede begin() tijdens een lopende poging geeft null', () => {
  let n = 0;
  const c = createCheckoutController(() => `uuid-${++n}`);
  assert.equal(c.begin('basic'), 'uuid-1');
  assert.equal(c.begin('basic'), null); // dubbelklik zelfde knop
  assert.equal(c.begin('premium'), null); // andere knop tijdens in-flight
  assert.equal(c.inFlight(), 'basic');
});

test('bewuste retry na fout hergebruikt DEZELFDE attempt_id', () => {
  let n = 0;
  const c = createCheckoutController(() => `uuid-${++n}`);
  const eerste = c.begin('basic');
  c.fail('basic');
  const retry = c.begin('basic');
  assert.equal(retry, eerste); // zelfde poging → zelfde idempotency-basis
  assert.equal(n, 1); // geen tweede uuid gegenereerd
});

test('een ander plan is een andere poging met een eigen attempt_id', () => {
  let n = 0;
  const c = createCheckoutController(() => `uuid-${++n}`);
  const basic = c.begin('basic');
  c.fail('basic');
  const premium = c.begin('premium');
  assert.notEqual(premium, basic);
  assert.equal(n, 2);
});

// ── Aanroep: juiste endpoint, headers en payload per plan ───────────────────

function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return { calls, impl };
}

for (const plan of ['basic', 'premium']) {
  test(`${plan} roept stripe-create-checkout aan met school, plan en attempt_id`, async () => {
    const { calls, impl } = fakeFetch(200, { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_x', sessionId: 'cs_test_x' });
    const result = await startStripeCheckout({
      supabaseUrl: 'https://project.supabase.co',
      accessToken: 'jwt-123',
      schoolId: 'school-uuid',
      plan,
      attemptId: 'attempt-uuid',
      fetchImpl: impl,
    });
    assert.deepEqual(result, { ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_x' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://project.supabase.co/functions/v1/stripe-create-checkout');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt-123');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      school_id: 'school-uuid',
      plan,
      attempt_id: 'attempt-uuid',
    });
  });
}

test('checkoutFunctionUrl verdraagt een trailing slash', () => {
  assert.equal(
    checkoutFunctionUrl('https://project.supabase.co/'),
    'https://project.supabase.co/functions/v1/stripe-create-checkout',
  );
});

// ── Foutafhandeling: serverfout tonen, anders Nederlandse fallback ──────────

test('serverfout (bv. 422 profiel) toont de Nederlandse servertekst', async () => {
  const { impl } = fakeFetch(422, { error: 'Bedrijfsvorm ontbreekt — factuurnaam kan niet worden bepaald.' });
  const result = await startStripeCheckout({
    supabaseUrl: 'https://p.supabase.co', accessToken: 't', schoolId: 's',
    plan: 'basic', attemptId: 'a', fetchImpl: impl,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Bedrijfsvorm ontbreekt/);
});

test('fout zonder bruikbare tekst valt terug op de generieke Nederlandse melding', async () => {
  const { impl } = fakeFetch(500, {});
  const result = await startStripeCheckout({
    supabaseUrl: 'https://p.supabase.co', accessToken: 't', schoolId: 's',
    plan: 'basic', attemptId: 'a', fetchImpl: impl,
  });
  assert.deepEqual(result, { ok: false, error: GENERIC_CHECKOUT_ERROR });
});

test('200 zonder checkoutUrl is een fout, geen redirect naar undefined', async () => {
  const { impl } = fakeFetch(200, { sessionId: 'cs_test_x' });
  const result = await startStripeCheckout({
    supabaseUrl: 'https://p.supabase.co', accessToken: 't', schoolId: 's',
    plan: 'basic', attemptId: 'a', fetchImpl: impl,
  });
  assert.equal(result.ok, false);
});

test('netwerkfout geeft de Nederlandse verbindingstekst', async () => {
  const result = await startStripeCheckout({
    supabaseUrl: 'https://p.supabase.co', accessToken: 't', schoolId: 's',
    plan: 'basic', attemptId: 'a',
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });
  assert.deepEqual(result, { ok: false, error: NETWORK_CHECKOUT_ERROR });
});

// ── Succestekst: juist plan, nooit stil Premium ─────────────────────────────

test('succestekst: basic → Basic, premium → Premium (URL-param, Mollie-flow)', () => {
  assert.equal(successPlanLabel('basic', null), 'Basic');
  assert.equal(successPlanLabel('premium', null), 'Premium');
});

test('succestekst: zonder URL-param telt het opgeslagen plan (Stripe-flow)', () => {
  assert.equal(successPlanLabel(null, 'basic'), 'Basic');
  assert.equal(successPlanLabel(null, 'premium'), 'Premium');
});

test('succestekst: onbekend plan → neutraal (null), nooit stil Premium', () => {
  assert.equal(successPlanLabel(null, null), null);
  assert.equal(successPlanLabel('pro', 'iets'), null);
});

test('succestekst: URL-param wint van opgeslagen plan', () => {
  assert.equal(successPlanLabel('basic', 'premium'), 'Basic');
});
