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
// en wordt hier omgerekend naar één absolute `trial_end`.
//
// En sinds 16 aug (besluit 10) is een campagne geen langere trial meer maar een
// Coupon met een Promotion Code. De harde regel die hier bewaakt wordt: een
// campagne VERVANGT de trial. Zouden ze allebei meegaan, dan is STARTGRATIS
// zeven maanden gratis in plaats van zes — en dat merk je pas bij de eerste
// factuur die niet komt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSignupOffer,
  lookupKeyForPlan,
  trialIntervalUitPrice,
} from '../lib/signup-offer.ts';

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

/** Zoals `zoekPromotiecodeBijStripe` hem oplevert. */
const startgratis = {
  geldig: true,
  code: 'STARTGRATIS',
  promotionCodeId: 'promo_test',
  coupon: {
    percentOff: 100, amountOffCenten: null,
    duur: 'repeating', duurMaanden: 6, valuta: null,
  },
};

function deps(prices, promo = () => Promise.resolve(geenPromo)) {
  return {
    stripe: { prices: { list: async ({ lookup_keys, active }) => {
      assert.equal(active, true, 'gearchiveerde prijzen mogen niet meedoen');
      const p = prices[lookup_keys[0]];
      return { data: p ? [p] : [] };
    } } },
    valideerPromo: promo,
  };
}
const opt = (extra = {}) => ({ nu: NU, ...extra });

test('routing: de lookup key volgt uit de plannaam', () => {
  // Afgeleid, niet uit een lijst: een nieuw pakket heeft hier niets nodig.
  assert.equal(lookupKeyForPlan('basic'), 'basic_standaard');
  assert.equal(lookupKeyForPlan('premium'), 'premium_standaard');
});

test('geldig aanbod: plan komt uit de metadata, niet uit het verzoek', async () => {
  const r = await resolveSignupOffer(deps({ basic_standaard: geldigeBasic }), 'basic', opt());
  assert.equal(r.ok, true);
  assert.equal(r.plan, 'basic');
  assert.equal(r.priceId, 'price_basic');
});

test('bedragen: netto uit Stripe, bruto erbij gerekend, vandaag €0', async () => {
  const r = await resolveSignupOffer(deps({ basic_standaard: geldigeBasic }), 'basic', opt());
  assert.equal(r.bedragen.nettoCenten, 2500);
  assert.equal(r.bedragen.btwCenten, 525);
  assert.equal(r.bedragen.brutoCenten, 3025);
  assert.equal(r.bedragen.valuta, 'EUR');
  // Tijdens een gratis periode is dit het getal dat het prominentst hoort.
  assert.equal(r.vandaagVerschuldigdCenten, 0);
});

test('Premium rekent net zo: €45 → €54,45', async () => {
  const r = await resolveSignupOffer(deps({ premium_standaard: geldigePremium }), 'premium', opt());
  assert.equal(r.bedragen.nettoCenten, 4500);
  assert.equal(r.bedragen.brutoCenten, 5445);
});

test('zonder gratis periode is vandaag wél het brutobedrag verschuldigd', async () => {
  const zonderTrial = { ...geldigeBasic, metadata: { plan: 'basic' } };
  const r = await resolveSignupOffer(deps({ basic_standaard: zonderTrial }), 'basic', opt());
  assert.equal(r.ok, true);
  assert.equal(r.trial, null);
  assert.equal(r.vandaagVerschuldigdCenten, 3025);
});

test('de trial is een kalendermaand, met de zin en de datum erbij', async () => {
  const r = await resolveSignupOffer(deps({ basic_standaard: geldigeBasic }), 'basic', opt());
  assert.equal(r.trial.tekst, '1 maand gratis');
  assert.equal(r.trial.eersteIncassoISO, '2026-09-11T10:00:00.000Z');
  assert.equal(r.trial.trialEndUnix, Math.floor(Date.parse('2026-09-11T10:00:00.000Z') / 1000));
  assert.equal(r.korting, null);
});

