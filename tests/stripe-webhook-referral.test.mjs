// stripe-webhook — pint de referral-payout-statusmachine vast:
//
//   1. payment_intent.succeeded → gefenced charging→charged → transfer (met
//      idempotency-key + source_transaction) → charged→paid + partnermail;
//   2. duplicate delivery (claim verloren) → 200 zonder verwerking;
//   3. recovery: payout al 'charged' (eerdere run crashte ná de flip) →
//      transfer wordt alsnog gedaan — de idempotency-key beschermt tegen
//      dubbel uitbetalen;
//   4. payout al 'paid' → no-op (geen tweede transfer);
//   5. payment_intent.payment_failed → gefenced charging→failed + schoolmail;
//   6. PaymentIntent zonder payout_id-metadata (niet van ons) → no-op;
//   7. verwerkingsfout → claim wordt vrijgegeven + 500 (Stripe-retry mag
//      het event opnieuw verwerken).

import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

// Regelbaar per test
let currentEvent;
let payoutRow;
let claimWon;
let transferError;

// Observaties
let transfers;
let claimReleases;
let paidMails;
let failedMails;

function defaults() {
  payoutRow = {
    id: 'payout-1',
    referral_id: 'ref-1',
    partner_id: 'partner-1',
    drivingschool_id: 'school-1',
    milestone: 'eerste_betaalde_les',
    reward_kind: 'cash',
    amount_cents: 2500,
    ribba_fee_cents: 250,
    currency: 'eur',
    status: 'charging',
    stripe_payment_intent_id: 'pi_1',
    stripe_transfer_id: null,
    attempt_count: 1,
  };
  claimWon = true;
  transferError = null;
  transfers = [];
  claimReleases = [];
  paidMails = [];
  failedMails = [];
}

function matches(row, filters) {
  return Object.entries(filters).every(([col, val]) => row[col] === val);
}

function makeFakeSupabase() {
  return {
    from(table) {
      if (table === 'stripe_webhook_events') {
        return {
          upsert: () => ({
            select: async () => ({ data: claimWon ? [{ event_id: currentEvent.id }] : [], error: null }),
          }),
          delete: () => ({
            eq: async (_col, val) => { claimReleases.push(val); return { error: null }; },
          }),
        };
      }
      if (table === 'referral_payouts') {
        return {
          update(payload) {
            const filters = {};
            const chain = {
              eq(col, val) { filters[col] = val; return chain; },
              select: async () => {
                if (matches(payoutRow, filters)) {
                  Object.assign(payoutRow, payload);
                  return { data: [{ ...payoutRow }], error: null };
                }
                return { data: [], error: null };
              },
              // update zonder .select() (niet gebruikt in de webhook)
              then: (resolve) => resolve({ data: null, error: null }),
            };
            return chain;
          },
          select() {
            const chain = {
              eq: () => chain,
              maybeSingle: async () => ({ data: { ...payoutRow }, error: null }),
              single: async () => ({ data: { ...payoutRow }, error: null }),
            };
            return chain;
          },
        };
      }
      if (table === 'referral_partners') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          single: async () => ({
            data: { id: 'partner-1', email: 'partner@voorbeeld.nl', stripe_account_id: 'acct_1' },
            error: null,
          }),
          maybeSingle: async () => ({ data: { id: 'partner-1' }, error: null }),
          update: () => chain,
        };
        return chain;
      }
      if (table === 'drivingschools') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          single: async () => ({
            data: { id: 'school-1', name: 'Rijschool Test', email: 'school@voorbeeld.nl' },
            error: null,
          }),
        };
        return chain;
      }
      throw new Error(`onverwachte tabel: ${table}`);
    },
  };
}

mock.module('@supabase/supabase-js', {
  namedExports: { createClient: () => makeFakeSupabase() },
});
mock.module('next/server', {
  namedExports: {
    NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    NextRequest: class NextRequest {},
  },
});
mock.module('@/lib/stripe', {
  namedExports: {
    getStripe: () => ({
      webhooks: { constructEvent: () => currentEvent },
      transfers: {
        create: async (params, opts) => {
          if (transferError) throw new Error(transferError);
          transfers.push({ params, opts });
          return { id: 'tr_1' };
        },
      },
    }),
  },
});
mock.module('@/lib/referral-stripe', {
  namedExports: { syncPartnerAccountState: async () => ({}) },
});
mock.module('@/lib/billing-events', {
  namedExports: { logBillingEvent: async () => {} },
});
mock.module('@/lib/referral-emails', {
  namedExports: {
    sendPartnerPayoutPaidMail: async (p) => { paidMails.push(p); },
    sendSchoolChargeFailedMail: async (p) => { failedMails.push(p); },
    sendTeamReferralAlertMail: async () => {},
  },
});

