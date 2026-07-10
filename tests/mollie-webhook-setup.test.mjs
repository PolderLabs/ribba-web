// Fase C — gerichte tests voor de setup-payment branch van
// app/api/mollie-webhook/route.ts, tegen de ECHTE receipts-helper
// (lib/billing-webhook-receipts.ts draait mee; alleen de randen zijn gemockt:
// Supabase-client, Mollie-client, next/server, mails, admin-notify en
// billing_events-audit).
//
// Dekt de 20 verplichte scenario's uit de Fase C-GO. Kanttekening: échte
// fysieke parallelliteit (unique-constraint-race) is met een gemockte DB
// principieel niet te bewijzen — dat leunt op Postgres en wordt in de
// E2E-verificatie (gecontroleerde redelivery) afgedekt. Hier wordt de
// verlies-kant van de race semantisch gescript (T4).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.NEXT_PUBLIC_BASE_URL = 'https://preview.test';

// ── Muteerbare test-doubles ─────────────────────────────────────────────────
let currentClient; // scripted supabase
let mollie; // per test geconfigureerde mollie-fake
let billingEvents = [];
let adminNotifyCalls = [];
let activatedMailCalls = [];

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
mock.module('@/lib/billing-events', {
  namedExports: { logBillingEvent: async (e) => { billingEvents.push(e); } },
});
mock.module('@/lib/admin-notifications', {
  namedExports: { sendAdminNotification: async (t, s) => { adminNotifyCalls.push({ t, s }); } },
});
mock.module('@/lib/school-emails', {
  namedExports: {
    sendSubscriptionActivatedMail: async (...a) => { activatedMailCalls.push(a); },
    sendRecurringPaymentFailedMail: async () => {},
    sendSubscriptionSuspendedMail: async () => {},
  },
});

const { POST } = await import('../app/api/mollie-webhook/route.ts');

// ── Fakes & fixtures ────────────────────────────────────────────────────────
const SCHOOL = '0218195e-0000-0000-0000-000000000000';
const CHAIN = ['upsert', 'select', 'update', 'eq', 'or', 'single', 'limit', 'order', 'maybeSingle', 'is', 'not', 'lt', 'gte'];

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

function makeMollie({ payment, createResult, createError, pageSubs = [], getSub } = {}) {
  const calls = { create: [], cancel: [], page: [], get: [] };
  return {
    calls,
    payments: { get: async () => payment },
    customerSubscriptions: {
      create: async (p) => {
        calls.create.push(p);
        if (createError) throw createError;
        return createResult ?? { id: 'sub_NEW', startDate: '2026-08-10' };
      },
      cancel: async (id, o) => { calls.cancel.push([id, o]); },
      page: async (p) => { calls.page.push(p); return pageSubs; },
      get: async (id, o) => { calls.get.push([id, o]); return getSub ?? { id, startDate: '2026-08-10' }; },
    },
  };
}

function paymentFake(overrides = {}) {
  const meta = {
    school_id: SCHOOL,
    plan: 'basic',
    type: 'subscription_setup',
    replaces_subscription_id: null,
    ...(overrides.metaOverrides ?? {}),
  };
  return {
    id: 'tr_NEW1',
    status: 'paid',
    customerId: 'cst_A',
    createdAt: '2026-07-10T12:00:00+00:00',
    ...overrides,
    metadata: JSON.stringify(meta),
  };
}

function licenseRow(overrides = {}) {
  return {
    id: 'lic-1',
    mollie_customer_id: 'cst_A',
    external_subscription_id: null,
    billing_plan: 'expired',
    is_trial: false,
    updated_at: '2026-07-01T00:00:00+00:00',
    ...overrides,
  };
}

const TOKEN = '2026-07-10T12:00:00.100000+00:00';

function receiptRow(overrides = {}) {
  return {
    id: 'rcpt-1',
    provider: 'mollie',
    event_kind: 'setup_payment_paid',
    external_event_id: 'tr_NEW1',
    school_id: SCHOOL,
    status: 'processing',
    side_effect_stage: 'claimed',
    result_subscription_id: null,
    attempt_count: 1,
    first_received_at: TOKEN,
    last_received_at: TOKEN,
    processing_started_at: TOKEN,
    payload_fingerprint: 'fp',
    last_error: null,
    ...overrides,
  };
}

function reqFor(payment) {
  return { formData: async () => ({ get: (k) => (k === 'id' ? payment.id : null) }) };
}

const OK_SCHOOL = { data: { id: SCHOOL }, error: null };
const MAIL_SCHOOL = { data: { name: 'Test School', email: 'test@example.com', city: 'R' }, error: null };

