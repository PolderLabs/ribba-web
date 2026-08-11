// Het aanbod ophalen vóór Checkout — G5, de nulprijs-poort en de duur.
//
// Wat hier bewaakt wordt is de grens uit fase 3A, aan de andere kant van de
// keten: een Price-ID bepaalt WELK aanbod Checkout krijgt, maar nooit welke
// rechten iemand krijgt. Dat komt uitsluitend uit `plan`-metadata.
//
// En de aanscherping: het is niet genoeg dát er een geldig plan staat — het
// moet overeenkomen met wat de rijschool koos. Een verwisselde secret zou
// anders iemand die Basic kiest naar de Premium-Price sturen.
//
// Sinds 11 aug komt daar de duur bij. Die leeft in Stripe (`trial_interval`)
// of in de promotabel, en wordt hier omgerekend naar één absolute `trial_end`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSignupOffer,
  priceIdForPlan,
  trialIntervalUitPrice,
} from '../lib/signup-offer.ts';

const ENV = { STRIPE_PRICE_BASIC: 'price_basic', STRIPE_PRICE_PREMIUM: 'price_premium' };
const NU = new Date('2026-08-11T10:00:00.000Z');

const geldigeBasic = {
  id: 'price_basic', active: true, currency: 'eur',
  recurring: { interval: 'month' }, unit_amount: 2500, tax_behavior: 'exclusive',
  metadata: { plan: 'basic', trial_interval: '1 month' },
};
const geldigePremium = {
  id: 'price_premium', active: true, currency: 'eur',
  recurring: { interval: 'month' }, unit_amount: 4500, tax_behavior: 'exclusive',
  metadata: { plan: 'premium', trial_interval: '1 month' },
};

const geenPromo = { geldig: false };

function deps(prices, promo = () => Promise.resolve(geenPromo)) {
  return {
    stripe: { prices: { retrieve: async (id) => {
      if (!prices[id]) throw new Error('No such price');
      return prices[id];
    } } },
    valideerPromo: promo,
  };
}
const opt = (extra = {}) => ({ env: ENV, nu: NU, ...extra });

test('routing: het secret bepaalt welke Price wordt opgehaald', () => {
  assert.equal(priceIdForPlan('basic', ENV), 'price_basic');
  assert.equal(priceIdForPlan('premium', ENV), 'price_premium');
  assert.equal(priceIdForPlan('basic', {}), null);
});

test('geldig aanbod: plan komt uit de metadata, niet uit het verzoek', async () => {
  const r = await resolveSignupOffer(deps({ price_basic: geldigeBasic }), 'basic', opt());
  assert.equal(r.ok, true);
  assert.equal(r.plan, 'basic');
  assert.equal(r.priceId, 'price_basic');
});

test('bedragen: netto uit Stripe, bruto erbij gerekend, vandaag €0', async () => {
  const r = await resolveSignupOffer(deps({ price_basic: geldigeBasic }), 'basic', opt());
  assert.equal(r.bedragen.nettoCenten, 2500);
  assert.equal(r.bedragen.btwCenten, 525);
  assert.equal(r.bedragen.brutoCenten, 3025);
  assert.equal(r.bedragen.valuta, 'EUR');
  // Tijdens een gratis periode is dit het getal dat het prominentst hoort.
  assert.equal(r.vandaagVerschuldigdCenten, 0);
});

test('Premium rekent net zo: €45 → €54,45', async () => {
  const r = await resolveSignupOffer(deps({ price_premium: geldigePremium }), 'premium', opt());
  assert.equal(r.bedragen.nettoCenten, 4500);
  assert.equal(r.bedragen.brutoCenten, 5445);
});

test('zonder gratis periode is vandaag wél het brutobedrag verschuldigd', async () => {
  const zonderTrial = { ...geldigeBasic, metadata: { plan: 'basic' } };
  const r = await resolveSignupOffer(deps({ price_basic: zonderTrial }), 'basic', opt());
  assert.equal(r.ok, true);
  assert.equal(r.trial, null);
  assert.equal(r.vandaagVerschuldigdCenten, 3025);
});

