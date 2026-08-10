// Fase 3B.3 — G5: het aanbod ophalen vóór Checkout.
//
// Wat hier bewaakt wordt is de grens uit fase 3A, aan de andere kant van de
// keten: een Price-ID bepaalt WELK aanbod Checkout krijgt, maar nooit welke
// rechten iemand krijgt. Dat komt uitsluitend uit `plan`-metadata.
//
// En de aanscherping: het is niet genoeg dát er een geldig plan staat — het
// moet overeenkomen met wat de rijschool koos. Een verwisselde secret zou
// anders iemand die Basic kiest naar de Premium-Price sturen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSignupOffer, priceIdForPlan, trialDaysFromPrice } from '../lib/signup-offer.ts';

const ENV = { STRIPE_PRICE_BASIC: 'price_basic', STRIPE_PRICE_PREMIUM: 'price_premium' };

function stripeMet(prices) {
  return { prices: { retrieve: async (id) => {
    if (!prices[id]) throw new Error('No such price');
    return prices[id];
  } } };
}
const geldigeBasic   = { id: 'price_basic',   active: true, recurring: { interval: 'month' }, metadata: { plan: 'basic' } };
const geldigePremium = { id: 'price_premium', active: true, recurring: { interval: 'month' }, metadata: { plan: 'premium' } };

test('routing: het secret bepaalt welke Price wordt opgehaald', () => {
  assert.equal(priceIdForPlan('basic', ENV), 'price_basic');
  assert.equal(priceIdForPlan('premium', ENV), 'price_premium');
  assert.equal(priceIdForPlan('basic', {}), null);
});

test('geldig aanbod: plan komt uit de metadata, niet uit het verzoek', async () => {
  const r = await resolveSignupOffer(stripeMet({ price_basic: geldigeBasic }), 'basic', ENV);
  assert.equal(r.ok, true);
  assert.equal(r.plan, 'basic');
  assert.equal(r.priceId, 'price_basic');
});

test('G5: een Price zonder plan-metadata komt niet in een Checkout', async () => {
  const zonder = { ...geldigeBasic, metadata: {} };
  const r = await resolveSignupOffer(stripeMet({ price_basic: zonder }), 'basic', ENV);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'plan_metadata_missing');
});

test('G5: een onbekende planwaarde is een fout, geen gok', async () => {
  const fout = { ...geldigeBasic, metadata: { plan: 'gold' } };
  const r = await resolveSignupOffer(stripeMet({ price_basic: fout }), 'basic', ENV);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'plan_metadata_invalid');
});

test('G5: metadata die niet overeenkomt met de keuze wordt geweigerd', async () => {
  // Verwisselde secret: STRIPE_PRICE_BASIC wijst naar de Premium-Price.
  const verwisseld = { ...geldigePremium, id: 'price_basic' };
  const r = await resolveSignupOffer(stripeMet({ price_basic: verwisseld }), 'basic', ENV);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'plan_metadata_mismatch');
  assert.match(r.detail, /gekozen=basic/);
});

test('een ontbrekend of onvindbaar secret levert geen Checkout op', async () => {
  const a = await resolveSignupOffer(stripeMet({}), 'basic', {});
  assert.equal(a.reason, 'price_not_configured');
  const b = await resolveSignupOffer(stripeMet({}), 'basic', ENV);
  assert.equal(b.reason, 'price_not_found');
});

test('een gearchiveerde of eenmalige Price wordt geweigerd', async () => {
  const gearchiveerd = { ...geldigeBasic, active: false };
  assert.equal((await resolveSignupOffer(stripeMet({ price_basic: gearchiveerd }), 'basic', ENV)).reason,
               'price_inactive');
  const eenmalig = { ...geldigeBasic, recurring: null };
  assert.equal((await resolveSignupOffer(stripeMet({ price_basic: eenmalig }), 'basic', ENV)).reason,
               'price_not_recurring');
});

test('trial_days wordt gelezen, niet geïnterpreteerd', () => {
  assert.equal(trialDaysFromPrice({ metadata: { trial_days: '180' } }), 180);
  assert.equal(trialDaysFromPrice({ metadata: { trial_days: '30' } }), 30);
  // Ontbrekend = geldig aanbod zonder gratis periode, geen fout en geen default.
  assert.equal(trialDaysFromPrice({ metadata: {} }), null);
  // Alles wat geen positief geheel getal is, telt als afwezig.
  for (const raar of ['0', '-5', '1.5', 'zes maanden', '', ' ']) {
    assert.equal(trialDaysFromPrice({ metadata: { trial_days: raar } }), null, `onterecht gelezen: ${raar}`);
  }
});