function resetSpies() {
  billingEvents = [];
  adminNotifyCalls = [];
  activatedMailCalls = [];
}

function eventTypes() {
  return billingEvents.map((e) => e.event_type);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 + 8 + 18 + D: eerste delivery — volledige happy path
test('T1/T8: eerste delivery → claim, create met setup_payment_id + idempotencyKey, license update, succeeded vóór mails, 200', async () => {
  resetSpies();
  const payment = paymentFake();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow()], error: null },          // claim gewonnen
    { data: licenseRow(), error: null },            // license
    { data: [receiptRow()], error: null },          // advance subscription_created
    { data: [licenseRow()], error: null },          // license update: exact 1 rij
    { data: [receiptRow()], error: null },          // advance license_updated
    { data: [receiptRow()], error: null },          // markSucceeded
    MAIL_SCHOOL,                                    // mails-blok school lookup
  ]);

  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);

  // D: metadata + idempotencyKey op de create
  assert.equal(mollie.calls.create.length, 1);
  const createParams = mollie.calls.create[0];
  assert.equal(createParams.idempotencyKey, 'tr_NEW1');
  const subMeta = JSON.parse(createParams.metadata);
  assert.equal(subMeta.setup_payment_id, 'tr_NEW1');
  assert.equal(subMeta.school_id, SCHOOL);
  assert.equal(subMeta.plan, 'basic');
  assert.equal(subMeta.type, 'recurring');

  // A: fingerprint deterministisch over uitsluitend de goedgekeurde velden
  const claimCall = currentClient.calls[1];
  const upsertRow = claimCall.ops.find(([m]) => m === 'upsert')[1];
  const expectedFp = createHash('sha256')
    .update(JSON.stringify({
      id: 'tr_NEW1', status: 'paid', customer_id: 'cst_A',
      school_id: SCHOOL, plan: 'basic', metadata_type: 'subscription_setup',
    }))
    .digest('hex');
  assert.equal(upsertRow.payload_fingerprint, expectedFp);

  // E: license update op exact de license-id, met .select() raak-verificatie
  const licUpdate = currentClient.calls[4];
  const licConds = Object.fromEntries(licUpdate.ops.filter(([m]) => m === 'eq').map(([, c, v]) => [c, v]));
  assert.equal(licConds.id, 'lic-1');

  // F/18: mails precies één keer, admin-notify subscription_activated één keer
  assert.equal(activatedMailCalls.length, 1);
  assert.equal(adminNotifyCalls.filter((c) => c.t === 'subscription_activated').length, 1);

  // B1-gate: eerste betaling zonder replaces_subscription_id → géén cancel
  assert.equal(mollie.calls.cancel.length, 0);

  // Audit: subscription_created, géén recovered/ignored/discarded
  assert.ok(eventTypes().includes('subscription_created'));
  assert.ok(!eventTypes().includes('setup_webhook_recovered'));
});

// 2 + 18 + 19: retry van succeeded receipt
test('T2: retry op succeeded receipt → no-op, ignored-event, 200, geen create/mails/notify', async () => {
  resetSpies();
  const payment = paymentFake();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },                                            // upsert conflict
    { data: receiptRow({ status: 'succeeded', side_effect_stage: 'completed' }), error: null },
    { data: null, error: null },                                          // bump
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.create.length, 0);
  assert.equal(mollie.calls.cancel.length, 0); // terminale redelivery: nooit een cancel
  assert.equal(activatedMailCalls.length, 0);
  assert.equal(adminNotifyCalls.length, 0);
  assert.deepEqual(eventTypes(), ['ignored_duplicate_setup_webhook']);
});

// 3: discarded backfill-hit (het tr_tw57…-scenario na Fase E)
test('T3: discarded backfill receipt → no-op + 200, geen admin-notify', async () => {
  resetSpies();
  const payment = paymentFake({ id: 'tr_OLD' });
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: receiptRow({ external_event_id: 'tr_OLD', status: 'discarded' }), error: null },
    { data: null, error: null },
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.create.length, 0);
  assert.equal(mollie.calls.cancel.length, 0); // terminale redelivery: nooit een cancel
  assert.equal(adminNotifyCalls.length, 0);
  const ev = billingEvents.find((e) => e.event_type === 'ignored_duplicate_setup_webhook');
  assert.equal(ev.payload.receipt_status, 'discarded');
});