test('de trial is een kalendermaand, met de zin en de datum erbij', async () => {
  const r = await resolveSignupOffer(deps({ price_basic: geldigeBasic }), 'basic', opt());
  assert.equal(r.trial.tekst, '1 maand gratis');
  assert.equal(r.trial.eersteIncassoISO, '2026-09-11T10:00:00.000Z');
  assert.equal(r.trial.trialEndUnix, Math.floor(Date.parse('2026-09-11T10:00:00.000Z') / 1000));
  assert.equal(r.trial.viaPromocode, null);
});

test('STARTGRATIS overschrijft de duur — en geldt voor beide plannen', async () => {
  const promo = async (code) => code === 'STARTGRATIS'
    ? { geldig: true, code: 'STARTGRATIS', interval: '6 mons' }
    : geenPromo;

  for (const [plan, price, id] of [
    ['basic', geldigeBasic, 'price_basic'],
    ['premium', geldigePremium, 'price_premium'],
  ]) {
    const r = await resolveSignupOffer(
      deps({ [id]: price }, promo), plan, opt({ promoCode: 'startgratis' }),
    );
    assert.equal(r.ok, true, plan);
    assert.equal(r.trial.tekst, '6 maanden gratis', plan);
    assert.equal(r.trial.eersteIncassoISO, '2027-02-11T10:00:00.000Z', plan);
    assert.equal(r.trial.viaPromocode, 'STARTGRATIS', plan);
    assert.equal(r.promoGeweigerd, false, plan);
  }
});

test('de promo vervangt de standaardduur, hij telt er niet bij op', async () => {
  const promo = async () => ({ geldig: true, code: 'STARTGRATIS', interval: '6 mons' });
  const r = await resolveSignupOffer(deps({ price_basic: geldigeBasic }, promo), 'basic', opt({ promoCode: 'STARTGRATIS' }));
  // Zes maanden, niet één plus zes.
  assert.equal(r.trial.aantal, 6);
});