test('STARTGRATIS is een coupon en VERVANGT de trial', async () => {
  const promo = async (code) => (code === 'STARTGRATIS' ? startgratis : geenPromo);

  for (const [plan, price] of [
    ['basic', geldigeBasic],
    ['premium', geldigePremium],
  ]) {
    const r = await resolveSignupOffer(
      deps({ [`${plan}_standaard`]: price }, promo), plan, opt({ promoCode: 'startgratis' }),
    );
    assert.equal(r.ok, true, plan);
    // DIT is de kern: geen trial naast de coupon.
    assert.equal(r.trial, null, plan);
    assert.equal(r.korting.code, 'STARTGRATIS', plan);
    assert.equal(r.korting.promotionCodeId, 'promo_test', plan);
    assert.equal(r.korting.tekst, '6 maanden gratis', plan);
    assert.equal(r.vandaagVerschuldigdCenten, 0, plan);
    assert.equal(r.promoGeweigerd, false, plan);
  }
});

test('een gedeeltelijke korting toont het restbedrag, geen \u20ac0', async () => {
  // Zou dit 0 tonen, dan zegt het scherm "gratis" terwijl er wordt afgeschreven.
  const promo = async () => ({
    geldig: true, code: 'WELKOM20', promotionCodeId: 'promo_20',
    coupon: { percentOff: 20, amountOffCenten: null, duur: 'repeating', duurMaanden: 3, valuta: null },
  });
  const r = await resolveSignupOffer(
    deps({ premium_standaard: geldigePremium }, promo), 'premium', opt({ promoCode: 'WELKOM20' }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.trial, null);
  assert.equal(r.korting.tekst, '20% korting, 3 maanden');
  // \u20ac45 netto \u2192 20% eraf = \u20ac36 \u2192 + 21% btw = \u20ac43,56.
  assert.equal(r.vandaagVerschuldigdCenten, 4356);
});

test('een vast bedrag korting rekent op het NETTO, net als Stripe', async () => {
  const promo = async () => ({
    geldig: true, code: 'TIENEURO', promotionCodeId: 'promo_10',
    coupon: { percentOff: null, amountOffCenten: 1000, duur: 'once', duurMaanden: null, valuta: 'EUR' },
  });
  const r = await resolveSignupOffer(
    deps({ premium_standaard: geldigePremium }, promo), 'premium', opt({ promoCode: 'TIENEURO' }),
  );
  // \u20ac45 - \u20ac10 = \u20ac35 \u2192 + 21% = \u20ac42,35. Stripe kort v\u00f3\u00f3r de btw.
  assert.equal(r.vandaagVerschuldigdCenten, 4235);
  assert.equal(r.korting.tekst, '\u20ac 10,00 korting, de eerste maand');
});

test('een ongeldige code blokkeert de inschrijving niet, maar telt ook niet mee', async () => {
  const r = await resolveSignupOffer(
    deps({ basic_standaard: geldigeBasic }), 'basic', opt({ promoCode: 'BESTAATNIET' }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.promoGeweigerd, true);
  // Terug naar het standaardaanbod, en geen code om vast te leggen.
  assert.equal(r.trial.tekst, '1 maand gratis');
  assert.equal(r.korting, null);
});

test('de promotabel wordt alleen geraadpleegd als er een code is ingevuld', async () => {
  let aangeroepen = 0;
  const promo = async () => { aangeroepen++; return geenPromo; };
  await resolveSignupOffer(deps({ basic_standaard: geldigeBasic }, promo), 'basic', opt());
  assert.equal(aangeroepen, 0);
  await resolveSignupOffer(deps({ basic_standaard: geldigeBasic }, promo), 'basic', opt({ promoCode: '  ' }));
  assert.equal(aangeroepen, 0, 'witruimte is geen code');
});

test('NULPRIJS-POORT: een terugkerende Price van €0 wordt hard geweigerd', async () => {
  // Zulke prijzen staan sinds 10 aug in het account. Mét geldige
  // plan-metadata zou een verwisselde secret een rijschool voor altijd gratis
  // laten draaien, met werkend entitlement en dus volledig onzichtbaar.
  const nul = { ...geldigeBasic, unit_amount: 0 };
  const r = await resolveSignupOffer(deps({ basic_standaard: nul }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'price_zero_amount');
});

test('een Price zonder expliciet btw-gedrag wordt geweigerd', async () => {
  // Op `unspecified` weigert Stripe de Checkout zodra automatische btw aanstaat.
  const onbepaald = { ...geldigeBasic, tax_behavior: 'unspecified' };
  const r = await resolveSignupOffer(deps({ basic_standaard: onbepaald }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'tax_behavior_unspecified');
});

test('een Price zonder bedrag levert geen kaart op', async () => {
  const tiered = { ...geldigeBasic, unit_amount: null };
  const r = await resolveSignupOffer(deps({ basic_standaard: tiered }), 'basic', opt());
  assert.equal(r.reason, 'price_without_amount');
});

test('G5: een Price zonder plan-metadata komt niet in een Checkout', async () => {
  const zonder = { ...geldigeBasic, metadata: { trial_interval: '1 month' } };
  const r = await resolveSignupOffer(deps({ basic_standaard: zonder }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'plan_metadata_missing');
});

test('G5: een onbekende planwaarde is een fout, geen gok', async () => {
  const fout = { ...geldigeBasic, metadata: { plan: 'gold' } };
  const r = await resolveSignupOffer(deps({ basic_standaard: fout }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'plan_metadata_invalid');
});

test('G5: metadata die niet overeenkomt met de keuze wordt geweigerd', async () => {
  // De lookup key `basic_standaard` hangt aan de Premium-Price. Dat kan door
  // een verkeerd versleepte naam in Stripe, en het mag nooit doorgaan: iemand
  // zou Basic verwachten en Premium-rechten krijgen, of andersom.
  const verwisseld = { ...geldigePremium, id: 'price_basic' };
  const r = await resolveSignupOffer(deps({ basic_standaard: verwisseld }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'plan_metadata_mismatch');
  assert.match(r.detail, /gekozen=basic/);
});

test('een lookup key die nergens op wijst levert geen Checkout op', async () => {
  // Bijvoorbeeld: de prijs is gearchiveerd en de naam is niet meegehuisd.
  // Dan liever hier stoppen dan een willekeurige andere prijs pakken.
  const r = await resolveSignupOffer(deps({}), 'basic', opt());
  assert.equal(r.reason, 'price_not_found');
  assert.equal(r.detail, 'basic_standaard');
});

test('een gearchiveerde of eenmalige Price wordt geweigerd', async () => {
  const gearchiveerd = { ...geldigeBasic, active: false };
  assert.equal((await resolveSignupOffer(deps({ basic_standaard: gearchiveerd }), 'basic', opt())).reason,
    'price_inactive');
  const eenmalig = { ...geldigeBasic, recurring: null };
  assert.equal((await resolveSignupOffer(deps({ basic_standaard: eenmalig }), 'basic', opt())).reason,
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
  const r = await resolveSignupOffer(deps({ basic_standaard: kapot }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'trial_interval_invalid');
});

test('een geldige code met kapotte configuratie valt niet stil terug', async () => {
  // De klant heeft een geldige code; hem stilzwijgend één maand geven in
  // plaats van zes is erger dan stoppen.
  const promo = async () => ({ geldig: false, configuratiefout: 'coupon STUK: kort niets' });
  const r = await resolveSignupOffer(deps({ basic_standaard: geldigeBasic }, promo), 'basic', opt({ promoCode: 'STUK' }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'coupon_onbruikbaar');
  assert.match(r.detail, /STUK/);
});

test('een duur korter dan 48 uur wordt geweigerd — Stripe zou hem afwijzen', async () => {
  const kort = { ...geldigeBasic, metadata: { plan: 'basic', trial_interval: '1 day' } };
  const r = await resolveSignupOffer(deps({ basic_standaard: kort }), 'basic', opt());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'trial_te_kort');
});
