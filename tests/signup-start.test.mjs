// Fase 3B.3 — POST /api/signup/start.
//
// Wat hier bewaakt wordt is de VOLGORDE. Elke stap die kan mislukken moet
// mislukken vóórdat er een betaalpagina bestaat: vormfouten, een bezet
// e-mailadres, en G5. Andersom zou iemand een machtiging afgeven voor een
// account dat niet kan bestaan, of betalen voor een aanbod waar wij geen
// rechten aan kunnen koppelen.
//
// En: dit endpoint maakt nooit een school, een account of een licentie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';

let tabellen = {};
let ingevoegd = [];
let sessies = [];
let prices = {};
let promoCodes = {};
let coupons = {};
let promoAanroepen = [];

mock.module('next/server', {
  namedExports: {
    NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200, json: async () => body }) },
    NextRequest: class NextRequest {},
  },
});
mock.module('@/lib/rate-limit', { namedExports: { rateLimit: () => true } });

mock.module('@supabase/supabase-js', {
  namedExports: {
    createClient: () => ({
      from(tabel) {
        const api = {
          _filters: {},
          select: () => api,
          ilike: (k, v) => { api._filters[k] = v; return api; },
          eq: () => api,
          neq: () => api,
          update: () => ({ eq: async () => ({ error: null }) }),
          maybeSingle: async () => ({ data: tabellen[tabel]?.bestaand ?? null }),
          insert(rij) {
            return {
              select: () => ({
                single: async () => {
                  if (tabellen[tabel]?.insertFout) return { data: null, error: { message: 'duplicate' } };
                  ingevoegd.push({ tabel, rij });
                  return { data: { id: 'pending-1' }, error: null };
                },
              }),
            };
          },
        };
        return api;
      },
    }),
  },
});

mock.module('@/lib/stripe', {
  namedExports: {
    getStripe: () => ({
      // Zoekt op lookup key, niet op id: een prijswijziging in Stripe kost dan
      // geen omgevingsvariabele en geen deploy.
      prices: { list: async ({ lookup_keys }) => {
        const p = prices[lookup_keys[0]];
        return { data: p ? [p] : [] };
      } },
      // Stripe is sinds besluit 10 de enige bron voor campagnes: bestaat de
      // code, is hij actief, en wat doet de coupon eronder.
      promotionCodes: { list: async ({ code }) => {
        promoAanroepen.push({ code });
        const pc = promoCodes[code];
        return { data: pc ? [pc] : [] };
      } },
      coupons: { retrieve: async (id) => {
        if (!coupons[id]) throw new Error('geen coupon');
        return coupons[id];
      } },
      checkout: { sessions: { create: async (p) => {
        sessies.push(p);
        return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
      } } },
    }),
  },
});

const { POST } = await import('../app/api/signup/start/route.ts');

function reset() {
  tabellen = {}; ingevoegd = []; sessies = []; promoAanroepen = [];
  promoCodes = {
    STARTGRATIS: {
      id: 'promo_test', code: 'STARTGRATIS', active: true,
      promotion: { type: 'coupon', coupon: 'coupon_test' },
    },
  };
  coupons = {
    coupon_test: {
      id: 'coupon_test', valid: true, percent_off: 100,
      amount_off: null, duration: 'repeating', duration_in_months: 6, currency: null,
    },
  };
  prices = {
    basic_standaard: {
      id: 'price_basic', active: true, currency: 'eur',
      recurring: { interval: 'month' }, unit_amount: 2500, tax_behavior: 'exclusive',
      metadata: { plan: 'basic', trial_interval: '1 month' },
    },
    premium_standaard: {
      id: 'price_premium', active: true, currency: 'eur',
      recurring: { interval: 'month' }, unit_amount: 4500, tax_behavior: 'exclusive',
      metadata: { plan: 'premium', trial_interval: '1 month' },
    },
  };
}

/** Hoeveel maanden zit er tussen nu en de trial_end die Checkout kreeg? */
function maandenTot(unix) {
  const nu = new Date();
  const eind = new Date(unix * 1000);
  return (eind.getUTCFullYear() - nu.getUTCFullYear()) * 12 + (eind.getUTCMonth() - nu.getUTCMonth());
}

function verzoek(overrides = {}) {
  return {
    headers: { get: () => '203.0.113.' + Math.floor(Math.random() * 250) },
    json: async () => ({
      legal_form: 'eenmanszaak', country_code: 'NL',
      school_name: 'Rijschool Test', first_name: 'Anne', last_name: 'Test',
      email: `nieuw-${Math.random().toString(36).slice(2)}@example.com`,
      phone: '0612345678', address: 'Teststraat 1', postal_code: '1234 AB',
      city: 'Teststad', kvk_number: '12345678',
      legal_acceptances: { terms: '2026-07-v1', privacy: '2026-07-v1', dpa: '2026-08-v1' },
      ...overrides,
    }),
  };
}

