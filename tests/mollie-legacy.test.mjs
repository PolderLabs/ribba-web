// De oude Mollie-abonnementsrail is weg — en de Mollie-productkoppeling niet.
//
// Er zijn twee totaal verschillende Mollies in Ribba, en ze delen alleen een
// naam:
//
//   1. Mollie als betaalrail waarmee Ribba zélf abonnementen incasseerde.
//      Dood sinds de Stripe-migratie. Gemeten 25 aug 2026: 0 van 14 licenties
//      met een `mollie_customer_id`, 0 van 81 facturen met een
//      `mollie_invoice_id`. Verwijderd.
//
//   2. Mollie als koppeling waarmee RIJSCHOLEN hun leerlingen laten betalen.
//      Springlevend, verkocht op /pro, en Mollie B.V. staat als subverwerker in
//      de verwerkersovereenkomst.
//
// Deze tests bewaken die grens. Wie ooit "de rest van Mollie" opruimt en te ver
// gaat, haalt een verkochte productfunctie weg en schendt een contractuele
// bijlage. Dat is precies één zoekopdracht te breed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const wortel = new URL('..', import.meta.url).pathname;
const lees = (...p) => readFileSync(join(wortel, ...p), 'utf8');

function alleBronbestanden(map, uit = []) {
  for (const naam of readdirSync(join(wortel, map))) {
    const pad = join(map, naam);
    if (statSync(join(wortel, pad)).isDirectory()) alleBronbestanden(pad, uit);
    else if (/\.(ts|tsx|mjs)$/.test(naam)) uit.push(pad);
  }
  return uit;
}

// ── De rail is weg ───────────────────────────────────────────────────────────

test('geen enkel bestand importeert nog @mollie/api-client', () => {
  const overtreders = [...alleBronbestanden('app'), ...alleBronbestanden('lib')]
    .filter((p) => lees(p).includes('@mollie/api-client'));
  assert.deepEqual(overtreders, [], 'deze bestanden hangen nog aan het Mollie-pakket');
});

test('het pakket staat niet meer in package.json', () => {
  const pkg = JSON.parse(lees('package.json'));
  const alles = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.equal(alles['@mollie/api-client'], undefined);
});

test('de drie dode routes bestaan niet meer', () => {
  for (const pad of [
    'app/api/mollie-webhook/route.ts',
    'app/api/checkout/route.ts',
    'app/api/cron/reconcile-subscriptions/route.ts',
  ]) {
    assert.equal(existsSync(join(wortel, pad)), false, `${pad} hoort verwijderd te zijn`);
  }
});

test('de dode reconcile-cron is uit vercel.json, de levende crons staan er nog', () => {
  // Expliciet allebei: een te enthousiaste opruiming die ook trial-reminder of
  // referral-payouts meeneemt, zou stil dagelijks werk stilleggen.
  const paden = JSON.parse(lees('vercel.json')).crons.map((c) => c.path);
  assert.equal(paden.includes('/api/cron/reconcile-subscriptions'), false);
  assert.ok(paden.includes('/api/cron/trial-reminder'), 'trial-reminder moet blijven draaien');
  assert.ok(paden.includes('/api/cron/referral-payouts'), 'referral-payouts moet blijven draaien');
  assert.equal(paden.length, 2);
});

test('opzeggen is puur Stripe geworden', () => {
  const src = lees('app/api/cancel-subscription/route.ts');
  assert.equal(src.includes('@mollie/api-client'), false);
  assert.equal(src.includes('customerSubscriptions'), false, 'geen Mollie-opzegaanroep meer');
  assert.equal(src.includes('hasMollie'), false, 'geen providerkeuze meer');
  assert.ok(src.includes('stripe-cancel-subscription'), 'het Stripe-pad moet intact zijn');
});

// ── De productkoppeling is ongemoeid ─────────────────────────────────────────

test('/pro verkoopt Mollie nog steeds als koppeling voor leerlingbetalingen', () => {
  const pro = lees('app/pro/page.tsx');
  assert.ok(pro.includes('Alle koppelingen (CBR, Moneybird, Mollie)'), 'de plankaarten noemen Mollie');
  assert.ok(pro.includes('iDEAL-betalingen via Mollie'), 'de featurelijst noemt iDEAL via Mollie');
  assert.ok(pro.includes('Mollie iDEAL'), 'de badge staat er nog');
});

test('/upgrade noemt de koppeling ook nog', () => {
  assert.ok(lees('app/upgrade/page.tsx').includes('Alle koppelingen (CBR, Moneybird, Mollie)'));
});

test('Mollie B.V. staat nog als subverwerker in de verwerkersovereenkomst', () => {
  // Dit is een contractuele bijlage. Een subverwerker schrappen omdat een
  // opruiming te breed zocht, is een juridische wijziging zonder besluit.
  assert.ok(lees('app/verwerkersovereenkomst/page.tsx').includes('Mollie B.V.'));
});