// 4: gelijktijdige delivery (verlies-kant van de race)
test('T4: tweede gelijktijdige delivery ziet jonge processing → 500, nul side-effects', async () => {
  resetSpies();
  const payment = paymentFake();
  mollie = makeMollie({ payment });
  const young = receiptRow({ processing_started_at: new Date().toISOString() });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },   // conflict
    { data: young, error: null }, // fetch: processing, jong
    { data: [], error: null },   // herclaim verliest
    { data: young, error: null }, // re-read: nog steeds processing
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
  assert.equal(mollie.calls.create.length, 0);
  assert.equal(activatedMailCalls.length, 0);
});

// 5 + 20: ontbrekende license
test('T5: geen actieve license → receipt failed + 500, geen create, geen mails', async () => {
  resetSpies();
  const payment = paymentFake();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow()], error: null },
    { data: null, error: null },            // license: niet gevonden
    { data: [receiptRow()], error: null },  // markFailed
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
  assert.equal(mollie.calls.create.length, 0);
  assert.equal(activatedMailCalls.length, 0);
  const failOp = currentClient.calls[3].ops.find(([m]) => m === 'update');
  assert.equal(failOp[1].status, 'failed');
  assert.equal(failOp[1].last_error, 'active_license_not_found');
});

// 6 + 20: license-query error
test('T6: license-query DB-error → receipt failed + 500', async () => {
  resetSpies();
  const payment = paymentFake();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow()], error: null },
    { data: null, error: { message: 'connection reset' } },
    { data: [receiptRow()], error: null },
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
  assert.equal(mollie.calls.create.length, 0);
});

// 7 + 20: ontbrekende customer-id (CodeRabbit-punt: nooit doorvallen naar 200)
test('T7: geen customer-id → receipt failed + 500, geen mails, geen 200', async () => {
  resetSpies();
  const payment = paymentFake({ customerId: null });
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow()], error: null },
    { data: licenseRow({ mollie_customer_id: null }), error: null },
    { data: [receiptRow()], error: null },  // markFailed
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
  assert.equal(activatedMailCalls.length, 0);
  const failOp = currentClient.calls[3].ops.find(([m]) => m === 'update');
  assert.equal(failOp[1].last_error, 'no_customer_id');
});

// 9 + 20: create-fail
test('T9: Mollie create faalt → receipt failed (gefenced) + admin-notify + 500', async () => {
  resetSpies();
  const payment = paymentFake();
  mollie = makeMollie({ payment, createError: new Error('Mollie 500') });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow()], error: null },
    { data: licenseRow(), error: null },
    { data: [receiptRow()], error: null },  // markFailed
    MAIL_SCHOOL,                            // admin-notify lookup in catch
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
  assert.equal(adminNotifyCalls.filter((c) => c.t === 'subscription_creation_failed').length, 1);
  assert.ok(eventTypes().includes('subscription_creation_failed'));
  assert.equal(activatedMailCalls.length, 0);
  const failConds = Object.fromEntries(
    currentClient.calls[3].ops.filter(([m]) => m === 'eq').map(([, c, v]) => [c, v]),
  );
  assert.equal(failConds.processing_started_at, TOKEN); // fenced
});

// 10a + 19: recovery vanaf claimed — consult vindt de subscription
test('T10a: recovery@claimed, consult vindt sub → GEEN create, recovered-event, 200', async () => {
  resetSpies();
  const payment = paymentFake();
  const existingSub = {
    id: 'sub_EXIST', startDate: '2026-08-10', status: 'active',
    metadata: JSON.stringify({ setup_payment_id: 'tr_NEW1' }),
  };
  mollie = makeMollie({ payment, pageSubs: [existingSub] });
  const failedReceipt = receiptRow({ status: 'failed' });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: failedReceipt, error: null },
    { data: [{ ...failedReceipt, status: 'processing' }], error: null }, // herclaim wint
    { data: licenseRow(), error: null },
    { data: [receiptRow()], error: null },  // advance subscription_created
    { data: [licenseRow()], error: null },  // license update
    { data: [receiptRow()], error: null },  // advance license_updated
    { data: [receiptRow()], error: null },  // succeeded
    MAIL_SCHOOL,
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.create.length, 0);       // 19: geen tweede subscription
  assert.equal(mollie.calls.page.length, 1);
  const ev = billingEvents.find((e) => e.event_type === 'setup_webhook_recovered');
  assert.equal(ev.payload.created_in_recovery, false);
  assert.equal(ev.payload.external_subscription_id, 'sub_EXIST');
});

