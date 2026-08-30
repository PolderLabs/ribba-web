// Welke tweede factor daagt /support uit?
//
// Het herstelmodel is een tweede, apart bewaarde TOTP-factor op hetzelfde
// persoonlijke staffaccount. Supabase levert geen recoverycodes en beveelt
// precies dit aan. Maar dat model staat of valt met één ding: de gebruiker moet
// die tweede factor kúnnen kiezen. Koos het portaal altijd de eerste — zoals
// vóór deze wijziging — dan is een reservefactor onbereikbaar zodra het eerste
// apparaat weg is, en dat is erger dan geen reservefactor: dan denk je gedekt
// te zijn.
//
// Wat hier wordt vastgelegd:
//
//   1. ONVERIFIED IS GEEN RESERVE. Een halverwege afgebroken enrollment mag
//      nooit als tweede weg naar binnen verschijnen.
//   2. ÉÉN FACTOR BLIJFT EENVOUDIG. Geen extra scherm waar niets te kiezen valt.
//   3. DE VOLGORDE LIGT VAST. Anders wisselen de labels bij een herlading en
//      kiest iemand "Reserve" terwijl hij zijn dagelijkse authenticator bedoelt.
//   4. GEEN ID'S NAAR HET SCHERM. Een factor-id zegt de gebruiker niets en
//      hoort niet op een inlogscherm.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { kiesFactorpad } = await import('../lib/support-factorkeuze.ts');

const totp = (id, extra = {}) => ({
  id,
  status: 'verified',
  factor_type: 'totp',
  created_at: '2026-08-01T10:00:00Z',
  ...extra,
});

// ── 1. Bruikbaarheid ───────────────────────────────────────────────────

test('geen factoren → de bestaande enrollmentflow', () => {
  assert.deepEqual(kiesFactorpad([]), { soort: 'instellen' });
  assert.deepEqual(kiesFactorpad(null), { soort: 'instellen' });
  assert.deepEqual(kiesFactorpad(undefined), { soort: 'instellen' });
});

test('een unverified factor telt niet als reserve', () => {
  const pad = kiesFactorpad([
    totp('a'),
    totp('b', { status: 'unverified' }),
  ]);
  assert.equal(pad.soort, 'invoeren', 'een halve enrollment mag geen keuzescherm opleveren');
  assert.equal(pad.factorId, 'a');
});

test('alleen unverified → er valt niets te kiezen, dus instellen', () => {
  const pad = kiesFactorpad([totp('a', { status: 'unverified' })]);
  assert.deepEqual(pad, { soort: 'instellen' });
});

test('een ander factortype telt niet mee', () => {
  // Phone-MFA staat uit en kost geld; komt hij er ooit, dan is dat een eigen
  // besluit en geen stille uitbreiding van deze keuze.
  const pad = kiesFactorpad([totp('a'), { ...totp('b'), factor_type: 'phone' }]);
  assert.equal(pad.soort, 'invoeren');
  assert.equal(pad.factorId, 'a');
});

// ── 2. Eén factor blijft eenvoudig ─────────────────────────────────────

test('precies één verified factor → direct uitdagen, geen extra scherm', () => {
  const pad = kiesFactorpad([totp('enige')]);
  assert.deepEqual(pad, { soort: 'invoeren', factorId: 'enige' });
});

// ── 3. Twee factoren → keuze, in vaste volgorde ────────────────────────

test('twee verified factoren → de gebruiker kiest', () => {
  const pad = kiesFactorpad([
    totp('nieuw', { created_at: '2026-08-30T10:00:00Z' }),
    totp('oud', { created_at: '2026-08-01T10:00:00Z' }),
  ]);
  assert.equal(pad.soort, 'kiezen');
  assert.equal(pad.opties.length, 2);
  assert.deepEqual(pad.opties.map((o) => o.id), ['oud', 'nieuw'],
    'oudste eerst, ongeacht de volgorde waarin ze binnenkomen');
  assert.equal(pad.opties[0].naam, 'Primaire authenticator');
  assert.equal(pad.opties[1].naam, 'Reserve-authenticator');
});

test('de volgorde is stabiel, ook zonder created_at', () => {
  const eerste = kiesFactorpad([totp('b', { created_at: null }), totp('a', { created_at: null })]);
  const tweede = kiesFactorpad([totp('a', { created_at: null }), totp('b', { created_at: null })]);
  assert.deepEqual(
    eerste.opties.map((o) => o.id),
    tweede.opties.map((o) => o.id),
    'dezelfde factoren moeten altijd dezelfde labels krijgen',
  );
});

test('drie factoren krijgen onderscheidbare namen', () => {
  const pad = kiesFactorpad([
    totp('1', { created_at: '2026-08-01T10:00:00Z' }),
    totp('2', { created_at: '2026-08-02T10:00:00Z' }),
    totp('3', { created_at: '2026-08-03T10:00:00Z' }),
  ]);
  const namen = pad.opties.map((o) => o.naam);
  assert.equal(new Set(namen).size, 3, 'twee keer dezelfde naam is onbruikbaar om uit te kiezen');
});

test('een eigen friendly_name wint van het positielabel', () => {
  const pad = kiesFactorpad([
    totp('a', { created_at: '2026-08-01T10:00:00Z', friendly_name: 'Telefoon' }),
    totp('b', { created_at: '2026-08-02T10:00:00Z', friendly_name: '  ' }),
  ]);
  assert.equal(pad.opties[0].naam, 'Telefoon');
  assert.equal(pad.opties[1].naam, 'Reserve-authenticator', 'witruimte is geen naam');
});

// ── 4. Geen technische metadata naar het scherm ────────────────────────

test('een optie draagt alleen een id en een naam, en de naam is geen id', () => {
  const pad = kiesFactorpad([
    totp('9f8e7d6c-1234-4321-abcd-000000000001', { created_at: '2026-08-01T10:00:00Z' }),
    totp('9f8e7d6c-1234-4321-abcd-000000000002', { created_at: '2026-08-02T10:00:00Z' }),
  ]);
  for (const optie of pad.opties) {
    assert.deepEqual(Object.keys(optie).sort(), ['id', 'naam']);
    assert.ok(!optie.naam.includes('9f8e7d6c'), 'het id mag niet in de zichtbare naam belanden');
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}/.test(optie.naam), 'geen uuid in de naam');
  }
});

// ── 5. De pagina mag niet terugvallen op de oude keuze ─────────────────
//
// De regel hierboven is niets waard als het portaal hem niet gebruikt. Deze
// twee bewaken de bedrading zelf: broninspectie, want de pagina is een React
// component en niet zinvol te draaien zonder browser en sessie.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pagina = readFileSync(
  join(import.meta.dirname, '..', 'app', 'support', 'page.tsx'),
  'utf8',
);

test('het portaal kiest niet meer hard de eerste factor', () => {
  assert.ok(!pagina.includes('totp[0]'),
    'totp[0] is terug — dan is een reservefactor weer onbereikbaar');
  assert.ok(pagina.includes('kiesFactorpad'),
    'de keuze hoort via de getoetste regel te lopen');
});

test('de eligibility-poort blijft vóór elke factorlogica staan', () => {
  // Anders bereikt een non-staffaccount listFactors() alsnog, en dat is precies
  // de grens die PR #81 heeft gelegd.
  const poort = pagina.indexOf('isSupportmedewerker(session.access_token)');
  const factoren = pagina.indexOf('mfa.listFactors()', poort);
  assert.ok(poort > -1, 'de eligibility-controle is verdwenen');
  assert.ok(factoren > poort, 'listFactors() staat vóór de eligibility-controle');
});
