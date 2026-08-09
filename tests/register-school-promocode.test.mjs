// register-school — promocode bij registratie (STARTGRATIS).
//
// Wat hier wordt vastgepind:
//
//   1. zonder code verandert er niets: validate_promo_code wordt niet
//      aangeroepen en promo_code gaat als null de RPC in;
//   2. met een geldige code gaat de GENORMALISEERDE code (upper, getrimd)
//      naar zowel de voorcontrole als de transactionele RPC;
//   3. een ongeldige code wordt afgewezen VÓÓRDAT er een auth-user bestaat —
//      een typefout mag geen account aanmaken dat we daarna weer opruimen;
//   4. raakt een code uitgeput TUSSEN de voorcontrole en de transactie, dan
//      wint de transactie: de registratie faalt met een veldfout, niet met
//      een generieke 500, en de auth-user wordt opgeruimd.
//
// De garantie zelf (inwisseling in dezelfde transactie, één promo per school)
// leeft in de database en wordt bewezen door
// ribbaPro/supabase/tests/run_promocodes_db.sh. Dit bestand pint uitsluitend
// het gedrag van de route vast.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.NEXT_PUBLIC_BASE_URL = 'https://preview.test';
delete process.env.RESEND_API_KEY;

const rpcCalls = [];
const deletedAuthUsers = [];
let generateLinkCalls = 0;

// Regelbaar per test
let promoValidResult = { valid: true, trial_ends_at: '2027-02-09T00:00:00Z' };
let createSchoolError = null;

function makeFakeSupabase() {
  return {
    auth: {
      admin: {
        generateLink: async () => {
          generateLinkCalls++;
          return {
            data: {
              properties: { action_link: 'https://verify.test/confirm' },
              user: { id: 'auth-user-1' },
            },
            error: null,
          };
        },
        deleteUser: async (id) => {
          deletedAuthUsers.push(id);
          return { error: null };
        },
      },
    },
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      if (fn === 'validate_promo_code') {
        return { data: promoValidResult, error: null };
      }
      if (createSchoolError) return { data: null, error: createSchoolError };
      return {
        data: { outcome: 'created', school_id: 'school-1', instructor_id: 'instructor-1' },
        error: null,
      };
    },
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert() {
          return {
            select: () => ({ single: async () => ({ data: { id: 'row-1' }, error: null }) }),
            then: (resolve) => resolve({ data: null, error: null }),
          };
        },
      };
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
mock.module('@/lib/rate-limit', { namedExports: { rateLimit: () => true } });
mock.module('@/lib/admin-notifications', {
  namedExports: { sendAdminNotification: async () => {} },
});
mock.module('@/lib/legal-acceptances', {
  namedExports: {
    recordLegalAcceptances: async () => {},
    pickAcceptedVersions: (_v, types) =>
      types.map((t) => ({ document_type: t, document_version: '1.0' })),
    extractIpAddress: () => '127.0.0.1',
    extractUserAgent: () => 'test',
  },
});

const { POST } = await import('../app/api/register-school/route.ts');

function resetState() {
  rpcCalls.length = 0;
  deletedAuthUsers.length = 0;
  generateLinkCalls = 0;
  promoValidResult = { valid: true, trial_ends_at: '2027-02-09T00:00:00Z' };
  createSchoolError = null;
}

function makeRequest(overrides = {}) {
  return {
    headers: { get: () => null },
    json: async () => ({
      legal_form: 'eenmanszaak',
      country_code: 'NL',
      school_name: 'Rijschool Promotest',
      first_name: 'Anne',
      last_name: 'Oprichter',
      email: 'promo@example.com',
      phone: '0612345678',
      address: 'Teststraat 1',
      postal_code: '1234 AB',
      city: 'Teststad',
      kvk_number: '12345678',
      password: 'wachtwoord123',
      legal_acceptances: { terms: '1.0', privacy: '1.0', dpa: '1.0' },
      ...overrides,
    }),
  };
}

const createCall = () => rpcCalls.find((c) => c.fn === 'create_school_with_owner');
const validateCall = () => rpcCalls.find((c) => c.fn === 'validate_promo_code');

test('zonder promocode: geen voorcontrole, promo_code is null', async () => {
  resetState();
  const res = await POST(makeRequest());

  assert.equal(res.status, 200);
  assert.equal(validateCall(), undefined, 'lege code mag geen controle uitlokken');
  assert.equal(createCall().args.p_school.promo_code, null);
});

test('geldige promocode gaat genormaliseerd naar voorcontrole én transactie', async () => {
  resetState();
  const res = await POST(makeRequest({ promo_code: '  startgratis ' }));

  assert.equal(res.status, 200);
  assert.equal(validateCall().args.p_code, 'STARTGRATIS');
  assert.equal(createCall().args.p_school.promo_code, 'STARTGRATIS');
});

test('ongeldige promocode wordt afgewezen vóór het aanmaken van een auth-user', async () => {
  resetState();
  promoValidResult = { valid: false };

  const res = await POST(makeRequest({ promo_code: 'BESTAATNIET' }));

  assert.equal(res.status, 400);
  assert.equal(res.body.field, 'promo_code');
  assert.equal(createCall(), undefined, 'registratie mag niet doorgaan');
  assert.equal(generateLinkCalls, 0, 'geen auth-user bij een typefout in de code');
  assert.deepEqual(deletedAuthUsers, [], 'niets aangemaakt, dus niets op te ruimen');
});

test('code uitgeput tussen controle en transactie: veldfout, geen generieke 500', async () => {
  resetState();
  // Voorcontrole zegt geldig, de transactie weigert alsnog — de race die de
  // reden is dat de garantie in de database hoort en niet in deze route.
  createSchoolError = {
    message: 'Promocode EENMALIG is niet (meer) geldig',
    details: 'ribba_error:promo_code_exhausted',
  };

  const res = await POST(makeRequest({ promo_code: 'EENMALIG' }));

  assert.equal(res.status, 400);
  assert.equal(res.body.field, 'promo_code');
  assert.deepEqual(deletedAuthUsers, ['auth-user-1'], 'auth-user moet opgeruimd zijn');
});

test('andere RPC-fout blijft een generieke 500 zonder veldverwijzing', async () => {
  resetState();
  createSchoolError = { message: 'iets anders kapot', details: '' };

  const res = await POST(makeRequest({ promo_code: 'STARTGRATIS' }));

  assert.equal(res.status, 500);
  assert.equal(res.body.field, undefined);
  assert.deepEqual(deletedAuthUsers, ['auth-user-1']);
});
