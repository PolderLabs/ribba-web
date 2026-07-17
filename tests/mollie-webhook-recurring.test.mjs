// Fase 1 Billing Engine — gerichte tests voor de recurring-branches van
// app/api/mollie-webhook/route.ts (paid + failed), tegen de ECHTE
// receipts-helper (lib/billing-webhook-receipts.ts draait mee; alleen de
// randen zijn gemockt: Supabase-client, Mollie-client, next/server, mails,
// admin-notify en billing_events-audit).
//
// Doel: één Mollie recurring payment ID = maximaal één effectieve
// licentie-update. Kern van het bewijs sinds Fase 1B/1C:
//   - paid: de license-update en de receipt-stage-advance gebeuren ATOMAIR
//     in de database via de RPC apply_recurring_paid_and_advance_receipt
//     (ribbaPro-migratie 20260717120000). outcome=already_advanced is het
//     enige — payment-specifieke — bewijs dat de update al is toegepast;
//     er bestaat geen period_end-heuristiek meer.
//   - failed: de teller-increment draagt zijn eigen marker
//     (last_failed_payment_at = receipt.first_received_at) in dezelfde
//     atomaire rij-update.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.NEXT_PUBLIC_BASE_URL = 'https://preview.test';

// ── Muteerbare test-doubles ─────────────────────────────────────────────────
let currentClient; // scripted supabase
let mollie; // per test geconfigureerde mollie-fake
let billingEvents = [];
let adminNotifyCalls = [];
let failedMailCalls = [];
let suspendedMailCalls = [];
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
    sendRecurringPaymentFailedMail: async (...a) => { failedMailCalls.push(a); },
    sendSubscriptionSuspendedMail: async (...a) => { suspendedMailCalls.push(a); },
  },
});

const { POST } = await import('../app/api/mollie-webhook/route.ts');

// ── Fakes & fixtures ────────────────────────────────────────────────────────
const SCHOOL = '0218195e-0000-0000-0000-000000000000';
const CHAIN = ['upsert', 'select', 'update', 'eq', 'or', 'single', 'limit', 'order', 'maybeSingle', 'is', 'not', 'lt', 'gte'];

function makeClient(responses) {
  let i = 0;
  const calls = [];
  const rpcCalls = [];
  return {
    calls,
    rpcCalls,
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
    rpc(name, args) {
      const response = responses[i++] ?? { data: null, error: { message: `no scripted response for rpc call #${i}` } };
      calls.push({ table: `rpc:${name}`, ops: [['rpc', name, args]] });
      rpcCalls.push({ name, args });
      return Promise.resolve(response);
    },
  };
}

function makeMollie({ payment } = {}) {
  const calls = { create: [], cancel: [], page: [], get: [] };
  return {
    calls,
    payments: { get: async () => payment },
    customerSubscriptions: {
      create: async (p) => { calls.create.push(p); return { id: 'sub_NEW', startDate: '2026-08-10' }; },
      cancel: async (id, o) => { calls.cancel.push([id, o]); },
      page: async (p) => { calls.page.push(p); return []; },
      get: async (id, o) => { calls.get.push([id, o]); return { id, startDate: '2026-08-10' }; },
    },
  };
}

function recurringPayment(overrides = {}) {
  const meta = {
    school_id: SCHOOL,
    plan: 'basic',
    type: 'recurring',
    ...(overrides.metaOverrides ?? {}),
  };
  return {
    id: 'tr_REC1',
    status: 'paid',
    customerId: 'cst_A',
    subscriptionId: 'sub_A',
    createdAt: '2026-07-15T09:00:00+00:00',
    ...overrides,
    metadata: JSON.stringify(meta),
  };
}

function paidLicenseRow(overrides = {}) {
  return {
    id: 'lic-1',
    cancelled_at: null,
    period_end: '2026-07-20T00:00:00+00:00',
    billing_plan: 'basic',
    external_subscription_id: 'sub_A',
    ...overrides,
  };
}

function failedLicenseRow(overrides = {}) {
  return {
    id: 'lic-1',
    failed_payment_count: 0,
    last_failed_payment_at: null,
    mollie_customer_id: 'cst_A',
    external_subscription_id: 'sub_A',
    ...overrides,
  };
}

const TOKEN = '2026-07-15T09:00:00.100000+00:00';

