// Gerichte unit-tests voor lib/billing-webhook-receipts.ts (Fase B).
//
// Draait op Node's ingebouwde testrunner — geen extra dependencies:
//   npm test  →  node --experimental-test-module-mocks --test tests/
//
// @supabase/supabase-js wordt gemockt met een scripted fake: elke from()-call
// consumeert de eerstvolgende geprogrammeerde response; alle chain-methods
// (upsert/select/update/eq/or/single) registreren hun aanroepen zodat we ook
// de geschreven payloads kunnen asserten. De builder is thenable, net als de
// echte Supabase query builder.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

let currentClient;

mock.module('@supabase/supabase-js', {
  namedExports: {
    createClient: () => currentClient,
  },
});

const {
  claimSetupWebhook,
  claimWebhookEvent,
  advanceReceiptStage,
  advanceReceiptClaimedToLicenseUpdated,
  markReceiptSucceeded,
  markReceiptFailed,
  markReceiptDiscarded,
} = await import('../lib/billing-webhook-receipts.ts');

const CHAIN_METHODS = ['upsert', 'select', 'update', 'eq', 'or', 'single', 'limit', 'order', 'maybeSingle'];

function makeClient(responses) {
  let i = 0;
  const calls = [];
  return {
    calls,
    from(table) {
      const response = responses[i++] ?? {
        data: null,
        error: { message: `no scripted response for call #${i}` },
      };
      const record = { table, ops: [] };
      calls.push(record);
      const builder = {};
      for (const m of CHAIN_METHODS) {
        builder[m] = (...args) => {
          record.ops.push([m, ...args]);
          return builder;
        };
      }
      builder.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject);
      return builder;
    },
  };
}

function receiptRow(overrides = {}) {
  return {
    id: 'rcpt-1',
    provider: 'mollie',
    event_kind: 'setup_payment_paid',
    external_event_id: 'tr_test123',
    school_id: 'school-1',
    status: 'processing',
    side_effect_stage: 'claimed',
    result_subscription_id: null,
    attempt_count: 1,
    first_received_at: '2026-07-10T09:00:00Z',
    last_received_at: '2026-07-10T09:00:00Z',
    processing_started_at: new Date().toISOString(),
    payload_fingerprint: 'fp',
    last_error: null,
    ...overrides,
  };
}

const CLAIM_PARAMS = { paymentId: 'tr_test123', schoolId: 'school-1', fingerprint: 'fp' };

test('verse claim gewonnen → outcome claimed, recovered=false', async () => {
  currentClient = makeClient([
    { data: [receiptRow()], error: null }, // upsert wint
  ]);
  const result = await claimSetupWebhook(CLAIM_PARAMS);
  assert.equal(result.outcome, 'claimed');
  assert.equal(result.recovered, false);
  assert.equal(result.receipt.id, 'rcpt-1');
  // De insert-claim moet ignoreDuplicates op de unique key gebruiken
  const upsertOp = currentClient.calls[0].ops.find(([m]) => m === 'upsert');
  assert.equal(upsertOp[2].ignoreDuplicates, true);
  assert.equal(upsertOp[2].onConflict, 'provider,event_kind,external_event_id');
});

test('duplicate delivery op succeeded receipt → already_terminal + attempt-bump', async () => {
  currentClient = makeClient([
    { data: [], error: null },                                                        // upsert: conflict
    { data: receiptRow({ status: 'succeeded', side_effect_stage: 'completed', attempt_count: 3 }), error: null }, // fetch
    { data: null, error: null },                                                      // bump update
  ]);
  const result = await claimSetupWebhook(CLAIM_PARAMS);
  assert.equal(result.outcome, 'already_terminal');
  assert.equal(result.receipt.status, 'succeeded');
  const bumpOp = currentClient.calls[2].ops.find(([m]) => m === 'update');
  assert.equal(bumpOp[1].attempt_count, 4);
});

test('duplicate delivery op discarded receipt → already_terminal', async () => {
  currentClient = makeClient([
    { data: [], error: null },
    { data: receiptRow({ status: 'discarded' }), error: null },
    { data: null, error: null },
  ]);
  const result = await claimSetupWebhook(CLAIM_PARAMS);
  assert.equal(result.outcome, 'already_terminal');
  assert.equal(result.receipt.status, 'discarded');
});

