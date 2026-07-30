// referral-billing-mandate — pint de mandaat-adoptie-resolutie vast:
//
//   1. de customer van de ACTIEVE subscription gaat vóór een nieuwere
//      geannuleerde (school_id is niet uniek in school_subscriptions);
//   2. test-mode/verwijderde customers (resource_missing op live) worden
//      overgeslagen en de volgende kandidaat wordt geprobeerd;
//   3. een customer zónder sepa_debit payment method wordt overgeslagen;
//   4. geen bruikbare kandidaat → null (pagina valt terug op de
//      nieuwe-machtiging-flow);
//   5. andere Stripe-fouten propageren (geen stille null);
//   6. dubbele customer-ids worden maar één keer geprobeerd.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { findAdoptableBillingMandate } = await import('../lib/referral-billing-mandate.ts');

function makeSupabase(rows) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    order: () => chain,
    then: (resolve) => resolve({ data: rows, error: null }),
  };
  return { from: () => chain };
}

// customers: map van customer-id → { pms: [...] } | { missing: true } | { error: '...' }
function makeStripe(customers, probes = []) {
  return {
    paymentMethods: {
      list: async ({ customer }) => {
        probes.push(customer);
        const entry = customers[customer];
        if (!entry || entry.missing) {
          const err = new Error(`No such customer: '${customer}'`);
          err.code = 'resource_missing';
          throw err;
        }
        if (entry.error) throw new Error(entry.error);
        return { data: entry.pms };
      },
    },
  };
}

const sepaPm = (id, last4) => ({ id, sepa_debit: { last4 } });

test('actieve subscription wint van nieuwere geannuleerde', async () => {
  const rows = [
    { stripe_customer_id: 'cus_new_canceled', stripe_status: 'canceled', created_at: '2026-07-01' },
    { stripe_customer_id: 'cus_active', stripe_status: 'active', created_at: '2026-06-01' },
  ];
  const stripe = makeStripe({
    cus_new_canceled: { pms: [sepaPm('pm_c', '1111')] },
    cus_active: { pms: [sepaPm('pm_a', '9649')] },
  });
  const result = await findAdoptableBillingMandate(makeSupabase(rows), stripe, 'school-1');
  assert.deepEqual(result, { customerId: 'cus_active', paymentMethodId: 'pm_a', last4: '9649' });
});

test('live-ontbrekende (test-mode) customer wordt overgeslagen', async () => {
  const rows = [
    { stripe_customer_id: 'cus_testmode', stripe_status: 'active', created_at: '2026-07-01' },
    { stripe_customer_id: 'cus_live', stripe_status: 'canceled', created_at: '2026-06-01' },
  ];
  const probes = [];
  const stripe = makeStripe({
    cus_testmode: { missing: true },
    cus_live: { pms: [sepaPm('pm_l', '9649')] },
  }, probes);
  const result = await findAdoptableBillingMandate(makeSupabase(rows), stripe, 'school-1');
  assert.equal(result.customerId, 'cus_live');
  assert.deepEqual(probes, ['cus_testmode', 'cus_live']);
});

test('customer zonder sepa_debit PM wordt overgeslagen', async () => {
  const rows = [
    { stripe_customer_id: 'cus_card_only', stripe_status: 'active', created_at: '2026-07-01' },
    { stripe_customer_id: 'cus_sepa', stripe_status: 'canceled', created_at: '2026-06-01' },
  ];
  const stripe = makeStripe({
    cus_card_only: { pms: [] },
    cus_sepa: { pms: [sepaPm('pm_s', '4242')] },
  });
  const result = await findAdoptableBillingMandate(makeSupabase(rows), stripe, 'school-1');
  assert.equal(result.customerId, 'cus_sepa');
});

test('geen bruikbare kandidaat → null', async () => {
  const rows = [
    { stripe_customer_id: 'cus_card_only', stripe_status: 'active', created_at: '2026-07-01' },
    { stripe_customer_id: 'cus_testmode', stripe_status: 'canceled', created_at: '2026-06-01' },
  ];
  const stripe = makeStripe({
    cus_card_only: { pms: [] },
    cus_testmode: { missing: true },
  });
  assert.equal(await findAdoptableBillingMandate(makeSupabase(rows), stripe, 'school-1'), null);
  assert.equal(await findAdoptableBillingMandate(makeSupabase([]), stripe, 'school-1'), null);
  assert.equal(await findAdoptableBillingMandate(makeSupabase(null), stripe, 'school-1'), null);
});

test('andere Stripe-fouten propageren', async () => {
  const rows = [{ stripe_customer_id: 'cus_x', stripe_status: 'active', created_at: '2026-07-01' }];
  const stripe = makeStripe({ cus_x: { error: 'rate limited (gesimuleerd)' } });
  await assert.rejects(
    () => findAdoptableBillingMandate(makeSupabase(rows), stripe, 'school-1'),
    /rate limited/,
  );
});

test('dubbele customer-ids worden één keer geprobeerd', async () => {
  const rows = [
    { stripe_customer_id: 'cus_dup', stripe_status: 'canceled', created_at: '2026-07-02' },
    { stripe_customer_id: 'cus_dup', stripe_status: 'canceled', created_at: '2026-07-01' },
  ];
  const probes = [];
  const stripe = makeStripe({ cus_dup: { pms: [] } }, probes);
  assert.equal(await findAdoptableBillingMandate(makeSupabase(rows), stripe, 'school-1'), null);
  assert.deepEqual(probes, ['cus_dup']);
});