test('happy path: pending registratie + Checkout-URL, géén school of account', async () => {
  reset();
  const res = await POST(verzoek());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);

  // Precies één rij, en die zit in pending_registrations.
  assert.equal(ingevoegd.length, 1);
  assert.equal(ingevoegd[0].tabel, 'pending_registrations');
  // Geen school, geen instructeur, geen licentie.
  for (const t of ['drivingschools', 'instructors', 'instructor_licenses']) {
    assert.equal(ingevoegd.some((i) => i.tabel === t), false, `er is toch in ${t} geschreven`);
  }
});

test('de pending rij bevat geen wachtwoord of ander geheim', async () => {
  reset();
  await POST(verzoek());
  const sleutels = Object.keys(ingevoegd[0].rij);
  for (const verboden of ['password', 'wachtwoord', 'secret', 'token']) {
    assert.equal(sleutels.some((k) => k.includes(verboden)), false, `veld ${verboden} zit erin`);
  }
});

test('een plan in de body wordt genegeerd — iedereen start op Premium', async () => {
  // Zou de body het plan bepalen, dan schrijft iemand met een aangepast
  // verzoek zich op Basic in en krijgt hij het aanbod dat voor Premium geldt.
  reset();
  const res = await POST(verzoek({ plan: 'basic' }));
  assert.equal(res.status, 200);
  assert.equal(sessies[0].line_items[0].price, 'price_premium');
  assert.equal(ingevoegd[0].rij.plan, 'premium');
  assert.equal(sessies[0].subscription_data.metadata.plan, 'premium');
});

test('een bezet e-mailadres stopt vóór het mandaat', async () => {
  reset();
  tabellen.drivingschools = { bestaand: { id: 'school-1' } };
  const res = await POST(verzoek());
  assert.equal(res.status, 409);
  assert.equal(sessies.length, 0, 'er is toch een Checkout aangemaakt');
  assert.equal(ingevoegd.length, 0, 'er is toch een pending rij geschreven');
});

test('G5: een Price zonder plan-metadata levert nooit een betaalpagina op', async () => {
  reset();
  prices.premium_standaard = { ...prices.premium_standaard, metadata: {} };
  const res = await POST(verzoek());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, 'plan_metadata_missing');
  assert.equal(sessies.length, 0);
  assert.equal(ingevoegd.length, 0, 'de pending rij is vóór G5 geschreven');
});

test('G5: een verwisselde secret levert nooit een betaalpagina op', async () => {
  reset();
  prices.premium_standaard = { ...prices.premium_standaard, metadata: { plan: 'basic' } };
  const res = await POST(verzoek());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, 'plan_metadata_mismatch');
  assert.equal(sessies.length, 0);
});

test('de Checkout krijgt een absolute trial_end, geen aantal dagen', async () => {
  reset();
  await POST(verzoek());
  const sd = sessies[0].subscription_data;
  // Nooit meer dagen: dat maakte van een maand een afronding op 30.
  assert.equal('trial_period_days' in sd, false);
  assert.equal(typeof sd.trial_end, 'number');
  assert.equal(maandenTot(sd.trial_end), 1, 'één kalendermaand vooruit');

  reset();
  // Zonder trial_interval: geldig aanbod, direct betalen — geen verzonnen default.
  prices.premium_standaard = { ...prices.premium_standaard, metadata: { plan: 'premium' } };
  await POST(verzoek());
  assert.equal('trial_end' in sessies[0].subscription_data, false);
});

test('STARTGRATIS gaat als coupon mee, en VERVANGT de trial', async () => {
  reset();
  await POST(verzoek({ promo_code: 'startgratis' }));

  // De coupon doet het werk...
  assert.deepEqual(sessies[0].discounts, [{ promotion_code: 'promo_test' }]);
  // ...en er gaat GEEN trial naast. Anders is STARTGRATIS zeven maanden
  // gratis in plaats van zes: eerst de standaardmaand, dan pas de coupon.
  assert.equal('trial_end' in sessies[0].subscription_data, false);

  assert.equal(ingevoegd[0].rij.promo_code, 'STARTGRATIS');
  assert.equal(sessies[0].subscription_data.metadata.promo_code, 'STARTGRATIS');
});