test('failed receipt → herclaim gewonnen → reclaimed, stage blijft behouden', async () => {
  const failedRow = receiptRow({ status: 'failed', side_effect_stage: 'subscription_created', result_subscription_id: 'sub_x', attempt_count: 2 });
  currentClient = makeClient([
    { data: [], error: null },                                                        // upsert: conflict
    { data: failedRow, error: null },                                                 // fetch
    { data: [{ ...failedRow, status: 'processing', attempt_count: 3 }], error: null }, // herclaim wint
  ]);
  const result = await claimSetupWebhook(CLAIM_PARAMS);
  assert.equal(result.outcome, 'reclaimed');
  assert.equal(result.recovered, true);
  // Cruciaal voor crash-recovery: stage en sub-id overleven de herclaim,
  // zodat de caller NOOIT een tweede create doet voor deze payment.
  assert.equal(result.receipt.side_effect_stage, 'subscription_created');
  assert.equal(result.receipt.result_subscription_id, 'sub_x');
  // Herclaim mag status/stage-velden niet resetten in de update zelf
  const reclaimOp = currentClient.calls[2].ops.find(([m]) => m === 'update');
  assert.equal(reclaimOp[1].status, 'processing');
  assert.equal('side_effect_stage' in reclaimOp[1], false);
  assert.equal('result_subscription_id' in reclaimOp[1], false);
});

test('jonge processing receipt → herclaim verliest → in_flight', async () => {
  const young = receiptRow({ status: 'processing', processing_started_at: new Date().toISOString() });
  currentClient = makeClient([
    { data: [], error: null },   // upsert: conflict
    { data: young, error: null }, // fetch
    { data: [], error: null },   // herclaim verliest (conditie matcht niet)
    { data: young, error: null }, // re-read: nog steeds processing
  ]);
  const result = await claimSetupWebhook(CLAIM_PARAMS);
  assert.equal(result.outcome, 'in_flight');
});

test('herclaim verliest maar concurrent is inmiddels succeeded → already_terminal', async () => {
  const failedRow = receiptRow({ status: 'failed' });
  currentClient = makeClient([
    { data: [], error: null },
    { data: failedRow, error: null },
    { data: [], error: null },                                     // herclaim verloren van concurrent
    { data: receiptRow({ status: 'succeeded' }), error: null },    // re-read: concurrent is klaar
    { data: null, error: null },                                   // bump
  ]);
  const result = await claimSetupWebhook(CLAIM_PARAMS);
  assert.equal(result.outcome, 'already_terminal');
  assert.equal(result.receipt.status, 'succeeded');
});

test('claim-insert DB-fout → throwt (correctness: zonder claim geen side-effects)', async () => {
  currentClient = makeClient([
    { data: null, error: { message: 'connection refused' } },
  ]);
  await assert.rejects(() => claimSetupWebhook(CLAIM_PARAMS), /receipt claim insert failed/);
});

const TOKEN = '2026-07-10T09:00:00.000Z';

// Helper: verzamel alle eq-condities van de (enige) update-call als object.
function eqConditions(call) {
  return Object.fromEntries(call.ops.filter(([m]) => m === 'eq').map(([, col, val]) => [col, val]));
}

test('advanceReceiptStage: gefenced op token + status + vorige stage; schrijft stage + sub-id in één update', async () => {
  currentClient = makeClient([{ data: [receiptRow()], error: null }]);
  await advanceReceiptStage('rcpt-1', TOKEN, 'subscription_created', 'sub_new');
  const call = currentClient.calls[0];
  const op = call.ops.find(([m]) => m === 'update');
  assert.equal(op[1].side_effect_stage, 'subscription_created');
  assert.equal(op[1].result_subscription_id, 'sub_new');
  const conds = eqConditions(call);
  assert.equal(conds.id, 'rcpt-1');
  assert.equal(conds.status, 'processing');
  assert.equal(conds.processing_started_at, TOKEN);
  assert.equal(conds.side_effect_stage, 'claimed'); // vereiste vórige stage
});

test('advanceReceiptStage: license_updated vereist vorige stage subscription_created', async () => {
  currentClient = makeClient([{ data: [receiptRow()], error: null }]);
  await advanceReceiptStage('rcpt-1', TOKEN, 'license_updated');
  const conds = eqConditions(currentClient.calls[0]);
  assert.equal(conds.side_effect_stage, 'subscription_created');
});

