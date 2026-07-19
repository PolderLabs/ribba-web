// Landprofielen: per-land validatie voor het registratieformulier en
// /api/register-school. Bindend (Önder, 19 jul 2026): het land is een echt
// domeinveld; een niet-ondersteund land wordt geweigerd, nooit stil
// opgeslagen of teruggevallen op NL.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  COUNTRY_PROFILES,
  ENABLED_COUNTRY_CODES,
  LEGAL_FORMS,
  getCountryProfile,
  isEnabledCountry,
  isLegalForm,
  isValidBusinessRegisterFor,
  isValidPhoneFor,
  isValidPostcodeFor,
  isValidVatFor,
  normalizeBusinessRegister,
  normalizePostcode,
  normalizeVat,
  requiresLegalName,
} = await import('../lib/country-profile.ts');

const NL = COUNTRY_PROFILES.NL;
const BE = COUNTRY_PROFILES.BE;

test('alleen NL is enabled; BE bestaat als profiel maar registreert niet', () => {
  assert.deepEqual([...ENABLED_COUNTRY_CODES], ['NL']);
  assert.equal(isEnabledCountry('NL'), true);
  assert.equal(isEnabledCountry('BE'), false);
  assert.ok(BE, 'BE-profiel moet klaarstaan voor latere activering');
  assert.equal(getCountryProfile('NL')?.code, 'NL');
  // getCountryProfile geeft uitsluitend enabled landen terug
  assert.equal(getCountryProfile('BE'), null);
  assert.equal(getCountryProfile('DE'), null);
  assert.equal(getCountryProfile(null), null);
  assert.equal(getCountryProfile(undefined), null);
  assert.equal(getCountryProfile('nl'), null, 'landcode is hoofdlettergevoelig (ISO-2)');
});

test('bedrijfsvormen: exact eenmanszaak/vof/bv; alleen bv eist statutaire naam', () => {
  assert.deepEqual(LEGAL_FORMS.map((f) => f.value), ['eenmanszaak', 'vof', 'bv']);
  assert.equal(isLegalForm('eenmanszaak'), true);
  assert.equal(isLegalForm('vof'), true);
  assert.equal(isLegalForm('bv'), true);
  assert.equal(isLegalForm('BV'), false);
  assert.equal(isLegalForm(''), false);
  assert.equal(isLegalForm(null), false);
  assert.equal(requiresLegalName('bv'), true);
  assert.equal(requiresLegalName('eenmanszaak'), false);
  assert.equal(requiresLegalName('vof'), false);
});

test('NL-postcode: 4 cijfers + 2 letters, spatie en kleine letters genormaliseerd', () => {
  assert.equal(isValidPostcodeFor(NL, '1234AB'), true);
  assert.equal(isValidPostcodeFor(NL, '1234 AB'), true);
  assert.equal(isValidPostcodeFor(NL, '3037 eg'), true);
  assert.equal(isValidPostcodeFor(NL, '123AB'), false);
  assert.equal(isValidPostcodeFor(NL, '12345'), false);
  assert.equal(isValidPostcodeFor(NL, ''), false);
  // Normalisatie lost de bestaande inconsistentie in prod-data op
  assert.equal(normalizePostcode('3037 eg'), '3037EG');
  assert.equal(normalizePostcode(' 2992EE '), '2992EE');
});

test('NL-handelsregister (KvK): 8 cijfers, scheidingstekens genormaliseerd', () => {
  assert.equal(isValidBusinessRegisterFor(NL, '24389012'), true);
  assert.equal(isValidBusinessRegisterFor(NL, '2438901'), false);
  assert.equal(isValidBusinessRegisterFor(NL, '243890123'), false);
  assert.equal(normalizeBusinessRegister('24.38.90.12'), '24389012');
});

test('NL-btw: NL + 9 cijfers + B + 2 cijfers', () => {
  assert.equal(isValidVatFor(NL, 'NL004154279B18'), true);
  assert.equal(isValidVatFor(NL, 'nl 0041.54279.b18'), true, 'normalisatie vóór match');
  assert.equal(isValidVatFor(NL, 'NL12345B01'), false);
  assert.equal(isValidVatFor(NL, 'BE0123456789'), false, 'BE-nummer hoort niet bij NL-profiel');
  assert.equal(normalizeVat('nl 0041.54279.b18'), 'NL004154279B18');
});

test('NL-telefoon: 06/+316/00316-mobiel, onzichtbare tekens opgeschoond', () => {
  assert.equal(isValidPhoneFor(NL, '0612345678'), true);
  assert.equal(isValidPhoneFor(NL, '+31612345678'), true);
  assert.equal(isValidPhoneFor(NL, '06 12 34 56 78'), true);
  assert.equal(isValidPhoneFor(NL, '0101234567'), false, 'vaste lijn — zelfde semantiek als voorheen');
  assert.equal(isValidPhoneFor(NL, '0470123456'), false, 'BE-mobiel hoort niet bij NL-profiel');
});

test('BE-profiel staat klaar: postcode, KBO, btw en telefoon', () => {
  assert.equal(isValidPostcodeFor(BE, '1000'), true);
  assert.equal(isValidPostcodeFor(BE, '0999'), false, 'BE-postcodes beginnen niet met 0');
  assert.equal(isValidPostcodeFor(BE, '1234AB'), false);
  assert.equal(isValidBusinessRegisterFor(BE, '0123456789'), true);
  assert.equal(isValidBusinessRegisterFor(BE, '0123.456.789'), true, 'KBO-notatie met punten');
  assert.equal(isValidBusinessRegisterFor(BE, '9123456789'), false, 'KBO begint met 0 of 1');
  assert.equal(isValidBusinessRegisterFor(BE, '24389012'), false, 'NL-KvK hoort niet bij BE-profiel');
  assert.equal(isValidVatFor(BE, 'BE0123456789'), true);
  assert.equal(isValidVatFor(BE, 'NL004154279B18'), false);
  assert.equal(isValidPhoneFor(BE, '0470123456'), true);
  assert.equal(isValidPhoneFor(BE, '+32470123456'), true);
  assert.equal(isValidPhoneFor(BE, '0612345678'), false, 'NL-mobiel hoort niet bij BE-profiel');
});