// Deterministische verwachtingen, afgeleid van first_received_at (= TOKEN):
// identiek aan de berekening in de route ("verwerkingsmoment + 1 maand").
const EXPECTED_PERIOD_END = (() => {
  const d = new Date(TOKEN);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
})();
const EXPECTED_FAILED_MARKER = new Date(TOKEN).toISOString();

// De exacte argumenten waarmee het paid-pad de RPC hoort aan te roepen.
const EXPECTED_RPC_ARGS = {
  p_provider: 'mollie',
  p_event_kind: 'recurring_payment_paid',
  p_external_event_id: 'tr_REC1',
  p_claim_token: TOKEN,
  p_license_id: 'lic-1',
  p_new_period_end: EXPECTED_PERIOD_END,
  p_result_subscription_id: 'sub_A',
};

function receiptRow(eventKind, overrides = {}) {
  return {
    id: 'rcpt-1',
    provider: 'mollie',
    event_kind: eventKind,
    external_event_id: 'tr_REC1',
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
const RPC_APPLIED = { data: { outcome: 'applied' }, error: null };

function resetSpies() {
  billingEvents = [];
  adminNotifyCalls = [];
  failedMailCalls = [];
  suspendedMailCalls = [];
  activatedMailCalls = [];
}

function eventTypes() {
  return billingEvents.map((e) => e.event_type);
}

function licenseUpdateCalls(client) {
  return client.calls.filter(
    (c) => c.table === 'instructor_licenses' && c.ops.some(([m]) => m === 'update'),
  );
}

// ═════════════════════════════════════════ PAID RECURRING ═══════════════════

// R1 — eerste delivery: RPC applied
test('R1: paid eerste delivery → exact één RPC-call met alle 7 argumenten, GEEN losse license-update, succeeded, één event, 200', async () => {
  resetSpies();
  const payment = recurringPayment();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow('recurring_payment_paid')], error: null }, // claim gewonnen
    { data: paidLicenseRow(), error: null },                       // license lookup (B2 + correlatie)
    RPC_APPLIED,                                                   // atomaire RPC
    { data: [receiptRow('recurring_payment_paid')], error: null }, // markSucceeded
  ]);

  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);

  // Exact één RPC-call, met precies de zeven contractargumenten
  assert.equal(currentClient.rpcCalls.length, 1);
  assert.equal(currentClient.rpcCalls[0].name, 'apply_recurring_paid_and_advance_receipt');
  assert.deepEqual(currentClient.rpcCalls[0].args, EXPECTED_RPC_ARGS);

  // GEEN losse license-update en GEEN losse stage-advance meer
  assert.equal(licenseUpdateCalls(currentClient).length, 0);

  // Terminalisering: gefenced op stage license_updated (door de RPC gezet)
  const termConds = Object.fromEntries(currentClient.calls[4].ops.filter(([m]) => m === 'eq').map(([, c, v]) => [c, v]));
  assert.equal(termConds.side_effect_stage, 'license_updated');
  assert.equal(termConds.processing_started_at, TOKEN);

  assert.deepEqual(eventTypes(), ['recurring_payment_paid']);
  assert.equal(billingEvents[0].payload.new_period_end, EXPECTED_PERIOD_END);
  assert.equal(billingEvents[0].payload.rpc_outcome, 'applied');
  assert.equal(mollie.calls.create.length, 0);
  assert.equal(mollie.calls.cancel.length, 0);
});

// R2 — dezelfde paid-webhook tweemaal: claim vangt af vóór de RPC
test('R2: paid duplicate op terminal receipt → 200, RPC NIET aangeroepen, geen dubbele events', async () => {
  resetSpies();
  const payment = recurringPayment();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },                                                                   // upsert: conflict
    { data: receiptRow('recurring_payment_paid', { status: 'succeeded', side_effect_stage: 'completed', result_subscription_id: 'sub_A' }), error: null },
    { data: null, error: null },                                                                 // bump
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(currentClient.rpcCalls.length, 0);
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
  assert.equal(adminNotifyCalls.length, 0);
  assert.deepEqual(eventTypes(), ['ignored_duplicate_recurring_webhook']);
  assert.equal(billingEvents[0].payload.payment_status, 'paid');
});