// 10b: recovery vanaf claimed — consult leeg → create mét idempotencyKey
test('T10b: recovery@claimed, consult leeg → create met idempotencyKey, recovered-event', async () => {
  resetSpies();
  const payment = paymentFake();
  mollie = makeMollie({ payment, pageSubs: [] });
  const failedReceipt = receiptRow({ status: 'failed' });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: failedReceipt, error: null },
    { data: [{ ...failedReceipt, status: 'processing' }], error: null },
    { data: licenseRow(), error: null },
    { data: [receiptRow()], error: null },
    { data: [licenseRow()], error: null },
    { data: [receiptRow()], error: null },
    { data: [receiptRow()], error: null },
    MAIL_SCHOOL,
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.create.length, 1);
  assert.equal(mollie.calls.create[0].idempotencyKey, 'tr_NEW1');
  const ev = billingEvents.find((e) => e.event_type === 'setup_webhook_recovered');
  assert.equal(ev.payload.created_in_recovery, true);
});

// 11 + 19: recovery vanaf subscription_created
test('T11: recovery@subscription_created → nooit create; license update + cancel (deze run voert de setup door) + succeeded', async () => {
  resetSpies();
  // Mét replaces: de eerste run crashte vóór de license-update, dus ook vóór de
  // cancel — de recovery-run die de license-update WEL uitvoert, moet de oude
  // sub alsnog cancelen (gate: ranLicenseUpdateThisRun).
  const payment = paymentFake({ metaOverrides: { replaces_subscription_id: 'sub_OLD' } });
  mollie = makeMollie({ payment });
  const r = receiptRow({ status: 'failed', side_effect_stage: 'subscription_created', result_subscription_id: 'sub_X' });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: r, error: null },
    { data: [{ ...r, status: 'processing' }], error: null },
    { data: licenseRow(), error: null },
    { data: [licenseRow()], error: null },  // license update (geen advance sub_created!)
    { data: [receiptRow()], error: null },  // advance license_updated
    { data: [receiptRow()], error: null },  // succeeded
    MAIL_SCHOOL,
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.create.length, 0);
  assert.equal(mollie.calls.page.length, 0);  // geen consult nodig: sub-id in receipt
  assert.equal(mollie.calls.get.length, 1);   // wel startDate ophalen voor period_end
  assert.equal(mollie.calls.cancel.length, 1); // cancel hoort bij deze run
  assert.equal(mollie.calls.cancel[0][0], 'sub_OLD');
});

// 12 + 18: recovery vanaf license_updated
test('T12: recovery@license_updated → alleen markSucceeded; geen create/update/mails, GEEN tweede cancel', async () => {
  resetSpies();
  // Mét replaces: recovery vanaf license_updated mag nooit opnieuw cancelen
  // (stage-regel G; ranLicenseUpdateThisRun blijft false in deze run).
  const payment = paymentFake({ metaOverrides: { replaces_subscription_id: 'sub_OLD' } });
  mollie = makeMollie({ payment });
  const r = receiptRow({ status: 'failed', side_effect_stage: 'license_updated', result_subscription_id: 'sub_X' });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: r, error: null },
    { data: [{ ...r, status: 'processing' }], error: null },
    // license is al geactiveerd door de gecrashte run:
    { data: licenseRow({ billing_plan: 'basic', external_subscription_id: 'sub_X' }), error: null },
    { data: [receiptRow()], error: null },  // markSucceeded — enige mutatie
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.create.length, 0);
  assert.equal(mollie.calls.cancel.length, 0); // geen tweede cancel
  assert.equal(activatedMailCalls.length, 0); // wasAlreadyActivated-gate
  assert.ok(eventTypes().includes('setup_webhook_recovered'));
});

// 13 + 20: license update raakt 0 rijen
test('T13: license update 0 rijen → failed + 500', async () => {
  resetSpies();
  const payment = paymentFake();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow()], error: null },
    { data: licenseRow(), error: null },
    { data: [receiptRow()], error: null },  // advance subscription_created
    { data: [], error: null },              // license update: 0 rijen!
    { data: [receiptRow()], error: null },  // markFailed
    MAIL_SCHOOL,                            // admin-notify lookup
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
  assert.equal(activatedMailCalls.length, 0);
});

// 14 + 20: license update DB-error
test('T14: license update DB-error → failed + 500', async () => {
  resetSpies();
  const payment = paymentFake();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow()], error: null },
    { data: licenseRow(), error: null },
    { data: [receiptRow()], error: null },
    { data: null, error: { message: 'update boom' } },
    { data: [receiptRow()], error: null },
    MAIL_SCHOOL,
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
});

