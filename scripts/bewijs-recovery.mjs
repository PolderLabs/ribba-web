// Revenue Recovery meten met een Test Clock — testmodus, wegwerpobjecten.
//
// Doel: vaststellen wat er ECHT gebeurt na een mislukte SEPA-incasso na de
// trial. Hoeveel pogingen, op welke dagen, welk event draagt de overgang naar
// de eindstatus, en na hoeveel tijd.
//
// Waarom dit niet uit de documentatie kan: SEPA heeft eigen grenzen (2
// pogingen / 30 dagen / alleen insufficient_funds) die los staan van het
// Smart-Retries-schema, en of de testmodus dezelfde instellingen draagt als
// live is onbekend. Dat blijkt alleen uit gedrag.
//
// Niet in CI. Handmatig, met een testsleutel, en ruimt zichzelf op.

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_TEST, { apiVersion: '2026-06-24.dahlia' });
const PREFIX = '[RECOVERY-BEWIJS]';
/** Faalt met insufficient_funds — de enige fout die SEPA opnieuw probeert. */
const IBAN_ONVOLDOENDE_SALDO = 'NL27RABO0002222227';

const tijd = (u) => new Date(u * 1000).toISOString().slice(0, 16).replace('T', ' ');
const dagen = (van, tot) => Math.round((tot - van) / 86400);

async function klokNaar(clockId, unix, label) {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: unix });
  for (let i = 0; i < 60; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (c.status === 'ready') return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`klok bleef hangen bij ${label}`);
}

async function stand(subId, t0) {
  const s = await stripe.subscriptions.retrieve(subId);
  const facturen = await stripe.invoices.list({ subscription: subId, limit: 5 });
  const open = facturen.data.find((f) => f.status !== 'paid' && f.status !== 'void');
  return {
    status: s.status,
    factuur: open
      ? {
          id: open.id,
          status: open.status,
          bedrag: (open.total / 100).toFixed(2),
          pogingen: open.attempt_count,
          volgende: open.next_payment_attempt ? tijd(open.next_payment_attempt) : '—',
        }
      : null,
    facturen: facturen.data.length,
  };
}

// ── Opzet ───────────────────────────────────────────────────────────────────
const nu = Math.floor(Date.now() / 1000);
const clock = await stripe.testHelpers.testClocks.create({ frozen_time: nu, name: `${PREFIX} klok` });

const product = await stripe.products.create({ name: `${PREFIX} Ribba Basic` });
const price = await stripe.prices.create({
  product: product.id, unit_amount: 2500, currency: 'eur',
  recurring: { interval: 'month' }, tax_behavior: 'exclusive',
  metadata: { plan: 'basic', trial_interval: '1 month' },
});

const klant = await stripe.customers.create({
  name: `${PREFIX} Rijschool`, email: 'recovery-bewijs@ribba.test',
  address: { country: 'NL' }, test_clock: clock.id,
});
const pm = await stripe.paymentMethods.create({
  type: 'sepa_debit',
  sepa_debit: { iban: IBAN_ONVOLDOENDE_SALDO },
  billing_details: { name: 'Rijschool Recovery', email: 'recovery-bewijs@ribba.test' },
});
await stripe.paymentMethods.attach(pm.id, { customer: klant.id });

// Trial van één kalendermaand, zoals de echte resolver hem zet.
const trialEind = Math.floor(new Date(new Date(nu * 1000).setUTCMonth(new Date(nu * 1000).getUTCMonth() + 1)).getTime() / 1000);

const sub = await stripe.subscriptions.create({
  customer: klant.id,
  items: [{ price: price.id }],
  trial_end: trialEind,
  default_payment_method: pm.id,
  automatic_tax: { enabled: true },
});

console.log(`opzet: sub=${sub.id} status=${sub.status}`);
console.log(`  trial loopt tot ${tijd(trialEind)}  (t0 = ${tijd(nu)})`);
console.log(`  IBAN ${IBAN_ONVOLDOENDE_SALDO} → insufficient_funds\n`);

// ── Tijdlijn ────────────────────────────────────────────────────────────────
// Ruim voorbij de SEPA-grens van 30 dagen, zodat de eindstatus zeker valt.
const stappen = [1, 3, 6, 10, 15, 21, 28, 35, 45, 55];
const gezien = [];

console.log('dag  status      factuur                     pogingen  volgende poging');
console.log('───  ──────────  ──────────────────────────  ────────  ───────────────');

for (const d of stappen) {
  const t = trialEind + d * 86400;
  await klokNaar(clock.id, t, `dag ${d}`);
  const s = await stand(sub.id, nu);
  gezien.push({ dag: d, ...s });
  const f = s.factuur;
  console.log(
    `${String(d).padStart(3)}  ${s.status.padEnd(10)}  ` +
    `${(f ? `${f.status} €${f.bedrag}` : 'geen open factuur').padEnd(26)}  ` +
    `${String(f?.pogingen ?? '—').padStart(8)}  ${f?.volgende ?? '—'}`,
  );
  if (s.status === 'unpaid' || s.status === 'canceled') {
    console.log(`\n→ eindstatus '${s.status}' bereikt op dag ${d} na trialeinde`);
    break;
  }
}

// ── Welke events droegen dat? ───────────────────────────────────────────────
console.log('\n=== events op deze subscription ===');
const events = await stripe.events.list({ limit: 100, created: { gte: nu - 60 } });
const relevant = events.data
  .filter((e) => JSON.stringify(e.data?.object ?? {}).includes(sub.id))
  .reverse();
for (const e of relevant) {
  const o = e.data.object;
  const extra = e.type.startsWith('customer.subscription')
    ? `status=${o.status}`
    : e.type.startsWith('invoice')
      ? `factuur ${o.status} poging=${o.attempt_count}`
      : '';
  console.log(`  ${tijd(e.created)}  ${e.type.padEnd(38)} ${extra}`);
}

console.log('\n=== opruimen ===');
await stripe.testHelpers.testClocks.del(clock.id);
await stripe.prices.update(price.id, { active: false });
await stripe.products.update(product.id, { active: false });
console.log('  testklok verwijderd (incl. klant en subscription), prijs+product gearchiveerd');