test('advanceReceiptStage: throwt bij DB-fout én bij 0 geraakte rijen (ownership verloren)', async () => {
  currentClient = makeClient([{ data: null, error: { message: 'boom' } }]);
  await assert.rejects(
    () => advanceReceiptStage('rcpt-1', TOKEN, 'license_updated'),
    /stage advance/,
  );

  // Zombie-run: token matcht niet meer → 0 rijen → throw, geen stille voortgang
  currentClient = makeClient([{ data: [], error: null }]);
  await assert.rejects(
    () => advanceReceiptStage('rcpt-1', TOKEN, 'subscription_created', 'sub_x'),
    /ownership lost/,
  );
});

test('markReceiptSucceeded: atomisch status+stage, gefenced, alleen vanaf license_updated', async () => {
  currentClient = makeClient([{ data: [receiptRow()], error: null }]);
  await markReceiptSucceeded('rcpt-1', TOKEN);
  const call = currentClient.calls[0];
  const op = call.ops.find(([m]) => m === 'update');
  assert.equal(op[1].status, 'succeeded');
  assert.equal(op[1].side_effect_stage, 'completed');
  const conds = eqConditions(call);
  assert.equal(conds.status, 'processing');
  assert.equal(conds.processing_started_at, TOKEN);
  assert.equal(conds.side_effect_stage, 'license_updated');

  currentClient = makeClient([{ data: [], error: null }]);
  await assert.rejects(() => markReceiptSucceeded('rcpt-1', TOKEN), /ownership lost/);

  currentClient = makeClient([{ data: null, error: { message: 'boom' } }]);
  await assert.rejects(() => markReceiptSucceeded('rcpt-1', TOKEN), /mark succeeded/);
});

test('markReceiptDiscarded: alleen vanaf stage claimed, gefenced; laat stage staan', async () => {
  currentClient = makeClient([{ data: [receiptRow()], error: null }]);
  await markReceiptDiscarded('rcpt-1', TOKEN);
  const call = currentClient.calls[0];
  const op = call.ops.find(([m]) => m === 'update');
  assert.equal(op[1].status, 'discarded');
  assert.equal('side_effect_stage' in op[1], false);
  const conds = eqConditions(call);
  assert.equal(conds.status, 'processing');
  assert.equal(conds.processing_started_at, TOKEN);
  assert.equal(conds.side_effect_stage, 'claimed');

  currentClient = makeClient([{ data: [], error: null }]);
  await assert.rejects(() => markReceiptDiscarded('rcpt-1', TOKEN), /ownership lost/);

  currentClient = makeClient([{ data: null, error: { message: 'boom' } }]);
  await assert.rejects(() => markReceiptDiscarded('rcpt-1', TOKEN), /mark discarded/);
});

test('markReceiptFailed: non-throwing (catch-pad-contract), gefenced, slicet de fout', async () => {
  // DB-fout → mag NIET throwen; receipt wordt dan vanzelf stale en herclaimbaar
  currentClient = makeClient([{ data: null, error: { message: 'boom' } }]);
  await markReceiptFailed('rcpt-1', TOKEN, 'x'.repeat(1000));

  // Zombie-run (0 rijen geraakt) → ook geen throw, en de overnemende run blijft ongemoeid
  currentClient = makeClient([{ data: [], error: null }]);
  await markReceiptFailed('rcpt-1', TOKEN, 'boom');

  // Succes-pad: status failed + last_error geslicet op 500, gefenced op token
  currentClient = makeClient([{ data: [receiptRow()], error: null }]);
  await markReceiptFailed('rcpt-1', TOKEN, 'x'.repeat(1000));
  const call = currentClient.calls[0];
  const op = call.ops.find(([m]) => m === 'update');
  assert.equal(op[1].status, 'failed');
  assert.equal(op[1].last_error.length, 500);
  const conds = eqConditions(call);
  assert.equal(conds.status, 'processing');
  assert.equal(conds.processing_started_at, TOKEN);
});