// R3 — verse in-flight claim: RPC niet aangeroepen
test('R3: paid in-flight (jonge processing) → 500, RPC NIET aangeroepen, nul side-effects', async () => {
  resetSpies();
  const payment = recurringPayment();
  mollie = makeMollie({ payment });
  const young = receiptRow('recurring_payment_paid', { processing_started_at: new Date().toISOString() });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },    // conflict
    { data: young, error: null }, // fetch: processing, jong
    { data: [], error: null },    // herclaim verliest
    { data: young, error: null }, // re-read: nog steeds processing
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
  assert.equal(currentClient.rpcCalls.length, 0);
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
  assert.equal(billingEvents.length, 0);
});

// R4 — herclaim: RPC applied (eerste run kwam nooit tot de RPC)
test('R4: paid herclaim → RPC applied, recovered-vlag in audit, 200', async () => {
  resetSpies();
  const payment = recurringPayment();
  mollie = makeMollie({ payment });
  const failedReceipt = receiptRow('recurring_payment_paid', { status: 'failed' });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: failedReceipt, error: null },
    { data: [{ ...failedReceipt, status: 'processing' }], error: null }, // herclaim wint
    { data: paidLicenseRow(), error: null },
    RPC_APPLIED,
    { data: [receiptRow('recurring_payment_paid')], error: null },       // succeeded
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(currentClient.rpcCalls.length, 1);
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
  const ev = billingEvents.find((e) => e.event_type === 'recurring_payment_paid');
  assert.equal(ev.payload.recovered, true);
});

// R4b — CRASH-RETRY: RPC bewijst payment-specifiek dat de update al is toegepast
test('R4b: paid herclaim → RPC already_advanced → geen license-update, alleen terminalisering, één event, 200', async () => {
  resetSpies();
  const payment = recurringPayment();
  mollie = makeMollie({ payment });
  const failedReceipt = receiptRow('recurring_payment_paid', { status: 'failed' });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: failedReceipt, error: null },
    { data: [{ ...failedReceipt, status: 'processing' }], error: null },        // herclaim wint
    { data: paidLicenseRow(), error: null },
    { data: { outcome: 'already_advanced', result_subscription_id: 'sub_A' }, error: null }, // RPC
    { data: [receiptRow('recurring_payment_paid')], error: null },              // succeeded
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(currentClient.rpcCalls.length, 1);
  assert.equal(licenseUpdateCalls(currentClient).length, 0); // licentie-effect aantoonbaar éénmalig
  assert.equal(eventTypes().filter((t) => t === 'recurring_payment_paid').length, 1);
  const ev = billingEvents.find((e) => e.event_type === 'recurring_payment_paid');
  assert.equal(ev.payload.rpc_outcome, 'already_advanced');
});

// R4c — herclaim waar payment/license geen correlatie meer dragen: receipt-fallback
test('R4c: paid herclaim @license_updated zonder payment/license-correlatie → RPC krijgt correlatie uit de receipt', async () => {
  resetSpies();
  const payment = recurringPayment({ subscriptionId: null });
  mollie = makeMollie({ payment });
  const r = receiptRow('recurring_payment_paid', {
    status: 'failed',
    side_effect_stage: 'license_updated',
    result_subscription_id: 'sub_A',
  });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: r, error: null },
    { data: [{ ...r, status: 'processing' }], error: null },                    // herclaim wint
    { data: paidLicenseRow({ external_subscription_id: null }), error: null },  // license zonder sub
    { data: { outcome: 'already_advanced', result_subscription_id: 'sub_A' }, error: null },
    { data: [receiptRow('recurring_payment_paid')], error: null },              // succeeded
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(currentClient.rpcCalls[0].args.p_result_subscription_id, 'sub_A'); // uit de receipt
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
});

// R4d — terminalisering faalt ná applied
test('R4d: RPC applied maar markSucceeded faalt → 500, geen event, geen fallback-update; retry = R4b', async () => {
  resetSpies();
  const payment = recurringPayment();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow('recurring_payment_paid')], error: null },
    { data: paidLicenseRow(), error: null },
    RPC_APPLIED,
    { data: null, error: { message: 'boom' } }, // markSucceeded ✗ → throw → 500
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
  assert.equal(currentClient.rpcCalls.length, 1);
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
  assert.ok(!eventTypes().includes('recurring_payment_paid'));
});

