// De duur van de gratis periode — één grammatica, kalendermatig gerekend.
//
// Besluit 11 aug 2026: "1 maand gratis" is een KALENDERMAAND, geen 30 dagen.
// Dat is geen cosmetiek — het is wat we tegen de klant zeggen, en het is de
// reden dat we `trial_end` gebruiken in plaats van `trial_period_days`.
//
// De parser is bewust streng. Een typefout in Stripe-metadata mag geen
// stilzwijgend ander aanbod opleveren; hij hoort een geweigerd aanbod te zijn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrialInterval, trialEinde, trialTekst } from '../lib/trial-interval.ts';

test('leest beide schrijfwijzen: Stripe-metadata én Postgres-interval', () => {
  // Zo staat het in de Price-metadata.
  assert.deepEqual(parseTrialInterval('1 month'), { eenheid: 'month', aantal: 1 });
  assert.deepEqual(parseTrialInterval('3 months'), { eenheid: 'month', aantal: 3 });
  // Zo komt een Postgres `interval` eruit — dát is wat promo_codes levert.
  assert.deepEqual(parseTrialInterval('6 mons'), { eenheid: 'month', aantal: 6 });
  assert.deepEqual(parseTrialInterval('1 mon'), { eenheid: 'month', aantal: 1 });
  // Dagen kunnen ook, al gebruiken we ze nu niet.
  assert.deepEqual(parseTrialInterval('14 days'), { eenheid: 'day', aantal: 14 });
  assert.deepEqual(parseTrialInterval('1 day'), { eenheid: 'day', aantal: 1 });
});

test('tolerant op vorm, streng op inhoud', () => {
  assert.deepEqual(parseTrialInterval('  1 MONTH '), { eenheid: 'month', aantal: 1 });
  assert.deepEqual(parseTrialInterval('6mons'), { eenheid: 'month', aantal: 6 });
});

test('alles wat geen geldige duur is, wordt geweigerd', () => {
  for (const raar of [
    '', '   ', '30', 'zes maanden', '0 months', '-1 month', '1.5 months',
    '1 week', '1 year', 'month', 'null', 'NaN', '1 month extra',
    null, undefined, 123, {}, [],
  ]) {
    assert.equal(parseTrialInterval(raar), null, `onterecht geaccepteerd: ${JSON.stringify(raar)}`);
  }
});

test('een maand is dezelfde datum in de volgende maand', () => {
  const eind = trialEinde(new Date('2026-08-11T00:33:00.000Z'), { eenheid: 'month', aantal: 1 });
  assert.equal(eind.toISOString(), '2026-09-11T00:33:00.000Z');
});

test('STARTGRATIS: zes maanden landt op dezelfde kalenderdag', () => {
  const eind = trialEinde(new Date('2026-08-11T09:00:00.000Z'), { eenheid: 'month', aantal: 6 });
  assert.equal(eind.toISOString(), '2027-02-11T09:00:00.000Z');
});

test('een kortere doelmaand klemt op de laatste dag, hij loopt niet over', () => {
  // 31 januari + 1 maand is 28 februari — niet 3 maart, wat JavaScript
  // standaard doet met setMonth().
  assert.equal(
    trialEinde(new Date('2026-01-31T12:00:00.000Z'), { eenheid: 'month', aantal: 1 }).toISOString(),
    '2026-02-28T12:00:00.000Z',
  );
  // En in een schrikkeljaar de 29e.
  assert.equal(
    trialEinde(new Date('2028-01-31T12:00:00.000Z'), { eenheid: 'month', aantal: 1 }).toISOString(),
    '2028-02-29T12:00:00.000Z',
  );
  // 31 augustus + 6 maanden = 28 februari.
  assert.equal(
    trialEinde(new Date('2026-08-31T12:00:00.000Z'), { eenheid: 'month', aantal: 6 }).toISOString(),
    '2027-02-28T12:00:00.000Z',
  );
});

test('jaargrens', () => {
  assert.equal(
    trialEinde(new Date('2026-11-15T08:00:00.000Z'), { eenheid: 'month', aantal: 3 }).toISOString(),
    '2027-02-15T08:00:00.000Z',
  );
  assert.equal(
    trialEinde(new Date('2026-12-01T00:00:00.000Z'), { eenheid: 'month', aantal: 12 }).toISOString(),
    '2027-12-01T00:00:00.000Z',
  );
});

test('dagen tellen wél gewoon door', () => {
  assert.equal(
    trialEinde(new Date('2026-08-11T00:00:00.000Z'), { eenheid: 'day', aantal: 14 }).toISOString(),
    '2026-08-25T00:00:00.000Z',
  );
});

test('de zin komt van de server, niet uit de browser', () => {
  assert.equal(trialTekst({ eenheid: 'month', aantal: 1 }), '1 maand gratis');
  assert.equal(trialTekst({ eenheid: 'month', aantal: 6 }), '6 maanden gratis');
  assert.equal(trialTekst({ eenheid: 'day', aantal: 1 }), '1 dag gratis');
  assert.equal(trialTekst({ eenheid: 'day', aantal: 14 }), '14 dagen gratis');
});
