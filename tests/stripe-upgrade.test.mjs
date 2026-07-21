// Stripe-upgrade-wiring (/upgrade → stripe-create-checkout, Mijn Ribba →
// stripe-portal-session): bewijst de GO-eisen van 21 jul 2026 — juiste
// aanroep per plan, dubbelklik-blokkade, attempt-semantiek (netwerkfout
// hervat dezelfde poging; definitieve HTTP-fout sluit af → nieuwe
// attempt_id), Nederlandse foutafhandeling en de portal-client zonder
// Stripe-secret in Vercel. Geen billinglogica hier: de keten zelf is in de
// sandbox-ketentest al end-to-end bewezen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  createCheckoutController,
  createPortalGate,
  startStripeCheckout,
  checkoutFunctionUrl,
  openStripePortal,
  portalFunctionUrl,
  GENERIC_CHECKOUT_ERROR,
  NETWORK_CHECKOUT_ERROR,
  GENERIC_PORTAL_ERROR,
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

test('netwerkfout (ambigue uitkomst): retry hervat DEZELFDE attempt_id', () => {
  let n = 0;
  const c = createCheckoutController(() => `uuid-${++n}`);
  const eerste = c.begin('basic');
  c.fail('basic', 'network');
  const retry = c.begin('basic');
  assert.equal(retry, eerste); // zelfde poging → zelfde idempotency-basis
  assert.equal(n, 1); // geen tweede uuid gegenereerd
});

test('definitieve HTTP-fout sluit de poging af: nieuwe klik = NIEUWE attempt_id', () => {
  let n = 0;
  const c = createCheckoutController(() => `uuid-${++n}`);
  const eerste = c.begin('basic');
  c.fail('basic', 'definitive');
  const nieuwe = c.begin('basic');
  assert.notEqual(nieuwe, eerste); // nooit vastzitten op een gecachte Stripe-fout
  assert.equal(n, 2);
});

test('een ander plan is een andere poging met een eigen attempt_id', () => {
  let n = 0;
  const c = createCheckoutController(() => `uuid-${++n}`);
  const basic = c.begin('basic');
  c.fail('basic', 'network');
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
  assert.equal(result.kind, 'definitive');
  assert.match(result.error, /Bedrijfsvorm ontbreekt/);
});

test('fout zonder bruikbare tekst valt terug op de generieke Nederlandse melding', async () => {
  const { impl } = fakeFetch(500, {});
  const result = await startStripeCheckout({
    supabaseUrl: 'https://p.supabase.co', accessToken: 't', schoolId: 's',
    plan: 'basic', attemptId: 'a', fetchImpl: impl,
  });
  assert.deepEqual(result, { ok: false, error: GENERIC_CHECKOUT_ERROR, kind: 'definitive' });
});