test('zonder code gaat er geen discounts-veld naar Checkout', async () => {
  reset();
  await POST(verzoek());
  assert.equal('discounts' in sessies[0], false);
  assert.equal(typeof sessies[0].subscription_data.trial_end, 'number');
});

test('een ongeldige code wordt NIET vastgelegd en verandert het aanbod niet', async () => {
  reset();
  const res = await POST(verzoek({ promo_code: 'BESTAATNIET' }));

  // De inschrijving gaat gewoon door — een typefout blokkeert niemand.
  assert.equal(res.status, 200);
  // Maar er staat geen campagne op de registratie die nooit is gegeven.
  assert.equal(ingevoegd[0].rij.promo_code, null);
  assert.equal('promo_code' in sessies[0].subscription_data.metadata, false);
  // En het standaardaanbod geldt: trial, geen korting.
  assert.equal('discounts' in sessies[0], false);
  assert.equal(maandenTot(sessies[0].subscription_data.trial_end), 1);
});

test('het aanbod wordt server-side opnieuw bepaald, niet uit het verzoek gelezen', async () => {
  reset();
  // De browser beweert van alles over bedrag en duur. Het mag niets doen.
  await POST(verzoek({
    trial_end: 99999999999, trial_period_days: 3650,
    bedragCenten: 1, amount: 1, vandaagVerschuldigdCenten: 999,
  }));

  const sd = sessies[0].subscription_data;
  assert.equal(maandenTot(sd.trial_end), 1, 'de client heeft de trial beïnvloed');
  assert.notEqual(sd.trial_end, 99999999999);
  assert.equal('trial_period_days' in sd, false);
  // En de Price komt nog steeds uit het secret, niet uit de body.
  assert.equal(sessies[0].line_items[0].price, 'price_premium');
});

test('Stripe wordt alleen geraadpleegd als er een code is ingevuld', async () => {
  reset();
  await POST(verzoek());
  assert.equal(promoAanroepen.length, 0);

  reset();
  await POST(verzoek({ promo_code: 'STARTGRATIS' }));
  assert.equal(promoAanroepen.length, 1);
  assert.equal(promoAanroepen[0].code, 'STARTGRATIS');
});

test('een code met een onbruikbare coupon stopt vóór de betaalpagina', async () => {
  // De code klopt, onze configuratie niet. Stilzwijgend het standaardaanbod
  // geven zou betekenen dat iemand met een geldige code één maand krijgt in
  // plaats van zes — en dat merkt hij pas als de incasso komt.
  reset();
  coupons.coupon_test = { ...coupons.coupon_test, valid: false };
  const res = await POST(verzoek({ promo_code: 'STARTGRATIS' }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, 'coupon_onbruikbaar');
  assert.equal(sessies.length, 0);
  assert.equal(ingevoegd.length, 0);
});

test('de pending-registratie-id gaat mee als metadata naar Stripe', async () => {
  reset();
  await POST(verzoek());
  assert.equal(sessies[0].metadata.pending_registration_id, 'pending-1');
  assert.equal(sessies[0].subscription_data.metadata.pending_registration_id, 'pending-1');
  assert.equal(sessies[0].client_reference_id, 'pending-1');
});

test('een tweede poging voor hetzelfde adres hergebruikt de bestaande registratie', async () => {
  reset();
  tabellen.pending_registrations = {
    insertFout: true,
    bestaand: { id: 'pending-bestaand', status: 'pending_checkout' },
  };
  const res = await POST(verzoek());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).pendingRegistrationId, 'pending-bestaand');
  assert.equal(sessies.length, 1, 'er hoort precies één nieuwe Checkout te zijn');
});

test('een al betaalde registratie stuurt niemand opnieuw naar Checkout', async () => {
  reset();
  tabellen.pending_registrations = {
    insertFout: true,
    bestaand: { id: 'pending-betaald', status: 'checkout_completed' },
  };
  const res = await POST(verzoek());
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /wordt afgerond/);
  assert.equal(sessies.length, 0, 'er is toch een tweede Checkout aangemaakt');
});

// ── Juridische akkoorden ────────────────────────────────────────────────────
//
// Het akkoord gaat vooraf aan het mandaat, en dat is precies wat je later wilt
// kunnen laten zien. `legal_acceptances` eist een user_id die hier nog niet
// bestaat, dus het reist mee op de pending-rij en wordt bij activatie
// gematerialiseerd — met het OORSPRONKELIJKE moment.