// 15: legitieme planwissel mét B1-cancel (bewijst de gefixte cancel-gate)
test('T15: planwissel basic→premium → passeert gates, cancelt oude sub, geen dubbele mails', async () => {
  resetSpies();
  const payment = paymentFake({
    id: 'tr_SWITCH',
    metaOverrides: { plan: 'premium', replaces_subscription_id: 'sub_OLD' },
  });
  mollie = makeMollie({ payment, createResult: { id: 'sub_PREM', startDate: '2026-08-10' } });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow({ external_event_id: 'tr_SWITCH' })], error: null },
    // license actief op basic met de oude sub — planwissel-precondities
    { data: licenseRow({ billing_plan: 'basic', external_subscription_id: 'sub_OLD' }), error: null },
    { data: [receiptRow()], error: null },
    { data: [licenseRow()], error: null },
    { data: [receiptRow()], error: null },
    { data: [receiptRow()], error: null },  // succeeded
    // geen mails-lookup: wasAlreadyActivated=true
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.create.length, 1);
  assert.equal(JSON.parse(mollie.calls.create[0].metadata).plan, 'premium');
  // Dé B1-fix: oude subscription wordt nu WEL gecanceld bij planwissel
  assert.equal(mollie.calls.cancel.length, 1);
  assert.equal(mollie.calls.cancel[0][0], 'sub_OLD');
  assert.ok(eventTypes().includes('old_subscription_cancelled'));
  assert.equal(activatedMailCalls.length, 0); // mail-gate behouden
});

// 15b: spiegel-planwissel premium→basic — zelfde cancel-gedrag
test('T15b: planwissel premium→basic → cancelt exact sub_OLD', async () => {
  resetSpies();
  const payment = paymentFake({
    id: 'tr_DOWN',
    metaOverrides: { plan: 'basic', replaces_subscription_id: 'sub_OLD' },
  });
  mollie = makeMollie({ payment, createResult: { id: 'sub_BAS', startDate: '2026-08-10' } });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow({ external_event_id: 'tr_DOWN' })], error: null },
    // license actief op premium met de oude sub
    { data: licenseRow({ billing_plan: 'premium', external_subscription_id: 'sub_OLD' }), error: null },
    { data: [receiptRow()], error: null },
    { data: [licenseRow()], error: null },
    { data: [receiptRow()], error: null },
    { data: [receiptRow()], error: null },  // succeeded
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.create.length, 1);
  assert.equal(JSON.parse(mollie.calls.create[0].metadata).plan, 'basic');
  assert.equal(mollie.calls.cancel.length, 1);
  assert.equal(mollie.calls.cancel[0][0], 'sub_OLD');
  assert.ok(eventTypes().includes('old_subscription_cancelled'));
});

// 16: historische payment van een andere customer
test('T16: foreign customer → discarded + setup_webhook_discarded + 200, geen notify', async () => {
  resetSpies();
  const payment = paymentFake({ id: 'tr_HIST', customerId: 'cst_OUD' });
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow({ external_event_id: 'tr_HIST' })], error: null },
    { data: licenseRow({ mollie_customer_id: 'cst_NIEUW', external_subscription_id: 'sub_ACTIEF', billing_plan: 'basic' }), error: null },
    { data: [receiptRow()], error: null },  // markDiscarded
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.create.length, 0);
  assert.equal(adminNotifyCalls.length, 0);
  const ev = billingEvents.find((e) => e.event_type === 'setup_webhook_discarded');
  assert.equal(ev.payload.reason, 'foreign_customer');
  // Discard-conditie: alleen vanaf stage claimed, gefenced
  const conds = Object.fromEntries(currentClient.calls[3].ops.filter(([m]) => m === 'eq').map(([, c, v]) => [c, v]));
  assert.equal(conds.side_effect_stage, 'claimed');
});

// 17: historische payment, zelfde customer/plan, ouder dan huidige activatie
test('T17: stale duplicate (zelfde plan, oudere payment) → discarded + 200', async () => {
  resetSpies();
  const payment = paymentFake({ id: 'tr_HIST2', createdAt: '2026-06-24T00:14:00+00:00' });
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow({ external_event_id: 'tr_HIST2' })], error: null },
    { data: licenseRow({ billing_plan: 'basic', external_subscription_id: 'sub_ACTIEF', updated_at: '2026-07-10T09:08:52+00:00' }), error: null },
    { data: [receiptRow()], error: null },
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(mollie.calls.create.length, 0);
  const ev = billingEvents.find((e) => e.event_type === 'setup_webhook_discarded');
  assert.equal(ev.payload.reason, 'stale_duplicate');
});
