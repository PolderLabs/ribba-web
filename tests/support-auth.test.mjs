// Supportportaal — het doorlaatpunt (lib/support-auth.ts).
//
// Dit portaal ontsluit gegevens van álle rijscholen. Wat deze tests vastleggen
// is daarom niet "werkt de happy path", maar de drie eigenschappen waarop de
// hele opzet rust:
//
//   1. GEEN LOGREGEL, GEEN DATA. Faalt het schrijven naar platform_access_log,
//      dan draait de handler niet en komt er niets terug. Dit is de kern: het
//      logboek is de voorwaarde voor toegang, niet een bijproduct ervan. Zonder
//      deze test kan iemand later "even" de logfout opvangen en doorgaan — en
//      dan is de belofte uit de verwerkersovereenkomst (art. 7.3) stil weg.
//   2. FAIL-CLOSED OP ELKE HORDE. Geen token, alleen een wachtwoord (aal1),
//      geen rij in platform_staff: allemaal weigeren, en in de gevallen waar
//      we weten wíé het probeerde óók vastleggen.
//   3. HET SPOOR KLOPT. De logregel bevat de handeling, het niveau en de
//      uitkomst — anders is er wel een logboek maar geen verantwoording.
//
// Niveau 1 en 2 bestaan nog niet als schermen; de redencontrole wordt hier al
// wel bewezen, zodat die er staat vóórdat het eerste leerlinggegeven in beeld
// komt.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

let currentClient;

mock.module('@supabase/supabase-js', { namedExports: { createClient: () => currentClient } });
mock.module('next/server', {
  namedExports: {
    NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    NextRequest: class NextRequest {},
  },
});

const { withSupportAccess, readAal } = await import('../lib/support-auth.ts');
const { GET: schoolsGET } = await import('../app/api/support/schools/route.ts');
const { GET: schoolGET } = await import('../app/api/support/schools/[id]/route.ts');

const USER = { id: 'staff-1', email: 'support@ribba.app' };

/** Token met een aal-claim. De handtekening doet er niet toe: getUser (server-side) valideert. */
function token(aal) {
  const payload = Buffer.from(JSON.stringify({ aal }), 'utf8').toString('base64url');
  return `header.${payload}.signature`;
}

function makeClient({
  user = USER,
  authError = null,
  isStaff = true,
  staffError = null,
  logError = null,
  rpc = {},
} = {}) {
  const logs = [];
  const rpcCalls = [];
  return {
    logs,
    rpcCalls,
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    rpc: async (naam, args) => {
      rpcCalls.push({ naam, args });
      if (naam === 'is_platform_staff') return { data: isStaff, error: staffError };
      return rpc[naam] ?? { data: null, error: null };
    },
    from(table) {
      assert.equal(table, 'platform_access_log', 'alleen het logboek wordt direct beschreven');
      return {
        insert: async (row) => {
          if (logError) return { error: { message: logError } };
          logs.push(row);
          return { error: null };
        },
      };
    },
  };
}

function req(authorization, url = 'https://mijn.ribba.app/api/support/schools') {
  return {
    url,
    headers: {
      get: (k) => {
        const h = {
          authorization,
          'x-forwarded-for': '203.0.113.9, 10.0.0.1',
          'user-agent': 'test-agent',
        };
        return h[k] ?? null;
      },
    },
  };
}

const NIVEAU_0 = { action: 'schools.list', level: 0 };

// ── 1. Geen logregel, geen data ────────────────────────────────────────

test('logboek onbeschikbaar → geen data, handler draait niet', async () => {
  currentClient = makeClient({ logError: 'connection refused' });
  let handlerDraaide = false;

  const res = await withSupportAccess(req(`Bearer ${token('aal2')}`), NIVEAU_0, async () => {
    handlerDraaide = true;
    return { schools: ['geheim'] };
  });

  assert.equal(handlerDraaide, false,
    'de handler mag niet draaien als de handeling niet vastgelegd kon worden');
  assert.equal(res.status, 503);
  assert.ok(!JSON.stringify(res.body).includes('geheim'), 'er mag geen data lekken');
});

// ── 2. Fail-closed op elke horde ───────────────────────────────────────

test('geen token → 401 en niets in het logboek', async () => {
  currentClient = makeClient();
  let handlerDraaide = false;

  const res = await withSupportAccess(req(null), NIVEAU_0, async () => {
    handlerDraaide = true; return {};
  });

  assert.equal(res.status, 401);
  assert.equal(handlerDraaide, false);
  assert.equal(currentClient.logs.length, 0,
    'zonder geldig token is er geen persoon om de poging aan toe te schrijven');
});