test('200 zonder checkoutUrl is een fout, geen redirect naar undefined', async () => {
  const { impl } = fakeFetch(200, { sessionId: 'cs_test_x' });
  const result = await startStripeCheckout({
    supabaseUrl: 'https://p.supabase.co', accessToken: 't', schoolId: 's',
    plan: 'basic', attemptId: 'a', fetchImpl: impl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'definitive');
});

test('netwerkfout geeft de Nederlandse verbindingstekst', async () => {
  const result = await startStripeCheckout({
    supabaseUrl: 'https://p.supabase.co', accessToken: 't', schoolId: 's',
    plan: 'basic', attemptId: 'a',
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });
  assert.deepEqual(result, { ok: false, error: NETWORK_CHECKOUT_ERROR, kind: 'network' });
});

// ── Mijn Ribba: portal via de edge function (geen Stripe-secret in Vercel) ──

test('openStripePortal roept stripe-portal-session aan met JWT en school_id', async () => {
  const { calls, impl } = fakeFetch(200, { url: 'https://billing.stripe.com/p/session/test_y' });
  const result = await openStripePortal({
    supabaseUrl: 'https://project.supabase.co',
    accessToken: 'jwt-456',
    schoolId: 'school-uuid',
    fetchImpl: impl,
  });
  assert.deepEqual(result, { ok: true, url: 'https://billing.stripe.com/p/session/test_y' });
  assert.equal(calls[0].url, 'https://project.supabase.co/functions/v1/stripe-portal-session');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt-456');
  assert.deepEqual(JSON.parse(calls[0].init.body), { school_id: 'school-uuid' });
});

test('portal: serverfout (bv. 409 geen koppeling) toont de Nederlandse servertekst', async () => {
  const { impl } = fakeFetch(409, { error: 'Er is nog geen actieve Stripe-koppeling voor deze rijschool. Kies eerst een abonnement via de upgradepagina.' });
  const result = await openStripePortal({
    supabaseUrl: 'https://p.supabase.co', accessToken: 't', schoolId: 's', fetchImpl: impl,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /nog geen actieve Stripe-koppeling/);
});

test('portal: fout zonder bruikbare tekst valt terug op de generieke melding', async () => {
  const { impl } = fakeFetch(500, {});
  const result = await openStripePortal({
    supabaseUrl: 'https://p.supabase.co', accessToken: 't', schoolId: 's', fetchImpl: impl,
  });
  assert.deepEqual(result, { ok: false, error: GENERIC_PORTAL_ERROR });
});

test('portalFunctionUrl verdraagt een trailing slash', () => {
  assert.equal(
    portalFunctionUrl('https://project.supabase.co/'),
    'https://project.supabase.co/functions/v1/stripe-portal-session',
  );
});

// ── Portal-dubbelklik: synchrone request-level gate (correctie 21 jul) ──────
// Zelfde compositie als app/mijn-ribba/page.tsx: lock vóór fetch, vrijgave
// in finally. Bewust GEEN attempt_id — de gate bewaakt alleen het aantal
// requests, een portal-sessie kent geen idempotente resource.

function gateGuardedPortalCall(gate, fetchImpl) {
  if (!gate.begin()) return Promise.resolve('geblokkeerd');
  return openStripePortal({
    supabaseUrl: 'https://p.supabase.co', accessToken: 't', schoolId: 's', fetchImpl,
  }).finally(() => gate.end());
}

test('twee onmiddellijke portal-aanroepen leveren exact één request op', async () => {
  const gate = createPortalGate();
  let requests = 0;
  const traag = () => new Promise((r) => setTimeout(() => {
    requests++;
    r({ ok: true, status: 200, json: async () => ({ url: 'https://billing.stripe.com/p/s/1' }) });
  }, 10));
  const [eerste, tweede] = await Promise.all([
    gateGuardedPortalCall(gate, traag),
    gateGuardedPortalCall(gate, traag),
  ]);
  assert.equal(requests, 1);
  assert.deepEqual(eerste, { ok: true, url: 'https://billing.stripe.com/p/s/1' });
  assert.equal(tweede, 'geblokkeerd'); // stopte vóór de fetch
});

test('gate komt vrij na een definitieve fout (403/409)', async () => {
  const gate = createPortalGate();
  const { impl } = fakeFetch(403, { error: 'Geen toegang.', reason: 'forbidden' });
  const result = await gateGuardedPortalCall(gate, impl);
  assert.equal(result.ok, false);
  assert.equal(gate.inFlight(), false);
  assert.equal(gate.begin(), true); // volgende bewuste poging kan
  gate.end();
});

test('gate komt vrij na een netwerkfout', async () => {
  const gate = createPortalGate();
  const result = await gateGuardedPortalCall(gate, async () => { throw new TypeError('fetch failed'); });
  assert.equal(result.ok, false);
  assert.equal(gate.inFlight(), false);
  assert.equal(gate.begin(), true);
  gate.end();
});

test('na terugkeer van de eerste aanroep kan bewust een nieuwe portalsessie starten', async () => {
  const gate = createPortalGate();
  let requests = 0;
  const impl = async () => {
    requests++;
    return { ok: true, status: 200, json: async () => ({ url: `https://billing.stripe.com/p/s/${requests}` }) };
  };
  const eerste = await gateGuardedPortalCall(gate, impl);
  const tweede = await gateGuardedPortalCall(gate, impl);
  assert.deepEqual(eerste, { ok: true, url: 'https://billing.stripe.com/p/s/1' });
  assert.deepEqual(tweede, { ok: true, url: 'https://billing.stripe.com/p/s/2' });
  assert.equal(requests, 2); // twee BEWUSTE, opeenvolgende sessies — geen blokkade
});
