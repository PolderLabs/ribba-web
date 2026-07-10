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
  advanceReceiptStage,
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

test('advanceReceiptStage schrijft stage + result_subscription_id en throwt bij DB-fout', async () => {
  currentClient = makeClient([{ data: null, error: null }]);
  await advanceReceiptStage('rcpt-1', 'subscription_created', 'sub_new');
  const op = currentClient.calls[0].ops.find(([m]) => m === 'update');
  assert.equal(op[1].side_effect_stage, 'subscription_created');
  assert.equal(op[1].result_subscription_id, 'sub_new');

  currentClient = makeClient([{ data: null, error: { message: 'boom' } }]);
  await assert.rejects(() => advanceReceiptStage('rcpt-1', 'license_updated'), /stage advance/);
});

test('markReceiptSucceeded zet status succeeded + stage completed; throwt bij fout', async () => {
  currentClient = makeClient([{ data: null, error: null }]);
  await markReceiptSucceeded('rcpt-1');
  const op = currentClient.calls[0].ops.find(([m]) => m === 'update');
  assert.equal(op[1].status, 'succeeded');
  assert.equal(op[1].side_effect_stage, 'completed');

  currentClient = makeClient([{ data: null, error: { message: 'boom' } }]);
  await assert.rejects(() => markReceiptSucceeded('rcpt-1'), /mark succeeded/);
});

test('markReceiptDiscarded zet status discarded, laat stage staan; throwt bij fout', async () => {
  currentClient = makeClient([{ data: null, error: null }]);
  await markReceiptDiscarded('rcpt-1');
  const op = currentClient.calls[0].ops.find(([m]) => m === 'update');
  assert.equal(op[1].status, 'discarded');
  assert.equal('side_effect_stage' in op[1], false);

  currentClient = makeClient([{ data: null, error: { message: 'boom' } }]);
  await assert.rejects(() => markReceiptDiscarded('rcpt-1'), /mark discarded/);
});

test('markReceiptFailed is non-throwing (catch-pad-veilig) en slicet de fout', async () => {
  // DB-fout → mag NIET throwen; receipt wordt dan vanzelf stale en herclaimbaar
  currentClient = makeClient([{ data: null, error: { message: 'boom' } }]);
  await markReceiptFailed('rcpt-1', 'x'.repeat(1000));

  // Succes-pad: status failed + last_error geslicet op 500
  currentClient = makeClient([{ data: null, error: null }]);
  await markReceiptFailed('rcpt-1', 'x'.repeat(1000));
  const op = currentClient.calls[0].ops.find(([m]) => m === 'update');
  assert.equal(op[1].status, 'failed');
  assert.equal(op[1].last_error.length, 500);
});