// R4e — fenced: zombie-worker mag niets meer
test('R4e: RPC fenced → 500, geen terminalisering, geen markFailed, geen event', async () => {
  resetSpies();
  const payment = recurringPayment();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow('recurring_payment_paid')], error: null },
    { data: paidLicenseRow(), error: null },
    { data: { outcome: 'fenced', receipt_status: 'processing', receipt_stage: 'claimed' }, error: null },
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
  assert.equal(res.body.status, 'rpc_fenced');
  // Na de RPC (call-index 3) volgen géén receipts- of license-writes meer
  assert.equal(currentClient.calls.length, 4);
  assert.equal(billingEvents.length, 0);
});

// R5 — permanente/tijdelijke RPC-afwijzingen → failed + 500, nul losse writes
test('R5: RPC-outcomes receipt_not_found/license_not_found/license_school_mismatch/unexpected_stage/invalid_input → markReceiptFailed + 500, geen event', async () => {
  for (const outcome of ['receipt_not_found', 'license_not_found', 'license_school_mismatch', 'unexpected_stage', 'invalid_input']) {
    resetSpies();
    const payment = recurringPayment();
    mollie = makeMollie({ payment });
    currentClient = makeClient([
      OK_SCHOOL,
      { data: [receiptRow('recurring_payment_paid')], error: null },
      { data: paidLicenseRow(), error: null },
      { data: { outcome }, error: null },                            // RPC wijst af
      { data: [receiptRow('recurring_payment_paid')], error: null }, // markFailed
    ]);
    const res = await POST(reqFor(payment));
    assert.equal(res.status, 500, `outcome=${outcome}`);
    assert.equal(res.body.outcome, outcome);
    const failOp = currentClient.calls[4].ops.find(([m]) => m === 'update')[1];
    assert.equal(failOp.status, 'failed', `outcome=${outcome}`);
    assert.match(failOp.last_error, new RegExp(outcome), `outcome=${outcome}`);
    assert.equal(licenseUpdateCalls(currentClient).filter((c) => c.table === 'instructor_licenses').length, 0);
    assert.ok(!eventTypes().includes('recurring_payment_paid'), `outcome=${outcome}`);
  }
});

// R5d — V3: onbekende, lege of malformed RPC-outcome → altijd fail-closed
test('R5d: onbekende/lege/ontbrekende/malformed RPC-outcome → markReceiptFailed + 500, geen succeeded, geen event, geen fallback', async () => {
  const malformedResponses = [
    { label: 'onbekende outcome', data: { outcome: 'future_outcome' }, expectInError: 'future_outcome' },
    { label: 'lege outcome', data: { outcome: '' }, expectInError: 'rpc outcome:' },
    { label: 'ontbrekende outcome', data: {}, expectInError: 'undefined' },
    { label: 'data null zonder error', data: null, expectInError: 'undefined' },
    { label: 'primitive i.p.v. object', data: 'applied', expectInError: 'undefined' },
  ];
  for (const { label, data, expectInError } of malformedResponses) {
    resetSpies();
    const payment = recurringPayment();
    mollie = makeMollie({ payment });
    currentClient = makeClient([
      OK_SCHOOL,
      { data: [receiptRow('recurring_payment_paid')], error: null },
      { data: paidLicenseRow(), error: null },
      { data, error: null },                                         // RPC: malformed respons
      { data: [receiptRow('recurring_payment_paid')], error: null }, // markFailed
    ]);
    const res = await POST(reqFor(payment));

    // Nooit succes: 500 + rpc_rejected, herkenbare fouttekst
    assert.equal(res.status, 500, label);
    assert.equal(res.body.status, 'rpc_rejected', label);
    const failOp = currentClient.calls[4].ops.find(([m]) => m === 'update')[1];
    assert.equal(failOp.status, 'failed', label);
    assert.match(failOp.last_error, new RegExp(expectInError), label);

    // Geen terminale succeeded-receipt, geen tweede RPC of fallback:
    // het transcript eindigt exact bij de markFailed-write.
    assert.equal(currentClient.calls.length, 5, label);
    assert.equal(currentClient.rpcCalls.length, 1, label);
    assert.equal(licenseUpdateCalls(currentClient).length, 0, label);
    assert.ok(!eventTypes().includes('recurring_payment_paid'), label);
  }
});

// R5a — Supabase RPC-error (transport/database)
test('R5a: RPC-error → markReceiptFailed + 500, geen fallback naar losse writes', async () => {
  resetSpies();
  const payment = recurringPayment();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow('recurring_payment_paid')], error: null },
    { data: paidLicenseRow(), error: null },
    { data: null, error: { message: 'connection reset' } },        // RPC-error
    { data: [receiptRow('recurring_payment_paid')], error: null }, // markFailed
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
  assert.equal(res.body.status, 'rpc_failed');
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
  assert.ok(!eventTypes().includes('recurring_payment_paid'));
});

