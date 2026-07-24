// register-school — pint vast dat de REGISTRATIE-OPRICHTER als eigenaar
// (school_role='owner', eigenaar-SSOT sinds ribbaPro-migratie 20260724160000)
// wordt aangemaakt. Sinds F3.1A is de DB-default voor instructors.school_role
// de veilige 'employee'; alle rolgevoelige domeinen (financiën, Stripe
// Billing Portal) zijn admin-niveau ('owner'/'admin'). De oprichter van een
// nieuwe school moet de eigenaarsrol dus expliciet meekrijgen — anders is
// een via de web geregistreerde school direct eigenaar-loos. Invite-paden
// blijven buiten dit bestand: die maken hun instructeursrijen in ribbaPro
// aan en behouden daar hun bestaande rolgedrag (default employee; invites
// kunnen nooit een owner opleveren).
//
// Pint daarnaast het fail-closed-gedrag vast: weigert de database 'owner'
// (CHECK-constraint, migratie niet toegepast), dan faalt registratie hard
// mét volledige cleanup — géén stille fallback naar 'admin'.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.NEXT_PUBLIC_BASE_URL = 'https://preview.test';
delete process.env.RESEND_API_KEY; // e-mailpad slaat dan netjes over

const inserts = []; // { table, payload }
const deletes = []; // { table, column, value }
const deletedAuthUsers = []; // user ids
let failInstructorInsertWith = null; // Postgres-error om instructor-insert mee te laten falen

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
    from(table) {
      return {
        // slug-uniekheidscheck: geen bestaande school gevonden
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
        insert(payload) {
          inserts.push({ table, payload });
          const failThis = table === 'instructors' && failInstructorInsertWith;
          return {
            // pad mét .select('id').single() (drivingschools/instructors)
            select: () => ({
              single: async () =>
                failThis
                  ? { data: null, error: failInstructorInsertWith }
                  : { data: { id: `${table}-1` }, error: null },
            }),
            // pad dat direct ge-await wordt (licenses/invitation_links)
            then: (resolve) => resolve({ data: null, error: null }),
          };
        },
        // cleanup-pad: .delete().eq('id', ...) wordt direct ge-await
        delete: () => ({
          eq: (column, value) => {
            deletes.push({ table, column, value });
            return Promise.resolve({ error: null });
          },
        }),
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
mock.module('@/lib/rate-limit', {
  namedExports: { rateLimit: () => true },
});
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
  deletes.length = 0;
  deletedAuthUsers.length = 0;
  failInstructorInsertWith = null;
}

function makeRequest() {
  return {
    headers: { get: () => null },
    json: async () => ({
      legal_form: 'eenmanszaak',
      country_code: 'NL',
      school_name: 'Rijschool Oprichterstest',
      first_name: 'Anne',
      last_name: 'Oprichter',
      email: 'oprichter@example.com',
      phone: '0612345678',
      address: 'Teststraat 1',
      postal_code: '1234 AB',
      city: 'Teststad',
      kvk_number: '12345678',
      password: 'wachtwoord123',
      legal_acceptances: { terms: '1.0', privacy: '1.0', dpa: '1.0' },
    }),
  };
}

test('registratie-oprichter wordt aangemaakt met school_role=owner', async () => {
  resetState();
  const res = await POST(makeRequest());
  assert.equal(res.status, 200);

  const instructorInserts = inserts.filter((i) => i.table === 'instructors');
  assert.equal(instructorInserts.length, 1); // precies één instructeursrij
  assert.equal(instructorInserts[0].payload.school_role, 'owner');
  assert.equal(instructorInserts[0].payload.user_id, 'auth-user-1');
  assert.equal(instructorInserts[0].payload.status, 'active');

  // De multi-use uitnodigingslink van de school blijft een leerling-invite;
  // dit pad kent geen rol-parameter en blijft dus op het bestaande gedrag
  // (instructeurs via invites krijgen in ribbaPro de veilige default).
  const inviteInserts = inserts.filter((i) => i.table === 'invitation_links');
  assert.equal(inviteInserts.length, 1);
  assert.equal(inviteInserts[0].payload.invite_type, 'student');
  assert.equal('school_role' in inviteInserts[0].payload, false);
});

test('CHECK-weigering van owner → harde 500 mét cleanup, geen fallback naar admin', async () => {
  resetState();
  failInstructorInsertWith = {
    code: '23514',
    message:
      'new row for relation "instructors" violates check constraint "instructors_school_role_check"',
  };

  const res = await POST(makeRequest());
  assert.equal(res.status, 500);

  // Eén poging met 'owner', géén tweede insert met 'admin' als fallback
  const instructorInserts = inserts.filter((i) => i.table === 'instructors');
  assert.equal(instructorInserts.length, 1);
  assert.equal(instructorInserts[0].payload.school_role, 'owner');

  // Volledige cleanup: school verwijderd én auth-user verwijderd
  const schoolDeletes = deletes.filter((d) => d.table === 'drivingschools');
  assert.equal(schoolDeletes.length, 1);
  assert.equal(schoolDeletes[0].value, 'drivingschools-1');
  assert.deepEqual(deletedAuthUsers, ['auth-user-1']);

  // Geen vervolg-writes na de mislukte instructeur (license/invite-link)
  assert.equal(inserts.filter((i) => i.table === 'instructor_licenses').length, 0);
  assert.equal(inserts.filter((i) => i.table === 'invitation_links').length, 0);
});
