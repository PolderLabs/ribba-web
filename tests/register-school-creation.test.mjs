// register-school — pint het ATOMAIRE creatiepad vast (F0).
//
// Sinds F0 maakt deze route school + eigenaar + trial NIET meer met losse
// inserts aan, maar via één transactionele RPC in ribbaPro:
// create_school_with_owner (migratie 20260725100000). Wat hier wordt
// vastgepind:
//
//   1. de RPC wordt aangeroepen met een DETERMINISTISCHE operation_key
//      (harde eis: anders vervalt de idempotentie-garantie van de
//      claims-tabel en resteert alleen de unieke instructors.user_id);
//   2. de oprichter wordt eigenaar — dat gebeurt nu ín de RPC, dus de route
//      stuurt géén school_role meer mee (de RPC zet 'owner');
//   3. side-effects (audit, invite-link, mail) gebeuren pas NA een geslaagde
//      commit, en een fout daarin maakt de registratie NIET ongedaan;
//   4. faalt de RPC, dan is de transactie volledig teruggerold en resteert
//      alleen de auth-user — die wordt opgeruimd (fail-closed, geen halve
//      registratie);
//   5. een hervatte registratie (claim bestaat al, bv. na een timeout)
//      levert succes op zonder tweede school of tweede auth-user.
//
// Invite-paden blijven buiten dit bestand: die maken hun instructeursrijen in
// ribbaPro aan en behouden daar hun bestaande rolgedrag (default employee).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.NEXT_PUBLIC_BASE_URL = 'https://preview.test';
delete process.env.RESEND_API_KEY; // e-mailpad slaat dan netjes over

const inserts = []; // { table, payload }
const rpcCalls = []; // { fn, args }
const deletedAuthUsers = []; // user ids

// Regelbaar gedrag per test
let rpcResult = { outcome: 'created', school_id: 'school-1', instructor_id: 'instructor-1' };
let rpcError = null;
let existingClaim = null; // rij uit school_registration_claims
let failInviteInsert = false; // side-effect ná commit laten falen

function makeFakeSupabase() {
  return {
    auth: {
      admin: {
        generateLink: async () => ({
          data: {
            properties: { action_link: 'https://verify.test/confirm' },
            user: { id: 'auth-user-1' },
          },
          error: null,
        }),
        deleteUser: async (id) => {
          deletedAuthUsers.push(id);
          return { error: null };
        },
      },
    },
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      return rpcError ? { data: null, error: rpcError } : { data: rpcResult, error: null };
    },
    from(table) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              table === 'school_registration_claims'
                ? { data: existingClaim, error: null }
                : { data: null, error: null }, // slug-check: geen collision
          }),
        }),
        insert(payload) {
          inserts.push({ table, payload });
          if (table === 'invitation_links' && failInviteInsert) {
            throw new Error('invite-link insert kapot (gesimuleerd)');
          }
          return {
            select: () => ({ single: async () => ({ data: { id: `${table}-1` }, error: null }) }),
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
  inserts.length = 0;
  rpcCalls.length = 0;
  deletedAuthUsers.length = 0;
  rpcResult = { outcome: 'created', school_id: 'school-1', instructor_id: 'instructor-1' };
  rpcError = null;
  existingClaim = null;
  failInviteInsert = false;
}

const EMAIL = 'oprichter@example.com';

function makeRequest(overrides = {}) {
  return {
    headers: { get: () => null },
    json: async () => ({
      legal_form: 'eenmanszaak',
      country_code: 'NL',
      school_name: 'Rijschool Oprichterstest',
      first_name: 'Anne',
      last_name: 'Oprichter',
      email: EMAIL,
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

test('school wordt via de transactionele RPC aangemaakt, niet met losse inserts', async () => {
  resetState();
  const res = await POST(makeRequest());
  assert.equal(res.status, 200);

  // Precies één aanroep van het atomaire creatiepad
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, 'create_school_with_owner');

  const args = rpcCalls[0].args;
  assert.equal(args.p_user_id, 'auth-user-1');
  assert.equal(args.p_school.name, 'Rijschool Oprichterstest');
  assert.equal(args.p_school.country_code, 'NL'); // NOT NULL zonder default
  assert.equal(args.p_school.email, EMAIL);
  assert.equal(args.p_school.registration_slug, 'rijschool-oprichterstest'); // mét koppeltekens

  // GEEN losse inserts meer voor de drie kernobjecten
  for (const table of ['drivingschools', 'instructors', 'instructor_licenses']) {
    assert.equal(
      inserts.filter((i) => i.table === table).length,
      0,
      `${table} mag niet meer los worden geïnsert`,
    );
  }

  // De eigenaarsrol wordt door de RPC gezet, niet door de route
  assert.equal('school_role' in args.p_school, false);
});

test('operation_key is deterministisch (zelfde e-mail ⇒ zelfde sleutel)', async () => {
  resetState();
  await POST(makeRequest());
  const key1 = rpcCalls[0].args.p_operation_key;

  resetState();
  await POST(makeRequest());
  const key2 = rpcCalls[0].args.p_operation_key;

  assert.equal(key1, key2, 'retry moet dezelfde sleutel opleveren');
  assert.equal(
    key1,
    createHash('sha256').update(`school-registration:v1:${EMAIL}`).digest('hex'),
    'sleutel moet afgeleid zijn van het genormaliseerde e-mailadres',
  );

  // Ander e-mailadres ⇒ andere sleutel
  resetState();
  await POST(makeRequest({ email: 'iemand.anders@example.com' }));
  assert.notEqual(rpcCalls[0].args.p_operation_key, key1);
});

test('RPC-fout ⇒ 500, auth-user opgeruimd, géén side-effects', async () => {
  resetState();
  rpcError = { code: 'P0001', message: 'iets mis in de transactie' };

  const res = await POST(makeRequest());
  assert.equal(res.status, 500);

  // Transactie is teruggerold; alleen de auth-user resteert en wordt gewist
  assert.deepEqual(deletedAuthUsers, ['auth-user-1']);
  assert.equal(inserts.filter((i) => i.table === 'invitation_links').length, 0);
});

test("uitkomst 'busy' ⇒ 409 en auth-user opgeruimd", async () => {
  resetState();
  rpcResult = { outcome: 'busy' };

  const res = await POST(makeRequest());
  assert.equal(res.status, 409);
  assert.deepEqual(deletedAuthUsers, ['auth-user-1']);
});

test('bestaande claim ⇒ hervat: succes zonder tweede auth-user of tweede RPC', async () => {
  resetState();
  existingClaim = { status: 'completed', school_id: 'school-1', instructor_id: 'instructor-1' };

  const res = await POST(makeRequest());
  assert.equal(res.status, 200);

  // Geen RPC en geen auth-user: de registratie was al gecommit
  assert.equal(rpcCalls.length, 0);
  assert.deepEqual(deletedAuthUsers, []);
});

test('side-effect faalt NA commit ⇒ registratie blijft staan, account NIET verwijderd', async () => {
  resetState();
  failInviteInsert = true; // gooit ná de geslaagde RPC

  const res = await POST(makeRequest());

  // De school bestaat; de gebruiker is geregistreerd
  assert.equal(res.status, 200);
  assert.equal(rpcCalls.length, 1);
  // KRITISCH: geen cleanup van de auth-user — dat zou een wees-school opleveren
  assert.deepEqual(deletedAuthUsers, []);
});