// R5b — B2-gedrag behouden: incasso ná opzegging → discard vóór de RPC
test('R5b: paid na opzegging → receipt discarded, RPC NIET aangeroepen, bestaand audit-event + admin-notify, 200', async () => {
  resetSpies();
  const payment = recurringPayment();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow('recurring_payment_paid')], error: null },
    { data: paidLicenseRow({ cancelled_at: '2026-07-14T10:00:00+00:00' }), error: null },
    { data: [receiptRow('recurring_payment_paid')], error: null }, // markDiscarded
    MAIL_SCHOOL,                                                   // admin-notify lookup
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(currentClient.rpcCalls.length, 0);
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
  assert.ok(eventTypes().includes('recurring_payment_after_cancel_ignored'));
  assert.equal(adminNotifyCalls.length, 1);
  assert.equal(adminNotifyCalls[0].s.extra.reason, 'unexpected_recurring_after_cancel');
});

// R5c — ontbrekende license: response-semantiek van main (200) behouden
test('R5c: paid zonder actieve license → 200 zoals main, receipt discarded, RPC NIET aangeroepen', async () => {
  resetSpies();
  const payment = recurringPayment();
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow('recurring_payment_paid')], error: null },
    { data: null, error: null },                                   // license: niet gevonden
    { data: [receiptRow('recurring_payment_paid')], error: null }, // markDiscarded
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(currentClient.rpcCalls.length, 0);
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
  const discOps = currentClient.calls[3].ops;
  assert.equal(discOps.find(([m]) => m === 'update')[1].status, 'discarded');
  const ev = billingEvents.find((e) => e.event_type === 'recurring_webhook_discarded');
  assert.equal(ev.payload.reason, 'active_license_not_found');
  assert.equal(ev.payload.payment_status, 'paid');
  assert.ok(!eventTypes().includes('recurring_payment_paid'));
});

// ════════════════════════════════════════ FAILED RECURRING ══════════════════
// Het failed-pad gebruikt de RPC NIET (buiten scope van Fase 1C); elke test
// hieronder assert dat er nul RPC-calls plaatsvinden.

// R6 — eerste failed-delivery
test('R6: failed eerste delivery → teller exact +1 met first_received_at-marker, stage-advance, succeeded, één mail, nul RPC-calls', async () => {
  resetSpies();
  const payment = recurringPayment({ status: 'failed' });
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow('recurring_payment_failed')], error: null }, // claim
    { data: failedLicenseRow(), error: null },                       // license (count 0)
    { data: [failedLicenseRow()], error: null },                     // increment: exact 1 rij
    { data: [receiptRow('recurring_payment_failed')], error: null }, // advance claimed→license_updated
    { data: [receiptRow('recurring_payment_failed')], error: null }, // markSucceeded
    MAIL_SCHOOL,
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(currentClient.rpcCalls.length, 0);

  const updates = licenseUpdateCalls(currentClient);
  assert.equal(updates.length, 1);
  const incRow = updates[0].ops.find(([m]) => m === 'update')[1];
  assert.equal(incRow.failed_payment_count, 1);
  // Marker = verwerkingsmoment van de EERSTE delivery (receipt-gebonden),
  // niet een Mollie-timestamp: kolom behoudt zijn bestaande betekenis.
  assert.equal(incRow.last_failed_payment_at, EXPECTED_FAILED_MARKER);

  const advRow = currentClient.calls[4].ops.find(([m]) => m === 'update')[1];
  assert.equal(advRow.side_effect_stage, 'license_updated');
  assert.equal(advRow.result_subscription_id, 'sub_A');

  assert.equal(failedMailCalls.length, 1);
  assert.equal(failedMailCalls[0][3], 1); // attempt 1
  assert.equal(suspendedMailCalls.length, 0);
  assert.equal(mollie.calls.cancel.length, 0);
  assert.equal(adminNotifyCalls.filter((c) => c.t === 'recurring_payment_failed').length, 1);
  assert.deepEqual(eventTypes(), ['recurring_payment_failed']);
});

