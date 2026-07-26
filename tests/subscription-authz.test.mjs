// Fase 0 van het schoollicentie-epic — autorisatiematrix op de MUTERENDE
// abonnementsroutes (/api/checkout en /api/cancel-subscription).
//
// Tot 25 jul 2026 autoriseerden beide routes op "actieve instructeur van deze
// rijschool", zonder rolcheck. Omdat /upgrade het school_id uit het ingelogde
// account afleidt, kwam élke medewerker daar langs de normale weg terecht en
// kon hij het abonnement van de rijschool afsluiten én opzeggen.
//
// Wat deze tests vastleggen:
//
//   1. FILTERBEWIJS. De autorisatiequery filtert op user_id + drivingschool_id
//      + status='active' + school_role in ('owner','admin'). Dat is de kern:
//      juist die vier filters maken dat álle drie de weigergevallen (employee,
//      geen schoolkoppeling, verkeerde school) per constructie geen rij
//      opleveren. Zonder deze assertie zou een 403 in de tests hieronder ook
//      per ongeluk kunnen ontstaan.
//   2. FAIL-CLOSED. Levert die query geen rij op, dan 403 met een stabiele
//      reason-identiteit, en NUL zijeffecten: geen Mollie-call, geen verdere
//      query, geen billing-event.
//   3. DOORLAAT. Owner en admin komen wél langs de rolcheck. Bewust bewezen
//      met een ONSCHADELIJKE fout direct ná de check (school niet gevonden /
//      providerlookup faalt), zodat er in geen enkele test een echte checkout
//      of opzegging wordt nagespeeld.
//
// Eigenaar-only volgt in fase 2, na de owner-backfill. Zie
// docs/design/schoollicentie-epic-canoniek-plan-2026-07-25.md in ribbaPro.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.MOLLIE_API_KEY = 'test-mollie-key';
process.env.NEXT_PUBLIC_BASE_URL = 'https://preview.test';

let currentClient;
let mollie;
let billingEvents = [];
let adminNotifyCalls = [];

mock.module('@supabase/supabase-js', { namedExports: { createClient: () => currentClient } });
mock.module('@mollie/api-client', {
  namedExports: { createMollieClient: () => mollie, SequenceType: { first: 'first' } },
});
mock.module('next/server', {
  namedExports: {
    NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    NextRequest: class NextRequest {},
  },
});
mock.module('@/lib/rate-limit', { namedExports: { rateLimit: () => true } });
mock.module('@/lib/billing-events', {
  namedExports: { logBillingEvent: async (e) => { billingEvents.push(e); } },
});
mock.module('@/lib/admin-notifications', {
  namedExports: { sendAdminNotification: async (t, s) => { adminNotifyCalls.push({ t, s }); } },
});

const { POST: checkoutPOST } = await import('../app/api/checkout/route.ts');
const { POST: cancelPOST } = await import('../app/api/cancel-subscription/route.ts');

const SCHOOL = '0218195e-0000-0000-0000-000000000000';
const CHAIN = ['select', 'update', 'eq', 'in', 'or', 'single', 'limit', 'order', 'maybeSingle', 'is', 'not', 'lt', 'gte', 'upsert'];

