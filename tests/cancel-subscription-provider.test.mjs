// P1 overgangsvariant: tests voor app/api/cancel-subscription/route.ts.
//
// De route is provider-aware gemaakt (tijdelijk, tot 0 Mollie-SaaS-abonnees):
//   - actieve Stripe-SaaS-school  → delegeer naar de stripe-cancel-subscription
//     edge function (JWT + school_id doorsturen); GEEN Stripe-logica hier;
//   - Mollie-SaaS-school (geen actieve Stripe-sub) → bestaande Mollie-flow;
//   - beide actieve providers      → fail closed (409), niets opzeggen, conflict loggen;
//   - geen enkel actief abonnement → 404;
//   - onbevoegd                    → 401/403.
//
// Provider-bepaling kijkt naar de ACTUELE actieve Stripe-status (niet "ooit een rij").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.MOLLIE_API_KEY = 'test-mollie-key';

let currentClient;
let mollie;
let billingEvents = [];
let adminNotifyCalls = [];
let fetchCalls = [];

mock.module('@supabase/supabase-js', { namedExports: { createClient: () => currentClient } });
mock.module('@mollie/api-client', { namedExports: { createMollieClient: () => mollie } });
mock.module('next/server', {
  namedExports: {
    NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    NextRequest: class NextRequest {},
  },
});
mock.module('@/lib/rate-limit', { namedExports: { rateLimit: () => true } });
mock.module('@/lib/billing-events', { namedExports: { logBillingEvent: async (e) => { billingEvents.push(e); } } });
mock.module('@/lib/admin-notifications', {
  namedExports: { sendAdminNotification: async (t, s) => { adminNotifyCalls.push({ t, s }); } },
});

const { POST } = await import('../app/api/cancel-subscription/route.ts');

const CHAIN = ['select', 'update', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single', 'is', 'not', 'or', 'lt', 'gte', 'upsert'];

function makeClient(responses, { user = { id: 'user-1' }, authError = null } = {}) {
  let i = 0;
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    from(table) {
      const response = responses[i++] ?? { data: null, error: null };
      const record = { table, ops: [] };
      calls.push(record);
      const builder = {};
      for (const m of CHAIN) builder[m] = (...args) => { record.ops.push([m, ...args]); return builder; };
      builder.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject);
      return builder;
    },
  };
}

function makeMollie({ cancelError } = {}) {
  const calls = { cancel: [] };
  return {
    calls,
    customerSubscriptions: {
      cancel: async (id, opts) => { calls.cancel.push({ id, opts }); if (cancelError) throw cancelError; return { id, status: 'canceled' }; },
    },
  };
}

function installFetch({ ok = true, status = 200, body = {} } = {}) {
  fetchCalls = [];
  globalThis.fetch = async (url, opts) => { fetchCalls.push({ url, opts }); return { ok, status, json: async () => body }; };
}

function makeReq({ auth = 'Bearer valid-token', schoolId = 'school-1' } = {}) {
  return {
    headers: { get: (k) => (k === 'x-forwarded-for' ? '1.2.3.4' : k === 'authorization' ? auth : null) },
    json: async () => ({ school_id: schoolId }),
  };
}

function reset() { billingEvents = []; adminNotifyCalls = []; fetchCalls = []; mollie = makeMollie(); installFetch(); }

// ── 1. Stripe: delegeren naar de edge function ───────────────────────────────
test('Stripe-school → delegeert naar stripe-cancel-subscription met doorgestuurde JWT, geen Mollie', async () => {
  reset();
  installFetch({ ok: true, status: 200, body: { cancel_at: '2026-08-22T00:00:00Z', scheduled: true } });
  currentClient = makeClient([
    { data: { id: 'instr-1' }, error: null },   // instructors (eigenaar)
    { data: [{ id: 'ssub-1' }], error: null },  // school_subscriptions (actieve Stripe)
    { data: { id: 'lic-1', mollie_customer_id: null, external_subscription_id: null, billing_plan: 'basic' }, error: null },
  ]);

  const res = await POST(makeReq());
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.provider, 'stripe');

  // exact één delegatie naar de edge function, met JWT + school_id
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://proj.supabase.co/functions/v1/stripe-cancel-subscription');
  assert.equal(fetchCalls[0].opts.headers.Authorization, 'Bearer valid-token');
  assert.deepEqual(JSON.parse(fetchCalls[0].opts.body), { school_id: 'school-1' });
  // GEEN directe Mollie- of Stripe-actie in de route zelf
  assert.equal(mollie.calls.cancel.length, 0);
});