const { POST } = await import('../app/api/stripe-webhook/route.ts');

function makeRequest() {
  return {
    headers: { get: (name) => (name === 'stripe-signature' ? 'sig' : null) },
    text: async () => '{}',
  };
}

function piEvent(type, overrides = {}) {
  return {
    id: `evt_${type}`,
    type,
    data: {
      object: {
        id: 'pi_1',
        metadata: { payout_id: 'payout-1' },
        latest_charge: 'ch_1',
        last_payment_error: { message: 'insufficient funds (gesimuleerd)' },
        ...overrides,
      },
    },
  };
}

beforeEach(defaults);

test('succeeded: charging → charged → transfer → paid + partnermail', async () => {
  currentEvent = piEvent('payment_intent.succeeded');
  const res = await POST(makeRequest());

  assert.equal(res.status, 200);
  assert.equal(payoutRow.status, 'paid');
  assert.equal(payoutRow.stripe_transfer_id, 'tr_1');
  assert.equal(transfers.length, 1);
  // Alleen de commissie gaat door naar de partner; de fee blijft als marge achter.
  assert.equal(transfers[0].params.amount, 2500);
  assert.equal(transfers[0].params.destination, 'acct_1');
  assert.equal(transfers[0].params.source_transaction, 'ch_1');
  assert.equal(transfers[0].opts.idempotencyKey, 'referral-payout-transfer-payout-1');
  assert.equal(paidMails.length, 1);
});

test('duplicate delivery: claim verloren → 200 zonder verwerking', async () => {
  currentEvent = piEvent('payment_intent.succeeded');
  claimWon = false;
  const res = await POST(makeRequest());

  assert.equal(res.status, 200);
  assert.equal(payoutRow.status, 'charging'); // onaangeroerd
  assert.equal(transfers.length, 0);
});

test('recovery: payout al charged → transfer alsnog, daarna paid', async () => {
  currentEvent = piEvent('payment_intent.succeeded');
  payoutRow.status = 'charged';
  const res = await POST(makeRequest());

  assert.equal(res.status, 200);
  assert.equal(payoutRow.status, 'paid');
  assert.equal(transfers.length, 1);
});

test('payout al paid → no-op, geen tweede transfer', async () => {
  currentEvent = piEvent('payment_intent.succeeded');
  payoutRow.status = 'paid';
  const res = await POST(makeRequest());

  assert.equal(res.status, 200);
  assert.equal(transfers.length, 0);
  assert.equal(paidMails.length, 0);
});

test('payment_failed: charging → failed + schoolmail met reden', async () => {
  currentEvent = piEvent('payment_intent.payment_failed');
  const res = await POST(makeRequest());

  assert.equal(res.status, 200);
  assert.equal(payoutRow.status, 'failed');
  assert.match(payoutRow.failure_reason, /insufficient funds/);
  assert.equal(failedMails.length, 1);
  // School betaalt commissie + fee — de mislukte incasso meldt het totaal.
  assert.equal(failedMails[0].totalCents, 2750);
});

test('payment_failed op al-afgehandelde payout → geen tweede schoolmail', async () => {
  currentEvent = piEvent('payment_intent.payment_failed');
  payoutRow.status = 'failed';
  const res = await POST(makeRequest());

  assert.equal(res.status, 200);
  assert.equal(failedMails.length, 0);
});

test('PaymentIntent zonder payout_id-metadata → no-op', async () => {
  currentEvent = piEvent('payment_intent.succeeded', { metadata: {} });
  const res = await POST(makeRequest());

  assert.equal(res.status, 200);
  assert.equal(payoutRow.status, 'charging');
  assert.equal(transfers.length, 0);
});

test('verwerkingsfout → claim vrijgegeven + 500 (Stripe-retry)', async () => {
  currentEvent = piEvent('payment_intent.succeeded');
  transferError = 'stripe kapot (gesimuleerd)';
  const res = await POST(makeRequest());

  assert.equal(res.status, 500);
  assert.deepEqual(claimReleases, [currentEvent.id]);
  // Payout is charged gebleven: de retry pakt het recovery-pad en de
  // idempotency-key maakt de herhaalde transfer veilig.
  assert.equal(payoutRow.status, 'charged');
});