function makeClient(responses, { user = { id: 'user-1' } } = {}) {
  let i = 0;
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
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

function makeMollie() {
  const calls = { paymentsCreate: [], customersCreate: [], subscriptionsCancel: [] };
  return {
    calls,
    payments: {
      create: async (p) => { calls.paymentsCreate.push(p); return { id: 'tr_X', getCheckoutUrl: () => 'https://mollie.test/c' }; },
    },
    customers: {
      create: async (p) => { calls.customersCreate.push(p); return { id: 'cst_NEW' }; },
      createSubscription: async () => ({ id: 'sub_X' }),
      cancelSubscription: async (...a) => { calls.subscriptionsCancel.push(a); return {}; },
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

function reset() {
  billingEvents = [];
  adminNotifyCalls = [];
  mollie = makeMollie();
}

/** Geen rij: exact wat de DB teruggeeft bij employee, geen koppeling én verkeerde school. */
const NO_ROW = { data: null, error: null };
const IS_OWNER = { data: { id: 'ins-owner' }, error: null };
const IS_ADMIN = { data: { id: 'ins-admin' }, error: null };

/** Vind de ops van de eerste instructors-query (= de autorisatiecheck). */
function authzOps(client) {
  const call = client.calls.find((c) => c.table === 'instructors');
  assert.ok(call, 'verwachtte een autorisatiequery op instructors');
  return call.ops;
}

function assertAuthzFilters(client) {
  const ops = authzOps(client);
  const eqs = ops.filter(([m]) => m === 'eq').map(([, col, val]) => [col, val]);
  const ins = ops.filter(([m]) => m === 'in').map(([, col, val]) => [col, val]);

  assert.deepEqual(eqs.find(([c]) => c === 'user_id'), ['user_id', 'user-1'],
    'moet op de INGELOGDE gebruiker filteren — anders kan een ander account meeliften');
  assert.deepEqual(eqs.find(([c]) => c === 'drivingschool_id'), ['drivingschool_id', SCHOOL],
    'moet op de GEVRAAGDE school filteren — anders werkt een rol bij school A ook op school B');
  assert.deepEqual(eqs.find(([c]) => c === 'status'), ['status', 'active'],
    'moet op een ACTIEVE instructeursrij filteren');
  assert.deepEqual(ins.find(([c]) => c === 'school_role'), ['school_role', ['owner', 'admin']],
    'moet op admin-niveau filteren — dit is de hele fase-0-wijziging');
}

// ── /api/checkout ──────────────────────────────────────────────────────

test('checkout — autorisatiequery filtert op gebruiker, school, actief én rol', async () => {
  reset();
  currentClient = makeClient([NO_ROW]);
  await checkoutPOST(reqFor({ school_id: SCHOOL, plan: 'premium' }));
  assertAuthzFilters(currentClient);
});

for (const geval of [
  'employee van deze rijschool',
  'gebruiker zonder enige schoolkoppeling',
  'gebruiker van een ANDERE rijschool',
]) {
  test(`checkout — ${geval} → 403 fail-closed, nul zijeffecten`, async () => {
    reset();
    // Alle drie leveren per constructie geen rij op: de query filtert op
    // user_id + drivingschool_id + status + school_role (zie de test hierboven).
    currentClient = makeClient([NO_ROW]);

    const res = await checkoutPOST(reqFor({ school_id: SCHOOL, plan: 'premium' }));

    assert.equal(res.status, 403);
    assert.equal(res.body.reason, 'subscription_management_forbidden');
    assert.equal(mollie.calls.paymentsCreate.length, 0, 'geen betaling aangemaakt');
    assert.equal(mollie.calls.customersCreate.length, 0, 'geen Mollie-customer aangemaakt');
    assert.equal(currentClient.calls.length, 1, 'gestopt ná de autorisatiequery, geen enkele vervolgquery');
    assert.equal(billingEvents.length, 0);
  });
}

for (const [rol, rij] of [['owner', IS_OWNER], ['admin', IS_ADMIN]]) {
  test(`checkout — ${rol} komt langs de rolcheck (bewezen met een onschadelijke fout erná)`, async () => {
    reset();
    // Bewust géén echte checkout: de school-lookup direct ná de rolcheck geeft
    // niets terug, dus de route stopt daar. Dat bewijst de doorlaat zonder een
    // betaling of mandaat na te spelen.
    currentClient = makeClient([rij, { data: null, error: null }]);

    const res = await checkoutPOST(reqFor({ school_id: SCHOOL, plan: 'premium' }));

    assert.notEqual(res.status, 403, `${rol} mag niet op de rolcheck stranden`);
    assert.ok(currentClient.calls.length >= 2, 'moet voorbij de autorisatiequery zijn gekomen');
    assert.equal(currentClient.calls[1].table, 'drivingschools');
    assert.equal(mollie.calls.paymentsCreate.length, 0, 'geen echte checkout in deze test');
  });
}

// ── /api/cancel-subscription ───────────────────────────────────────────

test('opzeggen — autorisatiequery filtert op gebruiker, school, actief én rol', async () => {
  reset();
  currentClient = makeClient([NO_ROW]);
  await cancelPOST(reqFor({ school_id: SCHOOL }));
  assertAuthzFilters(currentClient);
});

for (const geval of [
  'employee van deze rijschool',
  'gebruiker zonder enige schoolkoppeling',
  'gebruiker van een ANDERE rijschool',
]) {
  test(`opzeggen — ${geval} → 403 fail-closed, niets opgezegd`, async () => {
    reset();
    currentClient = makeClient([NO_ROW]);

    const res = await cancelPOST(reqFor({ school_id: SCHOOL }));

    assert.equal(res.status, 403);
    assert.equal(res.body.reason, 'subscription_management_forbidden');
    assert.equal(mollie.calls.subscriptionsCancel.length, 0, 'geen abonnement opgezegd');
    assert.equal(currentClient.calls.length, 1, 'gestopt ná de autorisatiequery');
    assert.equal(billingEvents.length, 0);
  });
}

for (const [rol, rij] of [['owner', IS_OWNER], ['admin', IS_ADMIN]]) {
  test(`opzeggen — ${rol} komt langs de rolcheck (bewezen met een onschadelijke fout erná)`, async () => {
    reset();
    // De providerlookup direct ná de rolcheck faalt bewust → de route stopt
    // fail-closed met 500. Geen enkele opzegging wordt nagespeeld.
    currentClient = makeClient([rij, { data: null, error: { message: 'gesimuleerde lookupfout' } }]);

    const res = await cancelPOST(reqFor({ school_id: SCHOOL }));

    assert.notEqual(res.status, 403, `${rol} mag niet op de rolcheck stranden`);
    assert.equal(res.status, 500);
    assert.equal(currentClient.calls[1].table, 'school_subscriptions');
    assert.equal(mollie.calls.subscriptionsCancel.length, 0, 'geen echte opzegging in deze test');
    assert.equal(billingEvents.at(-1)?.event_type, 'cancel_provider_lookup_failed');
  });
}