test('Stripe-school → edge-function-fout wordt doorgegeven (status + melding), niets stil geslikt', async () => {
  reset();
  installFetch({ ok: false, status: 409, body: { error: 'Abonnement kan niet worden opgezegd.' } });
  currentClient = makeClient([
    { data: { id: 'instr-1' }, error: null },
    { data: [{ id: 'ssub-1' }], error: null },
    { data: { id: 'lic-1', mollie_customer_id: null, external_subscription_id: null }, error: null },
  ]);

  const res = await POST(makeReq());
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'Abonnement kan niet worden opgezegd.');
});

// ── 2. Mollie-regressie: bestaand pad ongewijzigd ────────────────────────────
test('Mollie-school (geen actieve Stripe-sub) → bestaande Mollie-opzegflow, geen edge-function', async () => {
  reset();
  currentClient = makeClient([
    { data: { id: 'instr-1' }, error: null },  // instructors
    { data: [], error: null },                 // school_subscriptions: GEEN actieve Stripe
    { data: { id: 'lic-1', mollie_customer_id: 'cst_X', external_subscription_id: 'sub_MOL', billing_plan: 'basic' }, error: null },
    { data: null, error: null },               // license-update
    { data: { name: 'Rijschool X', email: 'x@y.z', city: 'Rotterdam' }, error: null }, // drivingschools (admin-notify)
  ]);

  const res = await POST(makeReq());
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);

  // Mollie gecanceld met de opgeslagen identifiers; edge function NIET aangeroepen
  assert.equal(mollie.calls.cancel.length, 1);
  assert.equal(mollie.calls.cancel[0].id, 'sub_MOL');
  assert.equal(mollie.calls.cancel[0].opts.customerId, 'cst_X');
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(billingEvents.map((e) => e.event_type), ['subscription_cancelled']);
});

// ── 3. Conflict: twee actieve providers → fail closed ────────────────────────
test('actieve Stripe-sub ÉN Mollie-IDs → fail closed (409), niets opgezegd, conflict gelogd', async () => {
  reset();
  currentClient = makeClient([
    { data: { id: 'instr-1' }, error: null },
    { data: [{ id: 'ssub-1' }], error: null },  // actieve Stripe
    { data: { id: 'lic-1', mollie_customer_id: 'cst_X', external_subscription_id: 'sub_MOL', billing_plan: 'basic' }, error: null }, // Mollie-IDs
  ]);

  const res = await POST(makeReq());
  assert.equal(res.status, 409);
  // NIETS opgezegd
  assert.equal(mollie.calls.cancel.length, 0);
  assert.equal(fetchCalls.length, 0);
  // conflict gelogd
  assert.deepEqual(billingEvents.map((e) => e.event_type), ['cancel_provider_conflict']);
});

// ── 4. Geen abonnement → 404 ─────────────────────────────────────────────────
test('geen actieve Stripe-sub én geen Mollie-koppeling → 404, niets aangeroepen', async () => {
  reset();
  currentClient = makeClient([
    { data: { id: 'instr-1' }, error: null },
    { data: [], error: null },                 // geen actieve Stripe
    { data: { id: 'lic-1', mollie_customer_id: null, external_subscription_id: null }, error: null }, // geen Mollie
  ]);

  const res = await POST(makeReq());
  assert.equal(res.status, 404);
  assert.equal(mollie.calls.cancel.length, 0);
  assert.equal(fetchCalls.length, 0);
});

// ── 5. Onbevoegd ─────────────────────────────────────────────────────────────
test('ontbrekende Bearer → 401 (geen enkele lookup)', async () => {
  reset();
  currentClient = makeClient([]);
  const res = await POST(makeReq({ auth: null }));
  assert.equal(res.status, 401);
  assert.equal(currentClient.calls.length, 0);
});

test('geldige sessie maar niet-eigenaar van de school → 403 (vóór provider-bepaling)', async () => {
  reset();
  currentClient = makeClient([
    { data: null, error: null }, // instructors: geen eigenaarsrij
  ]);
  const res = await POST(makeReq());
  assert.equal(res.status, 403);
  // gestopt na de eigenaarscheck: geen provider-queries, niets opgezegd
  assert.equal(currentClient.calls.length, 1);
  assert.equal(mollie.calls.cancel.length, 0);
  assert.equal(fetchCalls.length, 0);
});
