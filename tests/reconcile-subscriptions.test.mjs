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

// De instructeurtelling (prijsbepaling: Premium bevat 5, daarboven €34 p/m)
// wordt apart bediend: ze verbruikt GEEN scripted response en komt niet in
// `calls`, zodat alle bestaande index-asserties (calls[1], calls[4], ...)
// blijven kloppen. Observeerbaar via `instructorCalls`.
function makeClient(responses, opts = {}) {
  let i = 0;
  const calls = [];
  const instructorCalls = [];
  const instructorCount = opts.instructorCount ?? 1;
  return {
    calls,
    instructorCalls,
    from(table) {
      if (table === 'instructors' && opts.countInstructors !== false) {
        instructorCalls.push(table);
        const builder = {};
        for (const m of CHAIN) builder[m] = () => builder;
        builder.then = (resolve, reject) =>
          Promise.resolve({ count: instructorCount, error: opts.instructorError ?? null }).then(resolve, reject);
        return builder;
      }
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

function makeMollie({ createResult, createError, getResult, getError, updateError } = {}) {
  const calls = { create: [], get: [], update: [] };
  return {
    calls,
    customerSubscriptions: {
      create: async (p) => {
        calls.create.push(p);
        if (createError) throw createError;
        return createResult ?? { id: 'sub_RECON', startDate: '2026-08-11' };
      },
      get: async (id, opts) => {
        calls.get.push({ id, ...opts });
        if (getError) throw getError;
        return getResult ?? { id, status: 'active', amount: { currency: 'EUR', value: '54.45' } };
      },
      update: async (id, p) => {
        calls.update.push({ id, ...p });
        if (updateError) throw updateError;
        return { id, ...p };
      },
    },
  };
}

// Een license die WEL een subscription heeft — kandidaat voor pas 2.
function subscribedLicense(overrides = {}) {
  return {
    id: 'lic-sub-1',
    school_id: 'school-sub-1',
    billing_plan: 'premium',
    mollie_customer_id: 'cst_S',
    external_subscription_id: 'sub_S',
    ...overrides,
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
  currentClient = makeClient([
    { data: [], error: null },  // pas 1: kandidaatquery
    { data: [], error: null },  // pas 2: bedrag-sync, ook leeg
  ]);

  const res = await GET(reqWithAuth());
  assert.equal(res.status, 200);
  assert.equal(res.body.checked, 0);
  assert.equal(res.body.amount_checked, 0);

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
  // Twee queries: de kandidaatquery van pas 1 en de bedrag-syncquery van pas 2.
  assert.equal(currentClient.calls.length, 2);
  assert.equal(billingEvents.length, 0);
  assert.equal(adminNotifyCalls.length, 0);

  // Pas 2 kijkt naar het spiegelbeeld van pas 1: juist licenses die WEL een
  // subscription hebben, en nooit een opgezegde.
  const syncOps = currentClient.calls[1].ops;
  assert.deepEqual(syncOps.find(([m, col]) => m === 'eq' && col === 'status'), ['eq', 'status', 'active']);
  assert.deepEqual(syncOps.find(([m, col]) => m === 'eq' && col === 'is_trial'), ['eq', 'is_trial', false]);
  assert.deepEqual(
    syncOps.find(([m, col]) => m === 'not' && col === 'external_subscription_id'),
    ['not', 'external_subscription_id', 'is', null],
  );
  assert.deepEqual(syncOps.find(([m, col]) => m === 'is' && col === 'cancelled_at'), ['is', 'cancelled_at', null]);
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
    { data: [], error: null },  // pas 2: geen subscriptions om te syncen
  ]);

  const res = await GET(reqWithAuth());
  assert.equal(res.status, 200);
  assert.equal(res.body.fixed, 0);
  assert.equal(res.body.failed, 0);
  assert.equal(mollie.calls.create.length, 0);           // nul Mollie-calls
  assert.equal(currentClient.calls.length, 2);           // kandidaatquery + sync-query
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


// ── Pas 2: bedrag meeschalen met de teamgrootte ───────────────────────────
//
// Besluit 14 aug 2026: geen proratie. Het Mollie-bedrag wordt bijgewerkt en
// geldt vanaf de volgende incasso; de lopende maand blijft ongemoeid.

test('S1: 7 instructeurs op een €54,45-subscription → bijgewerkt naar €136,73', async () => {
  resetSpies();
  mollie = makeMollie();
  currentClient = makeClient(
    [
      { data: [], error: null },                      // pas 1: geen kandidaten
      { data: [subscribedLicense()], error: null },   // pas 2
      { data: null, error: null },                    // price_per_month update
    ],
    { instructorCount: 7 },
  );

  const res = await GET(reqWithAuth());
  assert.equal(res.status, 200);
  assert.equal(res.body.amount_synced, 1);
  assert.equal(mollie.calls.update.length, 1);
  assert.deepEqual(mollie.calls.update[0].amount, { currency: 'EUR', value: '136.73' });
  assert.equal(mollie.calls.update[0].id, 'sub_S');
  assert.equal(mollie.calls.update[0].customerId, 'cst_S');

  // price_per_month = NETTO totaal (€45 + 2 × €34), niet de kale planprijs
  const upd = currentClient.calls[2].ops.find(([m]) => m === 'update');
  assert.equal(upd[1].price_per_month, 113);

  const ev = billingEvents.find((e) => e.event_type === 'subscription_amount_synced');
  assert.equal(ev.payload.instructors, 7);
  assert.equal(ev.payload.extra_instructors, 2);
  assert.equal(ev.payload.amount_from, '54.45');
  assert.equal(ev.payload.amount_to, '136.73');
});

test('S2: bedrag klopt al → geen Mollie-update, geen event', async () => {
  resetSpies();
  mollie = makeMollie();
  currentClient = makeClient(
    [
      { data: [], error: null },
      { data: [subscribedLicense()], error: null },
    ],
    { instructorCount: 4 },  // binnen de 5 → €54,45, gelijk aan de subscription
  );

  const res = await GET(reqWithAuth());
  assert.equal(res.body.amount_synced, 0);
  assert.equal(mollie.calls.update.length, 0);
  assert.equal(billingEvents.length, 0);
});

test('S3: gekrompen team → bedrag gaat op dezelfde manier omlaag', async () => {
  resetSpies();
  mollie = makeMollie({
    getResult: { id: 'sub_S', status: 'active', amount: { currency: 'EUR', value: '136.73' } },
  });
  currentClient = makeClient(
    [
      { data: [], error: null },
      { data: [subscribedLicense()], error: null },
      { data: null, error: null },
    ],
    { instructorCount: 3 },
  );

  const res = await GET(reqWithAuth());
  assert.equal(res.body.amount_synced, 1);
  assert.deepEqual(mollie.calls.update[0].amount, { currency: 'EUR', value: '54.45' });
});

test('S4: niet-actieve subscription → overgeslagen, nooit stilzwijgend bijwerken', async () => {
  resetSpies();
  mollie = makeMollie({
    getResult: { id: 'sub_S', status: 'suspended', amount: { currency: 'EUR', value: '54.45' } },
  });
  currentClient = makeClient(
    [
      { data: [], error: null },
      { data: [subscribedLicense()], error: null },
    ],
    { instructorCount: 9 },
  );

  const res = await GET(reqWithAuth());
  assert.equal(res.body.amount_synced, 0);
  assert.equal(mollie.calls.update.length, 0);
  assert.equal(res.body.amount_results[0].status, 'skipped');
  assert.match(res.body.amount_results[0].reason, /subscription_status:suspended/);
});

test('S5: mislukte telling → failed + event, geen Mollie-update (nooit gokken)', async () => {
  resetSpies();
  mollie = makeMollie();
  currentClient = makeClient(
    [
      { data: [], error: null },
      { data: [subscribedLicense()], error: null },
    ],
    { instructorError: { message: 'timeout' } },
  );

  const res = await GET(reqWithAuth());
  assert.equal(res.body.amount_failed, 1);
  assert.equal(mollie.calls.update.length, 0);
  assert.ok(billingEvents.some((e) => e.event_type === 'subscription_amount_sync_failed'));
});

test('S6: onbekend plan in pas 2 → skipped, geen Mollie-call', async () => {
  resetSpies();
  mollie = makeMollie();
  currentClient = makeClient(
    [
      { data: [], error: null },
      { data: [subscribedLicense({ billing_plan: 'legacy_gold' })], error: null },
    ],
    { instructorCount: 7 },
  );

  const res = await GET(reqWithAuth());
  assert.equal(res.body.amount_synced, 0);
  assert.equal(mollie.calls.get.length, 0);
  assert.equal(mollie.calls.update.length, 0);
  assert.equal(res.body.amount_results[0].status, 'skipped');
});

test('S7: Basic met meer dan 1 instructeur → fail-closed, geen bedragwijziging', async () => {
  resetSpies();
  mollie = makeMollie();
  currentClient = makeClient(
    [
      { data: [], error: null },
      { data: [subscribedLicense({ billing_plan: 'basic' })], error: null },
    ],
    { instructorCount: 3 },
  );

  const res = await GET(reqWithAuth());
  assert.equal(res.body.amount_failed, 1);
  assert.equal(mollie.calls.update.length, 0);
});
