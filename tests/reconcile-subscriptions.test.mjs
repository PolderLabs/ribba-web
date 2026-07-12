// P0-fix tests voor app/api/cron/reconcile-subscriptions/route.ts:
// een license met cancelled_at IS NOT NULL mag nooit reconcile-kandidaat zijn.
//
// Kanttekening (zelfde als de webhook-tests): de daadwerkelijke uitfiltering
// gebeurt server-side in Postgres. Deze unit-tests bewijzen (a) dat de
// kandidaatquery het cancelled_at-filter bevat naast alle bestaande filters,
// en (b) dat een lege kandidatenlijst tot nul side-effects leidt, en (c) dat
// het bestaande create-pad voor geldige kandidaten ongewijzigd is. Het
// live-bewijs op echte data (CANCELLED_GRACE-rij matcht niet meer) is een
// aparte read-only SQL-verificatie.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.NEXT_PUBLIC_BASE_URL = 'https://preview.test';
process.env.CRON_SECRET = 'cron-secret-test';

let currentClient;
let mollie;
let billingEvents = [];
let adminNotifyCalls = [];

mock.module('@supabase/supabase-js', {
  namedExports: { createClient: () => currentClient },
});
mock.module('@mollie/api-client', {
  namedExports: { createMollieClient: () => mollie },
});
mock.module('next/server', {
  namedExports: {
    NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    NextRequest: class NextRequest {},
  },
});
mock.module('@/lib/billing-events', {
  namedExports: { logBillingEvent: async (e) => { billingEvents.push(e); } },
});
mock.module('@/lib/admin-notifications', {
  namedExports: { sendAdminNotification: async (t, s) => { adminNotifyCalls.push({ t, s }); } },
});

const { GET } = await import('../app/api/cron/reconcile-subscriptions/route.ts');

const CHAIN = ['select', 'update', 'eq', 'or', 'single', 'limit', 'order', 'maybeSingle', 'is', 'not', 'lt', 'gte', 'upsert'];

function makeClient(responses) {
  let i = 0;
  const calls = [];
  return {
    calls,
    from(table) {
      const response = responses[i++] ?? { data: null, error: { message: `no scripted response for call #${i}` } };
      const record = { table, ops: [] };
      calls.push(record);
      const builder = {};
      for (const m of CHAIN) {
        builder[m] = (...args) => { record.ops.push([m, ...args]); return builder; };
      }
      builder.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject);
      return builder;
    },
  };
}

function makeMollie({ createResult, createError } = {}) {
  const calls = { create: [] };
  return {
    calls,
    customerSubscriptions: {
      create: async (p) => {
        calls.create.push(p);
        if (createError) throw createError;
        return createResult ?? { id: 'sub_RECON', startDate: '2026-08-11' };
      },
    },
  };
}

function reqWithAuth(secret = 'cron-secret-test') {
  return { headers: { get: (k) => (k === 'authorization' ? `Bearer ${secret}` : null) } };
}

function resetSpies() {
  billingEvents = [];
  adminNotifyCalls = [];
}

test('T1: kandidaatquery bevat cancelled_at-filter naast ALLE bestaande filters; lege set → nul side-effects', async () => {
  resetSpies();
  mollie = makeMollie();
  currentClient = makeClient([{ data: [], error: null }]);

  const res = await GET(reqWithAuth());
  assert.equal(res.status, 200);
  assert.equal(res.body.checked, 0);

  const ops = currentClient.calls[0].ops;
  // Bestaande filters — ongewijzigd (eis 3)
  assert.deepEqual(ops.find(([m, col]) => m === 'eq' && col === 'status'), ['eq', 'status', 'active']);
  assert.deepEqual(ops.find(([m, col]) => m === 'eq' && col === 'is_trial'), ['eq', 'is_trial', false]);
  assert.deepEqual(ops.find(([m, col]) => m === 'not' && col === 'mollie_customer_id'), ['not', 'mollie_customer_id', 'is', null]);
  assert.deepEqual(ops.find(([m, col]) => m === 'is' && col === 'external_subscription_id'), ['is', 'external_subscription_id', null]);
  assert.equal(ops.some(([m, col]) => m === 'lt' && col === 'updated_at'), true);
  // P0-fix (eis 1): cancelled licenses zijn geen kandidaat
  assert.deepEqual(ops.find(([m, col]) => m === 'is' && col === 'cancelled_at'), ['is', 'cancelled_at', null]);

  // Lege kandidatenlijst (= wat Postgres retourneert voor een CANCELLED_GRACE-rij
  // met dit filter): geen create, geen license-update, geen events, geen mails
  assert.equal(mollie.calls.create.length, 0);
  assert.equal(currentClient.calls.length, 1); // alleen de kandidaatquery
  assert.equal(billingEvents.length, 0);
  assert.equal(adminNotifyCalls.length, 0);
});