test('herclaim-conditie: alleen failed of stale-processing, en bump raakt status/stage/result niet', async () => {
  // Herclaim-query bevat de or-conditie op failed / stale processing
  const failedRow = receiptRow({ status: 'failed', attempt_count: 1 });
  currentClient = makeClient([
    { data: [], error: null },
    { data: failedRow, error: null },
    { data: [{ ...failedRow, status: 'processing' }], error: null },
  ]);
  await claimSetupWebhook(CLAIM_PARAMS);
  const reclaimCall = currentClient.calls[2];
  const orOp = reclaimCall.ops.find(([m]) => m === 'or');
  assert.match(orOp[1], /status\.eq\.failed/);
  assert.match(orOp[1], /status\.eq\.processing/);
  assert.match(orOp[1], /processing_started_at\.lt\./);

  // Terminal-bump muteert uitsluitend last_received_at + attempt_count
  currentClient = makeClient([
    { data: [], error: null },
    { data: receiptRow({ status: 'succeeded', attempt_count: 7 }), error: null },
    { data: null, error: null },
  ]);
  await claimSetupWebhook(CLAIM_PARAMS);
  const bumpOp = currentClient.calls[2].ops.find(([m]) => m === 'update');
  assert.deepEqual(Object.keys(bumpOp[1]).sort(), ['attempt_count', 'last_received_at']);
});

// ── Fase 1: recurring event-kinds ───────────────────────────────────────────

test('claimWebhookEvent: recurring kinds schrijven de juiste event_kind met het Mollie Payment ID als sleutel', async () => {
  for (const eventKind of ['recurring_payment_paid', 'recurring_payment_failed']) {
    currentClient = makeClient([
      { data: [receiptRow({ event_kind: eventKind })], error: null },
    ]);
    const result = await claimWebhookEvent({ eventKind, ...CLAIM_PARAMS });
    assert.equal(result.outcome, 'claimed');
    const upsertRow = currentClient.calls[0].ops.find(([m]) => m === 'upsert')[1];
    assert.equal(upsertRow.event_kind, eventKind);
    assert.equal(upsertRow.external_event_id, 'tr_test123');
    assert.equal(upsertRow.side_effect_stage, 'claimed');
  }
});

test('claimWebhookEvent: fetch en herclaim filteren op de opgegeven event_kind (geen cross-kind hits)', async () => {
  const failedRow = receiptRow({ event_kind: 'recurring_payment_failed', status: 'failed' });
  currentClient = makeClient([
    { data: [], error: null },                                        // conflict
    { data: failedRow, error: null },                                 // fetch
    { data: [{ ...failedRow, status: 'processing' }], error: null },  // herclaim
  ]);
  const result = await claimWebhookEvent({ eventKind: 'recurring_payment_failed', ...CLAIM_PARAMS });
  assert.equal(result.outcome, 'reclaimed');
  for (const callIdx of [1, 2]) {
    const conds = eqConditions(currentClient.calls[callIdx]);
    assert.equal(conds.event_kind, 'recurring_payment_failed');
  }
});

test('claimSetupWebhook blijft een dunne wrapper op setup_payment_paid', async () => {
  currentClient = makeClient([{ data: [receiptRow()], error: null }]);
  await claimSetupWebhook(CLAIM_PARAMS);
  const upsertRow = currentClient.calls[0].ops.find(([m]) => m === 'upsert')[1];
  assert.equal(upsertRow.event_kind, 'setup_payment_paid');
});

test('advanceReceiptClaimedToLicenseUpdated: gefenced, alleen vanaf claimed, schrijft stage + verplichte correlatie in één update', async () => {
  currentClient = makeClient([{ data: [receiptRow()], error: null }]);
  await advanceReceiptClaimedToLicenseUpdated('rcpt-1', TOKEN, 'sub_A');
  const call = currentClient.calls[0];
  const op = call.ops.find(([m]) => m === 'update');
  assert.equal(op[1].side_effect_stage, 'license_updated');
  assert.equal(op[1].result_subscription_id, 'sub_A');
  const conds = eqConditions(call);
  assert.equal(conds.status, 'processing');
  assert.equal(conds.processing_started_at, TOKEN);
  assert.equal(conds.side_effect_stage, 'claimed');

  currentClient = makeClient([{ data: [], error: null }]);
  await assert.rejects(() => advanceReceiptClaimedToLicenseUpdated('rcpt-1', TOKEN, 'sub_A'), /ownership lost/);

  currentClient = makeClient([{ data: null, error: { message: 'boom' } }]);
  await assert.rejects(() => advanceReceiptClaimedToLicenseUpdated('rcpt-1', TOKEN, 'sub_A'), /claimed→license_updated/);
});