// R7 — dezelfde failed-webhook tweemaal
test('R7: failed duplicate op terminal receipt → 200, teller onaangetast, geen mail/cancel/suspensie', async () => {
  resetSpies();
  const payment = recurringPayment({ status: 'failed' });
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: receiptRow('recurring_payment_failed', { status: 'succeeded', side_effect_stage: 'completed', result_subscription_id: 'sub_A' }), error: null },
    { data: null, error: null }, // bump
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(currentClient.rpcCalls.length, 0);
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
  assert.equal(failedMailCalls.length, 0);
  assert.equal(suspendedMailCalls.length, 0);
  assert.equal(mollie.calls.cancel.length, 0);
  assert.deepEqual(eventTypes(), ['ignored_duplicate_recurring_webhook']);
  assert.equal(billingEvents[0].payload.payment_status, 'failed');
});

// R8 — drempel bereikt
test('R8: derde failure → escalatie exact één keer (cancel, suspensie, mails), succeeded vóór mails, nul RPC-calls', async () => {
  resetSpies();
  const payment = recurringPayment({ status: 'failed' });
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow('recurring_payment_failed')], error: null },
    { data: failedLicenseRow({ failed_payment_count: 2 }), error: null },
    { data: [failedLicenseRow()], error: null },                     // increment → 3
    { data: [receiptRow('recurring_payment_failed')], error: null }, // advance
    { data: [failedLicenseRow()], error: null },                     // suspend update: exact 1 rij
    { data: [receiptRow('recurring_payment_failed')], error: null }, // markSucceeded
    MAIL_SCHOOL,
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(currentClient.rpcCalls.length, 0);

  const updates = licenseUpdateCalls(currentClient);
  assert.equal(updates.length, 2); // increment + suspensie
  assert.equal(updates[0].ops.find(([m]) => m === 'update')[1].failed_payment_count, 3);
  const suspRow = updates[1].ops.find(([m]) => m === 'update')[1];
  assert.equal(suspRow.billing_plan, 'trial');
  assert.equal(suspRow.is_trial, true);
  assert.equal(suspRow.external_subscription_id, null);
  assert.ok(suspRow.cancelled_at);

  assert.equal(mollie.calls.cancel.length, 1);
  assert.deepEqual(mollie.calls.cancel[0], ['sub_A', { customerId: 'cst_A' }]);
  assert.equal(suspendedMailCalls.length, 1);
  assert.equal(failedMailCalls.length, 0);
  assert.equal(adminNotifyCalls.filter((c) => c.t === 'subscription_suspended').length, 1);
  assert.deepEqual(eventTypes(), ['recurring_payment_failed', 'subscription_suspended']);
});

// R9 — verse in-flight failed-claim
test('R9: failed in-flight → 500, teller ongewijzigd, geen mails', async () => {
  resetSpies();
  const payment = recurringPayment({ status: 'failed' });
  mollie = makeMollie({ payment });
  const young = receiptRow('recurring_payment_failed', { processing_started_at: new Date().toISOString() });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: young, error: null },
    { data: [], error: null },
    { data: young, error: null },
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 500);
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
  assert.equal(failedMailCalls.length, 0);
});

// R10a — herclaim @claimed, increment al gebeurd (marker matcht)
test('R10a: failed herclaim @claimed met marker-match → GEEN tweede increment, teller blijft 1, mail attempt 1', async () => {
  resetSpies();
  const payment = recurringPayment({ status: 'failed' });
  mollie = makeMollie({ payment });
  const failedReceipt = receiptRow('recurring_payment_failed', { status: 'failed', side_effect_stage: 'claimed' });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: failedReceipt, error: null },
    { data: [{ ...failedReceipt, status: 'processing' }], error: null }, // herclaim wint
    // Gecrashte run heeft al geteld: count 1, marker = receipt.first_received_at
    { data: failedLicenseRow({ failed_payment_count: 1, last_failed_payment_at: EXPECTED_FAILED_MARKER }), error: null },
    { data: [receiptRow('recurring_payment_failed')], error: null },     // advance
    { data: [receiptRow('recurring_payment_failed')], error: null },     // markSucceeded
    MAIL_SCHOOL,
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(licenseUpdateCalls(currentClient).length, 0); // géén tweede increment
  assert.equal(failedMailCalls.length, 1);
  assert.equal(failedMailCalls[0][3], 1); // effectiveCount = opgeslagen stand
  const ev = billingEvents.find((e) => e.event_type === 'recurring_payment_failed');
  assert.equal(ev.payload.attempt, 1);
  assert.equal(ev.payload.recovered, true);
});