test('een ongeldige code blokkeert de inschrijving niet, maar telt ook niet mee', async () => {
  const r = await resolveSignupOffer(
    deps({ price_basic: geldigeBasic }), 'basic', opt({ promoCode: 'BESTAATNIET' }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.promoGeweigerd, true);
  // Terug naar het standaardaanbod, en geen code om vast te leggen.
  assert.equal(r.trial.tekst, '1 maand gratis');
  assert.equal(r.trial.viaPromocode, null);
});

test('de promotabel wordt alleen geraadpleegd als er een code is ingevuld', async () => {
  let aangeroepen = 0;
  const promo = async () => { aangeroepen++; return geenPromo; };
  await resolveSignupOffer(deps({ price_basic: geldigeBasic }, promo), 'basic', opt());
  assert.equal(aangeroepen, 0);
  await resolveSignupOffer(deps({ price_basic: geldigeBasic }, promo), 'basic', opt({ promoCode: '  ' }));
  assert.equal(aangeroepen, 0, 'witruimte is geen code');
});

test('NULPRIJS-POORT: een terugkerende Price van €0 wordt hard geweigerd', async () => {
  // Zulke prijzen staan sinds 10 aug in het account. Mét geldige
  // plan-metadata zou een verwisselde secret een rijschool voor altijd gratis
  // laten draaien, met werkend entitlement en dus volledig onzichtbaar.
  const nul = { ...geldigeBasic, unit_amount: 0 };
  const r = await resolveSignupOffer(deps({ price_basic: nul }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'price_zero_amount');
});

test('een Price zonder expliciet btw-gedrag wordt geweigerd', async () => {
  // Op `unspecified` weigert Stripe de Checkout zodra automatische btw aanstaat.
  const onbepaald = { ...geldigeBasic, tax_behavior: 'unspecified' };
  const r = await resolveSignupOffer(deps({ price_basic: onbepaald }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'tax_behavior_unspecified');
});

test('een Price zonder bedrag levert geen kaart op', async () => {
  const tiered = { ...geldigeBasic, unit_amount: null };
  const r = await resolveSignupOffer(deps({ price_basic: tiered }), 'basic', opt());
  assert.equal(r.reason, 'price_without_amount');
});

test('G5: een Price zonder plan-metadata komt niet in een Checkout', async () => {
  const zonder = { ...geldigeBasic, metadata: { trial_interval: '1 month' } };
  const r = await resolveSignupOffer(deps({ price_basic: zonder }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'plan_metadata_missing');
});

test('G5: een onbekende planwaarde is een fout, geen gok', async () => {
  const fout = { ...geldigeBasic, metadata: { plan: 'gold' } };
  const r = await resolveSignupOffer(deps({ price_basic: fout }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'plan_metadata_invalid');
});

test('G5: metadata die niet overeenkomt met de keuze wordt geweigerd', async () => {
  // Verwisselde secret: STRIPE_PRICE_BASIC wijst naar de Premium-Price.
  const verwisseld = { ...geldigePremium, id: 'price_basic' };
  const r = await resolveSignupOffer(deps({ price_basic: verwisseld }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'plan_metadata_mismatch');
  assert.match(r.detail, /gekozen=basic/);
});

test('een ontbrekend of onvindbaar secret levert geen Checkout op', async () => {
  const a = await resolveSignupOffer(deps({}), 'basic', { env: {}, nu: NU });
  assert.equal(a.reason, 'price_not_configured');
  const b = await resolveSignupOffer(deps({}), 'basic', opt());
  assert.equal(b.reason, 'price_not_found');
});

test('een gearchiveerde of eenmalige Price wordt geweigerd', async () => {
  const gearchiveerd = { ...geldigeBasic, active: false };
  assert.equal((await resolveSignupOffer(deps({ price_basic: gearchiveerd }), 'basic', opt())).reason,
    'price_inactive');
  const eenmalig = { ...geldigeBasic, recurring: null };
  assert.equal((await resolveSignupOffer(deps({ price_basic: eenmalig }), 'basic', opt())).reason,
    'price_not_recurring');
});

test('trial_interval wordt gelezen, niet geïnterpreteerd', () => {
  assert.deepEqual(trialIntervalUitPrice({ metadata: { trial_interval: '1 month' } }),
    { aanwezig: true, interval: { eenheid: 'month', aantal: 1 } });
  // Ontbrekend = geldig aanbod zonder gratis periode, geen fout en geen default.
  assert.deepEqual(trialIntervalUitPrice({ metadata: {} }), { aanwezig: false });
  // Aanwezig maar onleesbaar is iets ANDERS dan afwezig: dat is een
  // configuratiefout en moet zichtbaar worden.
  assert.deepEqual(trialIntervalUitPrice({ metadata: { trial_interval: '30' } }),
    { aanwezig: true, interval: null });
});

test('een onleesbare duur op de Price stopt het aanbod', async () => {
  const kapot = { ...geldigeBasic, metadata: { plan: 'basic', trial_interval: '30 dagen' } };
  const r = await resolveSignupOffer(deps({ price_basic: kapot }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'trial_interval_invalid');
});

test('een geldige code met kapotte configuratie valt niet stil terug', async () => {
  // De klant heeft een geldige code; hem stilzwijgend één maand geven in
  // plaats van zes is erger dan stoppen.
  const promo = async () => ({ geldig: true, code: 'STUK', interval: 'zes maanden' });
  const r = await resolveSignupOffer(deps({ price_basic: geldigeBasic }, promo), 'basic', opt({ promoCode: 'STUK' }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'trial_interval_invalid');
  assert.match(r.detail, /STUK/);
});

test('een duur korter dan 48 uur wordt geweigerd — Stripe zou hem afwijzen', async () => {
  const kort = { ...geldigeBasic, metadata: { plan: 'basic', trial_interval: '1 day' } };
  const r = await resolveSignupOffer(deps({ price_basic: kort }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'trial_te_kort');
});
