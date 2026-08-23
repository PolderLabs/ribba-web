// Empirisch bewijs voor de offer-resolver — testmodus, wegwerpobjecten.
//
// Draait de ECHTE resolveSignupOffer() tegen de echte Stripe-test-API en de
// echte validate_promo_code, en maakt met de uitkomst een echte Checkout
// Session. Geen mocks: dit moet aantonen dat wat de resolver berekent ook is
// wat Stripe accepteert.
//
// Niet in CI. Handmatig, met een testsleutel, en ruimt zichzelf op.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { resolveSignupOffer } from '../lib/signup-offer.ts';

const KEY = process.env.STRIPE_TEST;
const stripe = new Stripe(KEY, { apiVersion: '2026-06-24.dahlia' });

const db = createClient(process.env.SB_URL, process.env.SB_KEY);
async function valideerPromo(code) {
  const { data, error } = await db.rpc('validate_promo_code', { p_code: code });
  if (error) { console.error('  rpc-fout:', error.message); return { geldig: false }; }
  if (data?.valid !== true) return { geldig: false };
  return { geldig: true, code: data.code, interval: data.stripe_trial_interval };
}

const PREFIX = '[TRIALEND-BEWIJS]';
const opgeruimd = [];

async function maakPrijs(naam, centen, plan) {
  const product = await stripe.products.create({ name: `${PREFIX} ${naam}` });
  const price = await stripe.prices.create({
    product: product.id, unit_amount: centen, currency: 'eur',
    recurring: { interval: 'month' }, tax_behavior: 'exclusive',
    metadata: { plan, trial_interval: '1 month' },
  });
  opgeruimd.push({ product: product.id, price: price.id });
  return price.id;
}

console.log('=== testprijzen die de live-configuratie spiegelen ===');
const basicId = await maakPrijs('Ribba Basic', 2500, 'basic');
const premiumId = await maakPrijs('Ribba Premium', 4500, 'premium');
const env = { STRIPE_PRICE_BASIC: basicId, STRIPE_PRICE_PREMIUM: premiumId };
console.log('  basic  ', basicId, '€25,00  plan=basic    trial_interval=1 month');
console.log('  premium', premiumId, '€45,00  plan=premium  trial_interval=1 month');

const deps = { stripe, valideerPromo };
const nu = new Date();
const fmt = (iso) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16);

console.log('\n=== 1. resolver zonder promocode ===');
for (const plan of ['basic', 'premium']) {
  const r = await resolveSignupOffer(deps, plan, { env, nu });
  if (!r.ok) { console.log(`  ${plan}: GEWEIGERD — ${r.reason}`); continue; }
  console.log(`  ${plan}: €${(r.bedragen.nettoCenten / 100).toFixed(2)} excl. / ` +
    `€${(r.bedragen.brutoCenten / 100).toFixed(2)} incl.  |  vandaag €${(r.vandaagVerschuldigdCenten / 100).toFixed(2)}`);
  console.log(`           "${r.trial.tekst}" → eerste incasso ${fmt(r.trial.eersteIncassoISO)}`);
}

console.log('\n=== 2. resolver MET STARTGRATIS (echte promotabel) ===');
for (const plan of ['basic', 'premium']) {
  const r = await resolveSignupOffer(deps, plan, { env, nu, promoCode: 'startgratis' });
  if (!r.ok) { console.log(`  ${plan}: GEWEIGERD — ${r.reason}`); continue; }
  console.log(`  ${plan}: "${r.trial.tekst}" via ${r.trial.viaPromocode} → ` +
    `eerste incasso ${fmt(r.trial.eersteIncassoISO)}  (geweigerd=${r.promoGeweigerd})`);
}

console.log('\n=== 3. resolver met een onzin-code ===');
{
  const r = await resolveSignupOffer(deps, 'basic', { env, nu, promoCode: 'BESTAATNIET' });
  console.log(`  ok=${r.ok}  promoGeweigerd=${r.promoGeweigerd}  "${r.trial?.tekst}"  via=${r.trial?.viaPromocode}`);
}

console.log('\n=== 4. echte Checkout Session met de berekende trial_end ===');
const aanbod = await resolveSignupOffer(deps, 'basic', { env, nu, promoCode: 'STARTGRATIS' });
const klant = await stripe.customers.create({
  name: `${PREFIX} Rijschool`, email: 'trialend-bewijs@ribba.test', address: { country: 'NL' },
});
opgeruimd.push({ customer: klant.id });

const sessie = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer: klant.id,
  line_items: [{ price: aanbod.priceId, quantity: 1 }],
  payment_method_types: ['ideal', 'sepa_debit'],
  automatic_tax: { enabled: true },
  customer_update: { address: 'auto' },
  subscription_data: {
    trial_end: aanbod.trial.trialEndUnix,
    metadata: { pending_registration_id: 'bewijs-1', promo_code: aanbod.trial.viaPromocode },
  },
  success_url: 'https://mijn.ribba.app/registreren/ontvangen',
  cancel_url: 'https://mijn.ribba.app/registreren',
});

console.log('  aangemaakt:', sessie.id);
console.log('  trial_end meegegeven:', fmt(new Date(aanbod.trial.trialEndUnix * 1000).toISOString()));
console.log('  URL:', sessie.url);

const fs = await import('node:fs');
fs.writeFileSync('.bewijs-state.json', JSON.stringify({ sessie: sessie.id, opgeruimd, verwachtTrialEnd: aanbod.trial.trialEndUnix }, null, 2));
console.log('\nstatus weggeschreven naar .bewijs-state.json');