// R10b — bijna-gelijke timestamps van een ÁNDER payment zijn geen marker-match
test('R10b: failed herclaim @claimed, marker wijkt 1ms af (ander payment) → increment alsnog exact één keer', async () => {
  resetSpies();
  const payment = recurringPayment({ status: 'failed' });
  mollie = makeMollie({ payment });
  const failedReceipt = receiptRow('recurring_payment_failed', { status: 'failed', side_effect_stage: 'claimed' });
  const nearMissMarker = new Date(new Date(TOKEN).getTime() - 1).toISOString();
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: failedReceipt, error: null },
    { data: [{ ...failedReceipt, status: 'processing' }], error: null },
    // last_failed_payment_at komt van een ÁNDER failed payment (1ms verschil)
    { data: failedLicenseRow({ failed_payment_count: 1, last_failed_payment_at: nearMissMarker }), error: null },
    { data: [failedLicenseRow()], error: null },                     // increment → 2
    { data: [receiptRow('recurring_payment_failed')], error: null }, // advance
    { data: [receiptRow('recurring_payment_failed')], error: null }, // markSucceeded
    MAIL_SCHOOL,
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  const updates = licenseUpdateCalls(currentClient);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].ops.find(([m]) => m === 'update')[1].failed_payment_count, 2);
});

// R10c — herclaim @license_updated
test('R10c: failed herclaim @license_updated → geen increment, escalatiebeslissing op opgeslagen stand', async () => {
  resetSpies();
  const payment = recurringPayment({ status: 'failed' });
  mollie = makeMollie({ payment });
  const r = receiptRow('recurring_payment_failed', {
    status: 'failed',
    side_effect_stage: 'license_updated',
    result_subscription_id: 'sub_A',
  });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [], error: null },
    { data: r, error: null },
    { data: [{ ...r, status: 'processing' }], error: null },         // herclaim wint
    { data: failedLicenseRow({ failed_payment_count: 1, last_failed_payment_at: EXPECTED_FAILED_MARKER }), error: null },
    { data: [receiptRow('recurring_payment_failed')], error: null }, // markSucceeded (from license_updated)
    MAIL_SCHOOL,
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
  assert.equal(failedMailCalls.length, 1);
  const termConds = Object.fromEntries(currentClient.calls[5].ops.filter(([m]) => m === 'eq').map(([, c, v]) => [c, v]));
  assert.equal(termConds.side_effect_stage, 'license_updated');
});

// R10d — ontbrekende license: response-semantiek van main (200) behouden
test('R10d: failed zonder actieve license → 200 zoals main, receipt discarded, teller onaangetast', async () => {
  resetSpies();
  const payment = recurringPayment({ status: 'failed' });
  mollie = makeMollie({ payment });
  currentClient = makeClient([
    OK_SCHOOL,
    { data: [receiptRow('recurring_payment_failed')], error: null },
    { data: null, error: null },                                     // license: niet gevonden
    { data: [receiptRow('recurring_payment_failed')], error: null }, // markDiscarded
  ]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(licenseUpdateCalls(currentClient).length, 0);
  assert.equal(failedMailCalls.length, 0);
  const ev = billingEvents.find((e) => e.event_type === 'recurring_webhook_discarded');
  assert.equal(ev.payload.reason, 'active_license_not_found');
  assert.equal(ev.payload.payment_status, 'failed');
});

// ═══════════════════════════════════════ NIET-RECURRING PADEN ═══════════════

// R11a — niet-terminale payment-status
test('R11a: recurring payment met status open → geen claim, geen receipts-call, geen RPC, 200', async () => {
  resetSpies();
  const payment = recurringPayment({ status: 'open' });
  mollie = makeMollie({ payment });
  currentClient = makeClient([OK_SCHOOL]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(currentClient.calls.length, 1); // alleen de school-existence check
  assert.equal(currentClient.rpcCalls.length, 0);
  assert.equal(billingEvents.length, 0);
});

// R11b — ontbrekende metadata
test('R11b: payment zonder school_id/plan-metadata → 200, nul database-calls', async () => {
  resetSpies();
  const payment = { id: 'tr_META', status: 'paid', metadata: JSON.stringify({}) };
  mollie = makeMollie({ payment });
  currentClient = makeClient([]);
  const res = await POST(reqFor(payment));
  assert.equal(res.status, 200);
  assert.equal(currentClient.calls.length, 0);
});