test('geen akkoorden → 400, geen pending rij en geen Checkout', async () => {
  reset();
  const res = await POST(verzoek({ legal_acceptances: undefined }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /akkoord/i);
  assert.equal(ingevoegd.length, 0);
  assert.equal(sessies.length, 0);
});

test('twee van de drie akkoorden is niet genoeg', async () => {
  reset();
  const res = await POST(verzoek({
    legal_acceptances: { terms: '2026-07-v1', privacy: '2026-07-v1' },
  }));
  assert.equal(res.status, 400);
  assert.equal(ingevoegd.length, 0);
});

test('een verouderde versie telt niet mee — de client is getuige, geen bron', async () => {
  reset();
  const res = await POST(verzoek({
    legal_acceptances: { terms: '2020-01-v1', privacy: '2026-07-v1', dpa: '2026-08-v1' },
  }));
  assert.equal(res.status, 400);
  assert.equal(ingevoegd.length, 0, 'er is toch een registratie met een oud akkoord gemaakt');
});

test('het akkoord komt op de pending rij, met moment, IP en user-agent', async () => {
  reset();
  const voor = Date.now();
  await POST(verzoek());
  const na = Date.now();

  const akkoord = ingevoegd[0].rij.legal_acceptance;
  assert.ok(akkoord, 'legal_acceptance ontbreekt op de pending rij');
  assert.deepEqual(akkoord.documents, {
    terms: '2026-07-v1', privacy: '2026-07-v1', dpa: '2026-08-v1',
  });

  // Het moment is dat van het formulier, niet van later.
  const moment = Date.parse(akkoord.accepted_at);
  assert.ok(moment >= voor && moment <= na, 'accepted_at ligt buiten het verzoekvenster');
  assert.match(akkoord.accepted_at, /^\d{4}-\d{2}-\d{2}T/);

  // IP en user-agent zijn aanwezig als velden; null mag, verzinnen niet.
  assert.ok('ip_address' in akkoord);
  assert.ok('user_agent' in akkoord);
});

test('de versies komen van de server, niet uit het verzoek', async () => {
  reset();
  // De client beweert een andere versiestring bij een bekend documenttype.
  await POST(verzoek({
    legal_acceptances: { terms: '2026-07-v1', privacy: '2026-07-v1', dpa: '2026-08-v1', extra: 'stiekem' },
  }));
  const docs = ingevoegd[0].rij.legal_acceptance.documents;
  assert.deepEqual(Object.keys(docs).sort(), ['dpa', 'privacy', 'terms']);
  assert.equal('extra' in docs, false, 'een onbekend document is meegeglipt');
});

test('het akkoord wordt vastgelegd vóór er een Checkout bestaat', async () => {
  reset();
  // G5 faalt ná de akkoordcontrole: er mag dan niets zijn geschreven.
  prices.premium_standaard = { ...prices.premium_standaard, metadata: {} };
  const res = await POST(verzoek());
  assert.equal(res.status, 503);
  assert.equal(ingevoegd.length, 0);
  assert.equal(sessies.length, 0);
});

// ── Marketingherkomst ───────────────────────────────────────────────────────
//
// De school bestaat hier nog niet, dus de herkomst reist mee op de pending-rij
// en wordt bij activatie doorgezet. Dezelfde sanitizer als de oude route: geen
// tweede definitie van wat een geldige herkomst is.

test('de herkomst komt gesanitized op de pending rij', async () => {
  reset();
  await POST(verzoek({
    attribution: {
      utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'rijschool-planner',
      referrer: 'https://www.google.com/', landing_page: '/pro',
      captured_at: '2026-08-10T14:22:01.000Z',
    },
  }));
  assert.deepEqual(ingevoegd[0].rij.signup_attribution, {
    utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'rijschool-planner',
    referrer: 'https://www.google.com/', landing_page: '/pro',
    captured_at: '2026-08-10T14:22:01.000Z',
  });
});

test('geen herkomst is geldig en blokkeert niets', async () => {
  reset();
  const res = await POST(verzoek());
  assert.equal(res.status, 200);
  assert.equal(ingevoegd[0].rij.signup_attribution, null);
});

test('onbekende velden komen de database niet in', async () => {
  reset();
  await POST(verzoek({
    attribution: { utm_source: 'google', kwaadaardig: 'x', wachtwoord: 'geheim' },
  }));
  assert.deepEqual(ingevoegd[0].rij.signup_attribution, { utm_source: 'google' });
});

test('rommel in attribution levert null op, geen fout', async () => {
  for (const rommel of ['tekst', 42, [], { utm_source: 123 }]) {
    reset();
    const res = await POST(verzoek({ attribution: rommel }));
    assert.equal(res.status, 200, `geweigerd op ${JSON.stringify(rommel)}`);
    assert.equal(ingevoegd[0].rij.signup_attribution, null);
  }
});
