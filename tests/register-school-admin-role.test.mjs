// register-school — pint vast dat de REGISTRATIE-OPRICHTER als school-admin
// wordt aangemaakt (correctie 21 jul 2026). Sinds F3.1A is de DB-default
// voor instructors.school_role de veilige 'employee'; alle rolgevoelige
// domeinen (financiën, Stripe Billing Portal) zijn admin-only. De oprichter
// van een nieuwe school moet die rol dus expliciet meekrijgen — anders is
// een via de web geregistreerde school direct beheerder-loos. Invite-paden
// blijven buiten dit bestand: die maken hun instructeursrijen in ribbaPro
// aan en behouden daar hun bestaande rolgedrag (default employee).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.NEXT_PUBLIC_BASE_URL = 'https://preview.test';
delete process.env.RESEND_API_KEY; // e-mailpad slaat dan netjes over

const inserts = []; // { table, payload }

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
        deleteUser: async () => ({ error: null }),
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
          return {
            // pad mét .select('id').single() (drivingschools/instructors)
            select: () => ({
              single: async () => ({
                data: { id: `${table}-1` },
                error: null,
              }),
            }),
            // pad dat direct ge-await wordt (licenses/invitation_links)
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

test('registratie-oprichter wordt aangemaakt met school_role=admin', async () => {
  inserts.length = 0;
  const res = await POST(makeRequest());
  assert.equal(res.status, 200);

  const instructorInserts = inserts.filter((i) => i.table === 'instructors');
  assert.equal(instructorInserts.length, 1); // precies één instructeursrij
  assert.equal(instructorInserts[0].payload.school_role, 'admin');
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