test('ongeldige sessie → 401', async () => {
  currentClient = makeClient({ user: null, authError: { message: 'bad jwt' } });
  const res = await withSupportAccess(req('Bearer rommel'), NIVEAU_0, async () => ({}));
  assert.equal(res.status, 401);
});

test('alleen wachtwoord (aal1) → 403, poging wél vastgelegd', async () => {
  currentClient = makeClient();
  let handlerDraaide = false;

  const res = await withSupportAccess(req(`Bearer ${token('aal1')}`), NIVEAU_0, async () => {
    handlerDraaide = true; return {};
  });

  assert.equal(res.status, 403);
  assert.equal(handlerDraaide, false);
  assert.equal(currentClient.logs.length, 1);
  assert.equal(currentClient.logs[0].result, 'denied');
  assert.equal(currentClient.logs[0].meta.denied_reason, 'mfa_required');
  assert.equal(currentClient.rpcCalls.length, 0,
    'zonder tweede factor hoeven we niet eens te kijken of iemand staff is');
});

test('geen tweefactor-claim in het token → 403 (fail-closed, niet doorlaten)', async () => {
  currentClient = makeClient();
  const res = await withSupportAccess(req('Bearer geen.echte.jwt'), NIVEAU_0, async () => ({}));
  assert.equal(res.status, 403);
  assert.equal(readAal('geen.echte.jwt'), null);
});

test('ingelogd maar geen supportmedewerker → 403 en vastgelegd', async () => {
  currentClient = makeClient({ isStaff: false });
  let handlerDraaide = false;

  const res = await withSupportAccess(req(`Bearer ${token('aal2')}`), NIVEAU_0, async () => {
    handlerDraaide = true; return {};
  });

  assert.equal(res.status, 403);
  assert.equal(handlerDraaide, false);
  assert.equal(currentClient.logs[0].meta.denied_reason, 'not_platform_staff');
});

test('mislukte staff-lookup → weigeren, niet doorlaten', async () => {
  currentClient = makeClient({ isStaff: null, staffError: { message: 'timeout' } });
  const res = await withSupportAccess(req(`Bearer ${token('aal2')}`), NIVEAU_0, async () => ({}));
  assert.equal(res.status, 500);
  assert.equal(currentClient.logs[0].result, 'denied');
});

// ── 3. Het spoor klopt ─────────────────────────────────────────────────

test('bevoegd → data terug, met een volledige logregel', async () => {
  currentClient = makeClient();

  const res = await withSupportAccess(
    req(`Bearer ${token('aal2')}`),
    { action: 'schools.list', level: 0, targetType: 'schools' },
    async ({ user }) => ({ schools: [user.id] }),
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { schools: ['staff-1'] });

  const [log] = currentClient.logs;
  assert.equal(currentClient.logs.length, 1, 'precies één regel per handeling');
  assert.equal(log.staff_user_id, 'staff-1');
  assert.equal(log.staff_email, 'support@ribba.app');
  assert.equal(log.action, 'schools.list');
  assert.equal(log.level, 0);
  assert.equal(log.result, 'ok');
  assert.equal(log.target_type, 'schools');
  assert.equal(log.ip, '203.0.113.9', 'eerste IP uit x-forwarded-for, niet de hele keten');
  assert.equal(log.user_agent, 'test-agent');
});

test('handler klapt → 500, en de inzage blijft vastgelegd', async () => {
  currentClient = makeClient();

  const res = await withSupportAccess(req(`Bearer ${token('aal2')}`), NIVEAU_0, async () => {
    throw new Error('kapotte query');
  });

  assert.equal(res.status, 500);
  assert.equal(currentClient.logs.length, 2);
  assert.equal(currentClient.logs[0].result, 'ok', 'wie keek staat vast, ook als het daarna misgaat');
  assert.equal(currentClient.logs[1].result, 'error');
});

// ── 4. Redenplicht vanaf niveau 1 ──────────────────────────────────────

test('niveau 1 zonder reden → geweigerd', async () => {
  currentClient = makeClient();
  let handlerDraaide = false;

  const res = await withSupportAccess(
    req(`Bearer ${token('aal2')}`),
    { action: 'student.diagnose', level: 1, targetSchoolId: 'school-1' },
    async () => { handlerDraaide = true; return {}; },
  );

  assert.equal(res.status, 400);
  assert.equal(handlerDraaide, false);
  assert.equal(currentClient.logs[0].meta.denied_reason, 'reason_required');
});

test('niveau 1 mét reden → doorgelaten, reden staat in het logboek', async () => {
  currentClient = makeClient();

  const res = await withSupportAccess(
    req(`Bearer ${token('aal2')}`),
    { action: 'student.diagnose', level: 1, targetSchoolId: 'school-1', reason: 'melding rijschool #12' },
    async () => ({ ok: true }),
  );

  assert.equal(res.status, 200);
  assert.equal(currentClient.logs[0].reason, 'melding rijschool #12');
  assert.equal(currentClient.logs[0].level, 1);
});

