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
process.env.STRIPE_PRICE_BASIC = 'price_basic';
process.env.STRIPE_PRICE_PREMIUM = 'price_premium';

let tabellen = {};
let ingevoegd = [];
let sessies = [];
let prices = {};

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
      prices: { retrieve: async (id) => { if (!prices[id]) throw new Error('geen'); return prices[id]; } },
      checkout: { sessions: { create: async (p) => {
        sessies.push(p);
        return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
      } } },
    }),
  },
});

const { POST } = await import('../app/api/signup/start/route.ts');

function reset() {
  tabellen = {}; ingevoegd = []; sessies = [];
  prices = {
    price_basic:   { id: 'price_basic',   active: true, recurring: { interval: 'month' }, metadata: { plan: 'basic' } },
    price_premium: { id: 'price_premium', active: true, recurring: { interval: 'month' }, metadata: { plan: 'premium' } },
  };
}

function verzoek(overrides = {}) {
  return {
    headers: { get: () => '203.0.113.' + Math.floor(Math.random() * 250) },
    json: async () => ({
      plan: 'basic', legal_form: 'eenmanszaak', country_code: 'NL',
      school_name: 'Rijschool Test', first_name: 'Anne', last_name: 'Test',
      email: `nieuw-${Math.random().toString(36).slice(2)}@example.com`,
      phone: '0612345678', address: 'Teststraat 1', postal_code: '1234 AB',
      city: 'Teststad', kvk_number: '12345678',
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

test('een ongeldig plan stopt vóór Stripe', async () => {
  reset();
  const res = await POST(verzoek({ plan: 'gratis' }));
  assert.equal(res.status, 400);
  assert.equal(sessies.length, 0, 'er is toch een Checkout aangemaakt');
  assert.equal(ingevoegd.length, 0, 'er is toch een pending rij geschreven');
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
  prices.price_basic = { ...prices.price_basic, metadata: {} };
  const res = await POST(verzoek());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, 'plan_metadata_missing');
  assert.equal(sessies.length, 0);
  assert.equal(ingevoegd.length, 0, 'de pending rij is vóór G5 geschreven');
});

test('G5: een verwisselde secret levert nooit een betaalpagina op', async () => {
  reset();
  prices.price_basic = { ...prices.price_basic, metadata: { plan: 'premium' } };
  const res = await POST(verzoek());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, 'plan_metadata_mismatch');
  assert.equal(sessies.length, 0);
});

test('de Checkout krijgt de trialduur uit Stripe, niet uit Ribba', async () => {
  reset();
  prices.price_basic = { ...prices.price_basic, metadata: { plan: 'basic', trial_days: '30' } };
  await POST(verzoek());
  assert.equal(sessies[0].subscription_data.trial_period_days, 30);

  reset();
  // Zonder trial_days: geldig aanbod, direct betalen — geen verzonnen default.
  await POST(verzoek());
  assert.equal('trial_period_days' in sessies[0].subscription_data, false);
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
