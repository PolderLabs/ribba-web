// referral-attribution — pint de attributieregels vast:
//
//   1. geldige code + actieve membership + actief programma → referral-insert
//      met bevroren reward_snapshot + billing-event + partnermail;
//   2. code van een ANDERE school wordt genegeerd (school-match verplicht);
//   3. self-referral (partner-e-mail == leerling-e-mail) wordt genegeerd;
//   4. duplicaat (student al geattribueerd; upsert raakt 0 rijen) → geen
//      mail/event — eerste attributie wint;
//   5. ongeldig codeformaat → geen enkele query;
//   6. fouten zijn best-effort: een DB-fout laat de functie nooit throwen
//      (de registratie mag hier nooit op falen).

import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

const SCHOOL_ID = 'school-1';

// Regelbaar per test
let membershipRow;
let programRow;
let partnerRow;
let rewardRows;
let upsertResult; // { data, error }
let queriedTables;
let upserts; // { table, payload, opts }
let loggedEvents;
let sentMails;

function defaults() {
  membershipRow = { id: 'mem-1', partner_id: 'partner-1', drivingschool_id: SCHOOL_ID, status: 'active' };
  programRow = { id: 'prog-1', status: 'active' };
  partnerRow = { id: 'partner-1', email: 'partner@voorbeeld.nl' };
  rewardRows = [
    { milestone: 'proefles', reward_kind: 'cash', amount_cents: 1000 },
    { milestone: 'eerste_betaalde_les', reward_kind: 'cash', amount_cents: 2500 },
  ];
  upsertResult = { data: [{ id: 'ref-1' }], error: null };
  queriedTables = [];
  upserts = [];
  loggedEvents = [];
  sentMails = [];
}

function chain(result) {
  const c = {
    eq: () => c,
    maybeSingle: async () => ({ data: result, error: null }),
    then: (resolve) => resolve({ data: result, error: null }),
  };
  return c;
}

function makeFakeSupabase() {
  return {
    from(table) {
      queriedTables.push(table);
      return {
        select: () => {
          switch (table) {
            case 'referral_partner_memberships': return chain(membershipRow);
            case 'referral_programs': return chain(programRow);
            case 'referral_partners': return chain(partnerRow);
            case 'referral_program_rewards': return chain(rewardRows);
            default: return chain(null);
          }
        },
        upsert(payload, opts) {
          upserts.push({ table, payload, opts });
          return { select: async () => upsertResult };
        },
      };
    },
  };
}

mock.module('@supabase/supabase-js', {
  namedExports: { createClient: () => makeFakeSupabase() },
});
mock.module('@/lib/billing-events', {
  namedExports: { logBillingEvent: async (evt) => { loggedEvents.push(evt); } },
});
mock.module('@/lib/referral-emails', {
  namedExports: {
    sendPartnerReferralRegisteredMail: async (params) => { sentMails.push(params); },
  },
});

const { recordReferralAttribution } = await import('@/lib/referral-attribution');

function input(overrides = {}) {
  return {
    refCode: 'ABCD1234',
    drivingschoolId: SCHOOL_ID,
    schoolName: 'Rijschool Test',
    studentId: 'student-1',
    firstName: 'Jan',
    email: 'jan@voorbeeld.nl',
    ...overrides,
  };
}

beforeEach(defaults);

test('geldige code → referral met bevroren reward_snapshot + event + partnermail', async () => {
  await recordReferralAttribution(input());

  assert.equal(upserts.length, 1);
  const { payload, opts } = upserts[0];
  assert.equal(payload.membership_id, 'mem-1');
  assert.equal(payload.partner_id, 'partner-1');
  assert.equal(payload.student_id, 'student-1');
  assert.equal(payload.referred_email, 'jan@voorbeeld.nl');
  assert.deepEqual(payload.reward_snapshot, rewardRows);
  // Eerste attributie wint: conflict op student_id wordt genegeerd.
  assert.equal(opts.onConflict, 'student_id');
  assert.equal(opts.ignoreDuplicates, true);

  assert.equal(loggedEvents.length, 1);
  assert.equal(loggedEvents[0].event_type, 'referral_attributed');
  assert.equal(sentMails.length, 1);
  assert.equal(sentMails[0].partnerEmail, 'partner@voorbeeld.nl');
});

test('lowercase code wordt genormaliseerd naar uppercase', async () => {
  await recordReferralAttribution(input({ refCode: 'abcd1234' }));
  assert.equal(upserts.length, 1);
});

test('code van een andere school wordt genegeerd', async () => {
  membershipRow = { ...membershipRow, drivingschool_id: 'andere-school' };
  await recordReferralAttribution(input());
  assert.equal(upserts.length, 0);
  assert.equal(sentMails.length, 0);
});

test('gepauzeerd programma → geen attributie', async () => {
  programRow = null; // .eq('status','active') vindt niets
  await recordReferralAttribution(input());
  assert.equal(upserts.length, 0);
});

test('uitgeschakelde membership → geen attributie', async () => {
  membershipRow = null; // .eq('status','active') vindt niets
  await recordReferralAttribution(input());
  assert.equal(upserts.length, 0);
});

test('self-referral wordt genegeerd (case-insensitive)', async () => {
  partnerRow = { id: 'partner-1', email: 'Jan@Voorbeeld.nl' };
  await recordReferralAttribution(input({ email: 'jan@voorbeeld.nl' }));
  assert.equal(upserts.length, 0);
  assert.equal(sentMails.length, 0);
});

test('duplicaat: upsert raakt 0 rijen → geen event, geen mail', async () => {
  upsertResult = { data: [], error: null };
  await recordReferralAttribution(input());
  assert.equal(upserts.length, 1);
  assert.equal(loggedEvents.length, 0);
  assert.equal(sentMails.length, 0);
});

test('ongeldig codeformaat → geen enkele query', async () => {
  await recordReferralAttribution(input({ refCode: 'x' }));
  await recordReferralAttribution(input({ refCode: 'héllo-wereld!!' }));
  await recordReferralAttribution(input({ refCode: 42 }));
  await recordReferralAttribution(input({ refCode: null }));
  assert.equal(queriedTables.length, 0);
});

test('DB-fout op de upsert throwt niet (best-effort)', async () => {
  upsertResult = { data: null, error: { message: 'kapot (gesimuleerd)' } };
  await assert.doesNotReject(() => recordReferralAttribution(input()));
  assert.equal(loggedEvents.length, 0);
  assert.equal(sentMails.length, 0);
});
