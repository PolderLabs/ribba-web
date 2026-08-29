// Supportportaal — de precheck vóór tweefactor (app/api/support/eligibility).
//
// Wat hier wordt vastgelegd is niet "werkt de happy path", maar drie dingen die
// stil kapot kunnen gaan:
//
//   1. HET IS GEEN ORACLE. Het endpoint beantwoordt uitsluitend een vraag over
//      het eigen, server-geverifieerde account. Zou het ooit een user-id uit de
//      query of body gaan lezen, dan kun je er willekeurige accounts mee testen
//      op stafflidmaatschap. Die test staat hier zodat dat niet ongemerkt kan
//      insluipen.
//   2. FAIL CLOSED. Geen token, kapotte lookup, onbekend antwoord: allemaal
//      `eligible:false`. Alles behalve een expliciete `true` is nee.
//   3. LOGGEN BLOKKEERT HIER NIET. Bewust anders dan het datavlak. Op
//      /api/support/schools geldt "geen logregel, geen data" — daar komen
//      klantgegevens terug. Hier komt alleen een boolean over je eigen account
//      terug, en zou een logstoring een legitieme supportmedewerker zonder
//      factor permanent uit zijn enrollment houden. Juist dan is het
//      herstelrunbook ook niet bruikbaar.
//
// Wat deze tests NIET bewijzen: dat een gebruiker geen factor kán aanmaken.
// `mfa.enroll()` is een GoTrue-aanroep die de browser rechtstreeks doet. Dit is
// preventie in het productontwerp, geen platformhandhaving. De echte grens
// staat in tests/support-auth.test.mjs.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

let currentClient;

// Zoals elke andere routetest hier: de echte rate-limiter houdt een setInterval
// open en laat de testrunner nooit afsluiten. We vervangen hem door een schakelaar,
// zodat we wél kunnen bewijzen dát de route hem respecteert.
let rateLimitStaatToe = true;
mock.module('@/lib/rate-limit', { namedExports: { rateLimit: () => rateLimitStaatToe } });

mock.module('@supabase/supabase-js', { namedExports: { createClient: () => currentClient } });
mock.module('next/server', {
  namedExports: {
    NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    NextRequest: class NextRequest {},
  },
});

const { GET } = await import('../app/api/support/eligibility/route.ts');

const STAFF = { id: 'staff-1', email: 'support@ribba.app' };
const LEERLING = { id: 'leerling-9', email: 'leerling@example.com' };

function makeClient({ user = STAFF, authError = null, isStaff = true, staffError = null, logError = null } = {}) {
  const logs = [];
  const rpcCalls = [];
  return {
    logs,
    rpcCalls,
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    rpc: async (naam, args) => {
      rpcCalls.push({ naam, args });
      return { data: isStaff, error: staffError };
    },
    from(table) {
      assert.equal(table, 'platform_access_log', 'de precheck schrijft nergens anders');
      return {
        insert: async (row) => {
          if (logError) throw new Error(logError);
          logs.push(row);
          return { error: null };
        },
      };
    },
  };
}

/** Elke test zijn eigen IP: de rate limiter houdt state per proces. */
let ipTeller = 0;
function req(authorization, { url = 'https://mijn.ribba.app/api/support/eligibility', ip } = {}) {
  const adres = ip ?? `198.51.100.${++ipTeller}`;
  return {
    url,
    headers: {
      get: (k) => ({
        authorization,
        'x-forwarded-for': `${adres}, 10.0.0.1`,
        'user-agent': 'test-agent',
      }[k] ?? null),
    },
  };
}

// ── 1. Fail closed ─────────────────────────────────────────────────────

test('geen token → 401 en niet eligible', async () => {
  currentClient = makeClient();
  const res = await GET(req(null));
  assert.equal(res.status, 401);
  assert.equal(res.body.eligible, false);
  assert.equal(currentClient.rpcCalls.length, 0, 'zonder token hoeft er niets opgezocht te worden');
});

test('ongeldige sessie → 401 en niet eligible', async () => {
  currentClient = makeClient({ user: null, authError: { message: 'bad jwt' } });
  const res = await GET(req('Bearer rommel'));
  assert.equal(res.status, 401);
  assert.equal(res.body.eligible, false);
});

test('kapotte staff-lookup → 500 en niet eligible, geen "ja" bij twijfel', async () => {
  currentClient = makeClient({ isStaff: null, staffError: { message: 'timeout' } });
  const res = await GET(req('Bearer geldig.token.hier'));
  assert.equal(res.status, 500);
  assert.equal(res.body.eligible, false);
});