test('T2: geldige kandidaat (cancelled_at null) → bestaand create-pad ongewijzigd', async () => {
  resetSpies();
  mollie = makeMollie();
  const candidate = {
    id: 'lic-1',
    school_id: 'school-1',
    billing_plan: 'basic',
    mollie_customer_id: 'cst_X',
    updated_at: '2026-07-01T00:00:00+00:00',
  };
  currentClient = makeClient([
    { data: [candidate], error: null },  // kandidaatquery
    { data: null, error: null },         // license-update
  ]);

  const res = await GET(reqWithAuth());
  assert.equal(res.status, 200);
  assert.equal(res.body.checked, 1);
  assert.equal(res.body.fixed, 1);
  assert.equal(res.body.failed, 0);

  // Create met bestaande parameters (geen idempotencyKey/setup_payment_id —
  // reconcile-receipts zijn bewust buiten scope gehouden).
  // P0.1: bedrag komt uit de prijs-SSoT en is BRUTO (€25 excl. + 21% btw).
  assert.equal(mollie.calls.create.length, 1);
  const created = mollie.calls.create[0];
  assert.equal(created.customerId, 'cst_X');
  assert.deepEqual(created.amount, { currency: 'EUR', value: '30.25' });
  assert.equal(created.interval, '1 month');
  assert.equal('idempotencyKey' in created, false);

  // License-update + audit-event zoals voorheen
  const updOps = currentClient.calls[1].ops;
  const upd = updOps.find(([m]) => m === 'update')[1];
  assert.equal(upd.external_subscription_id, 'sub_RECON');
  assert.equal('cancelled_at' in upd, false); // raakt cancelled_at nooit aan
  assert.deepEqual(billingEvents.map((e) => e.event_type), ['subscription_reconciled']);
});

test('T2b: premium-kandidaat → bruto €54,45 uit dezelfde SSoT', async () => {
  resetSpies();
  mollie = makeMollie();
  const candidate = {
    id: 'lic-2',
    school_id: 'school-2',
    billing_plan: 'premium',
    mollie_customer_id: 'cst_Y',
    updated_at: '2026-07-01T00:00:00+00:00',
  };
  currentClient = makeClient([
    { data: [candidate], error: null },
    { data: null, error: null },
  ]);

  const res = await GET(reqWithAuth());
  assert.equal(res.status, 200);
  assert.equal(res.body.fixed, 1);
  assert.deepEqual(mollie.calls.create[0].amount, { currency: 'EUR', value: '54.45' });
  assert.equal(mollie.calls.create[0].description, 'Ribba Premium – Maandabonnement');
});

test('T2c: onbekend plan → fail-closed skip, GEEN Mollie-call, geen fallback-bedrag', async () => {
  resetSpies();
  mollie = makeMollie();
  const candidate = {
    id: 'lic-3',
    school_id: 'school-3',
    billing_plan: 'legacy_gold', // bestaat niet — oude code viel stil terug op basic
    mollie_customer_id: 'cst_Z',
    updated_at: '2026-07-01T00:00:00+00:00',
  };
  currentClient = makeClient([
    { data: [candidate], error: null },
  ]);

  const res = await GET(reqWithAuth());
  assert.equal(res.status, 200);
  assert.equal(res.body.fixed, 0);
  assert.equal(res.body.failed, 0);
  assert.equal(mollie.calls.create.length, 0);           // nul Mollie-calls
  assert.equal(currentClient.calls.length, 1);           // alleen de kandidaatquery
  const ev = billingEvents.find((e) => e.event_type === 'unknown_plan_rejected');
  assert.equal(ev.payload.plan, 'legacy_gold');
  assert.equal(res.body.results[0].status, 'skipped');
});

test('T3: ongeldige CRON_SECRET → 401, geen queries', async () => {
  resetSpies();
  mollie = makeMollie();
  currentClient = makeClient([]);
  const res = await GET(reqWithAuth('wrong-secret'));
  assert.equal(res.status, 401);
  assert.equal(currentClient.calls.length, 0);
  assert.equal(mollie.calls.create.length, 0);
});