// ── 5. De route zelf ───────────────────────────────────────────────────

test('/api/support/schools haalt niveau 0 op via de databasefunctie', async () => {
  currentClient = makeClient({
    rpc: { support_school_overview: { data: [{ school_id: 's1', school_name: 'Liamdrive' }], error: null } },
  });

  const res = await schoolsGET(req(`Bearer ${token('aal2')}`));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.schools, [{ school_id: 's1', school_name: 'Liamdrive' }]);
  const rpc = currentClient.rpcCalls.find((c) => c.naam === 'support_school_overview');
  assert.ok(rpc, 'de route moet support_school_overview() gebruiken en niet zelf tabellen bevragen');
  assert.equal(currentClient.logs[0].action, 'schools.list');
});

// ── 6. Testscholen staan er standaard uit ──────────────────────────────
//
// Bewust een expliciete kolom (drivingschools.is_internal) en geen naamfilter:
// een filter op '[TEST]' verbergt op een dag een echte klant die toevallig
// "Rijschool Testrit" heet. Wat het scherm toonde, moet bovendien uit het
// logboek te herleiden zijn — vandaar de keuze in meta.

test('scholenlijst laat interne omgevingen standaard weg', async () => {
  currentClient = makeClient({
    rpc: { support_school_overview: { data: [], error: null } },
  });

  await schoolsGET(req(`Bearer ${token('aal2')}`));

  const rpc = currentClient.rpcCalls.find((c) => c.naam === 'support_school_overview');
  assert.deepEqual(rpc.args, { p_include_internal: false },
    'zonder ?intern=1 mogen eigen test- en pilotomgevingen niet meekomen');
  assert.equal(currentClient.logs[0].meta.intern, false);
});

test('?intern=1 toont ze wel, en dat staat in het logboek', async () => {
  currentClient = makeClient({
    rpc: { support_school_overview: { data: [], error: null } },
  });

  await schoolsGET(req(`Bearer ${token('aal2')}`, 'https://mijn.ribba.app/api/support/schools?intern=1'));

  const rpc = currentClient.rpcCalls.find((c) => c.naam === 'support_school_overview');
  assert.deepEqual(rpc.args, { p_include_internal: true });
  assert.equal(currentClient.logs[0].meta.intern, true,
    'achteraf moet te zien zijn wat er op het scherm stond');
});

// ── 7. Schooldetail ────────────────────────────────────────────────────
//
// "Welke klant heb je bekeken" is precies wat een toegangslogboek moet
// vastleggen; zonder target_school_id is de logregel waardeloos.

test('schooldetail legt vast wélke rijschool is bekeken', async () => {
  currentClient = makeClient({
    rpc: {
      support_school_detail: { data: { school: { naam: 'Liamdrive' } }, error: null },
      support_school_events: { data: [{ bron: 'cbr' }], error: null },
    },
  });

  const res = await schoolGET(
    req(`Bearer ${token('aal2')}`, 'https://mijn.ribba.app/api/support/schools/school-9'),
    { params: Promise.resolve({ id: 'school-9' }) },
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.detail, { school: { naam: 'Liamdrive' } });
  assert.deepEqual(res.body.events, [{ bron: 'cbr' }]);

  const [log] = currentClient.logs;
  assert.equal(log.action, 'school.detail');
  assert.equal(log.target_school_id, 'school-9', 'zonder school is de logregel waardeloos');
  assert.equal(log.level, 0);
});

test('schooldetail zonder tweede factor geeft niets prijs', async () => {
  currentClient = makeClient({
    rpc: { support_school_detail: { data: { school: { naam: 'Liamdrive' } }, error: null } },
  });

  const res = await schoolGET(
    req(`Bearer ${token('aal1')}`, 'https://mijn.ribba.app/api/support/schools/school-9'),
    { params: Promise.resolve({ id: 'school-9' }) },
  );

  assert.equal(res.status, 403);
  assert.ok(!JSON.stringify(res.body).includes('Liamdrive'));
  assert.equal(currentClient.rpcCalls.filter((c) => c.naam.startsWith('support_school')).length, 0,
    'er mag niet eens een query naar de school gaan');
});

test('/api/support/schools zonder tweede factor geeft niets prijs', async () => {
  currentClient = makeClient({
    rpc: { support_school_overview: { data: [{ school_name: 'Liamdrive' }], error: null } },
  });

  const res = await schoolsGET(req(`Bearer ${token('aal1')}`));

  assert.equal(res.status, 403);
  assert.ok(!JSON.stringify(res.body).includes('Liamdrive'));
});