test('rpc geeft iets anders dan true → niet eligible', async () => {
  currentClient = makeClient({ user: LEERLING, isStaff: null });
  const res = await GET(req('Bearer geldig.token.hier'));
  assert.equal(res.body.eligible, false, 'alleen een expliciete true telt');
});

// ── 2. De beslissing zelf ──────────────────────────────────────────────

test('gewoon Ribba-account (aal1, geen staff) → eligible:false', async () => {
  currentClient = makeClient({ user: LEERLING, isStaff: false });
  const res = await GET(req('Bearer geldig.token.hier'));

  assert.equal(res.status, 200);
  assert.equal(res.body.eligible, false);
  assert.deepEqual(Object.keys(res.body), ['eligible'], 'niets anders dan de boolean');
});

test('actieve supportmedewerker (aal1) → eligible:true', async () => {
  currentClient = makeClient({ isStaff: true });
  const res = await GET(req('Bearer geldig.token.hier'));

  assert.equal(res.status, 200);
  assert.equal(res.body.eligible, true);
  const rpc = currentClient.rpcCalls.find((c) => c.naam === 'is_platform_staff');
  assert.ok(rpc, 'de bestaande databasefunctie beslist, niet een tweede rollenmodel');
  assert.deepEqual(rpc.args, { p_user_id: 'staff-1' });
});

test('ingetrokken of inactieve staff → eligible:false', async () => {
  // is_platform_staff() filtert zelf op active en revoked_at; de route mag daar
  // geen eigen interpretatie overheen leggen.
  currentClient = makeClient({ isStaff: false });
  const res = await GET(req('Bearer geldig.token.hier'));
  assert.equal(res.body.eligible, false);
});

// ── 3. Geen oracle ─────────────────────────────────────────────────────

test('een vreemde user-id in de request verandert niets', async () => {
  currentClient = makeClient({ user: LEERLING, isStaff: false });

  const res = await GET(req('Bearer geldig.token.hier', {
    url: 'https://mijn.ribba.app/api/support/eligibility?user_id=staff-1&p_user_id=staff-1',
  }));

  assert.equal(res.body.eligible, false);
  const rpc = currentClient.rpcCalls.find((c) => c.naam === 'is_platform_staff');
  assert.deepEqual(rpc.args, { p_user_id: 'leerling-9' },
    'alleen de id uit het geverifieerde token, nooit iets uit de request');
});

test('rate limit bereikt → 429, en er wordt niets opgezocht', async () => {
  currentClient = makeClient({ user: LEERLING, isStaff: false });
  rateLimitStaatToe = false;
  try {
    const res = await GET(req('Bearer geldig.token.hier'));
    assert.equal(res.status, 429);
    assert.equal(res.body.eligible, false);
    assert.equal(currentClient.rpcCalls.length, 0);
  } finally {
    rateLimitStaatToe = true;
  }
});

// ── 4. Geen supportdata, en loggen blokkeert niet ──────────────────────

test('het antwoord bevat nooit supportdata', async () => {
  currentClient = makeClient({ isStaff: true });
  const res = await GET(req('Bearer geldig.token.hier'));

  const tekst = JSON.stringify(res.body);
  assert.ok(!tekst.includes('school'), 'geen scholen');
  assert.ok(!tekst.includes('staff-1'), 'zelfs het eigen user-id hoeft er niet in');
  assert.ok(!tekst.includes('support@ribba.app'), 'geen e-mailadres');
});

test('weigering wordt vastgelegd, maar een logfout blokkeert de check niet', async () => {
  currentClient = makeClient({ user: LEERLING, isStaff: false, logError: 'connection refused' });

  const res = await GET(req('Bearer geldig.token.hier'));

  assert.equal(res.status, 200, 'anders houdt een logstoring straks ook echte staff tegen');
  assert.equal(res.body.eligible, false);
});

test('een weigering komt in het toegangslogboek', async () => {
  currentClient = makeClient({ user: LEERLING, isStaff: false });
  await GET(req('Bearer geldig.token.hier'));

  assert.equal(currentClient.logs.length, 1);
  const [log] = currentClient.logs;
  assert.equal(log.staff_user_id, 'leerling-9');
  assert.equal(log.action, 'support.eligibility');
  assert.equal(log.level, 0);
  assert.equal(log.result, 'denied');
  assert.equal(log.meta.denied_reason, 'not_platform_staff');
});

test('een toegestane check vervuilt het toegangslogboek niet', async () => {
  currentClient = makeClient({ isStaff: true });
  await GET(req('Bearer geldig.token.hier'));

  assert.equal(currentClient.logs.length, 0,
    'het logboek verantwoordt inzage in klantgegevens; elke paginalading erin maakt het onbruikbaar');
});
