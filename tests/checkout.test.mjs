// P0.1 — geldpadtests voor app/api/checkout/route.ts: de eerste (setup)
// betaling moet het BRUTO bedrag uit de prijs-SSoT naar Mollie sturen
// (€30,25 basic / €54,45 premium), en een onbekend plan moet fail-closed
// stoppen met 400 zónder enige Mollie-call.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.NEXT_PUBLIC_BASE_URL = 'https://preview.test';

let currentClient;
let mollie;
let billingEvents = [];

mock.module('@supabase/supabase-js', {
  namedExports: { createClient: () => currentClient },
});
mock.module('@mollie/api-client', {
  namedExports: { createMollieClient: () => mollie, SequenceType: { first: 'first' } },
});
mock.module('next/server', {
  namedExports: {
    NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    NextRequest: class NextRequest {},
  },
});
mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => true },
});
mock.module('@/lib/billing-events', {
  namedExports: { logBillingEvent: async (e) => { billingEvents.push(e); } },
});

const { POST } = await import('../app/api/checkout/route.ts');

const SCHOOL = '0218195e-0000-0000-0000-000000000000';
const CHAIN = ['select', 'update', 'eq', 'in', 'or', 'single', 'limit', 'order', 'maybeSingle', 'is', 'not', 'lt', 'gte', 'upsert'];

function makeClient(responses) {
  let i = 0;
  const calls = [];
  return {
    calls,
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    },
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

function makeMollie() {
  const calls = { paymentsCreate: [], customersCreate: [] };
  return {
    calls,
    payments: {
      create: async (p) => {
        calls.paymentsCreate.push(p);
        return { id: 'tr_TEST', getCheckoutUrl: () => 'https://mollie.test/checkout' };
      },
    },
    customers: {
      create: async (p) => {
        calls.customersCreate.push(p);
        return { id: 'cst_NEW' };
      },
    },
  };
}

function reqFor(body) {
  return {
    headers: {
      get: (k) => {
        if (k === 'x-forwarded-for') return '127.0.0.1';
        if (k === 'authorization') return 'Bearer test-token';
        return null;
      },
    },
    json: async () => body,
  };
}

function resetSpies() {
  billingEvents = [];
}

const INSTRUCTOR = { data: { id: 'ins-1' }, error: null };
const SCHOOL_ROW = { data: { name: 'Test School', email: 'test@example.com' }, error: null };
const LICENSE_WITH_CUSTOMER = {
  data: {
    id: 'lic-1',
    mollie_customer_id: 'cst_X',
    external_subscription_id: null,
    billing_plan: 'trial',
  },
  error: null,
};

test('C1: basic checkout → eerste betaling exact €30,25 bruto (€25 excl. + 21% btw)', async () => {
  resetSpies();
  mollie = makeMollie();
  currentClient = makeClient([
    INSTRUCTOR,                    // instructor-ownership check
    SCHOOL_ROW,                    // school lookup
    LICENSE_WITH_CUSTOMER,         // license lookup (customer bestaat al)
    { count: 10, error: null },    // basic-limiet: students count
    { count: 1, error: null },     // basic-limiet: instructors count
  ]);

  const res = await POST(reqFor({ school_id: SCHOOL, plan: 'basic' }));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.paymentsCreate.length, 1);
  const p = mollie.calls.paymentsCreate[0];
  assert.deepEqual(p.amount, { currency: 'EUR', value: '30.25' });
  assert.equal(p.description, 'Ribba Basic – Maandabonnement');
  assert.equal(p.sequenceType, 'first');
});

test('C2: premium checkout → eerste betaling exact €54,45 bruto (€45 excl. + 21% btw)', async () => {
  resetSpies();
  mollie = makeMollie();
  currentClient = makeClient([
    INSTRUCTOR,
    SCHOOL_ROW,
    LICENSE_WITH_CUSTOMER,
    // premium: geen limietchecks
  ]);

  const res = await POST(reqFor({ school_id: SCHOOL, plan: 'premium' }));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.paymentsCreate.length, 1);
  const p = mollie.calls.paymentsCreate[0];
  assert.deepEqual(p.amount, { currency: 'EUR', value: '54.45' });
  assert.equal(p.description, 'Ribba Premium – Maandabonnement');
});

test('C3: onbekend plan → 400 fail-closed, nul Supabase-queries, nul Mollie-calls', async () => {
  resetSpies();
  mollie = makeMollie();
  currentClient = makeClient([]);

  for (const bad of ['gold', 'trial', '', undefined]) {
    const res = await POST(reqFor({ school_id: SCHOOL, plan: bad }));
    assert.equal(res.status, 400);
  }
  assert.equal(mollie.calls.paymentsCreate.length, 0);
  assert.equal(mollie.calls.customersCreate.length, 0);
  assert.equal(currentClient.calls.length, 0);
  assert.equal(billingEvents.length, 0);
});
