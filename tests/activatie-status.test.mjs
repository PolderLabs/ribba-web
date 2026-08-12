// De toestandsregel achter /upgrade/success.
//
// Aanleiding (11 aug 2026): de pagina claimde onvoorwaardelijk "Betaling
// geslaagd" en opende twee seconden later de app. Bij een betaalmethode die
// niet direct afrekent kwam de gebruiker daardoor in een afgesloten app
// terecht, dacht dat het mislukt was, en startte een tweede Checkout. Eén
// rijschool hield er twee actieve abonnementen aan over.
//
// Deze tests bewaken de twee eigenschappen die dat voorkomen: nooit "actief"
// zeggen zonder bevestiging, en in elke onzekere toestand geen weg aanbieden
// die tot een tweede betaling leidt.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bepaalActivatieState,
  magDoorsturen,
  DUURT_LANGER_NA_SECONDEN,
} from '../lib/activatie-status.ts';

const basis = {
  ingelogd: true,
  plan: null,
  isExpired: false,
  secondenVerstreken: 0,
};

describe('bepaalActivatieState', () => {
  test('start in "wordt verwerkt", niet in "actief"', () => {
    assert.equal(bepaalActivatieState(basis), 'wordt_verwerkt');
  });

  test('zegt pas "actief" als Ribba een lopend plan bevestigt', () => {
    assert.equal(
      bepaalActivatieState({ ...basis, plan: 'basic' }),
      'actief',
    );
  });

  test('een plan dat verlopen is telt niet als actief', () => {
    // `plan` kan gevuld zijn terwijl de toegang voorbij is; dan is de
    // activatie niet rond en mag er geen vinkje staan.
    assert.equal(
      bepaalActivatieState({ ...basis, plan: 'basic', isExpired: true }),
      'wordt_verwerkt',
    );
  });

  test('na de drempel verandert alleen de tekst, niet de conclusie', () => {
    const state = bepaalActivatieState({
      ...basis,
      secondenVerstreken: DUURT_LANGER_NA_SECONDEN,
    });
    assert.equal(state, 'duurt_langer');
    // "duurt langer" is nadrukkelijk geen mislukking.
    assert.notEqual(state, 'actief');
  });

  test('vlak vóór de drempel staat hij er nog niet', () => {
    assert.equal(
      bepaalActivatieState({ ...basis, secondenVerstreken: DUURT_LANGER_NA_SECONDEN - 1 }),
      'wordt_verwerkt',
    );
  });

  test('een bevestigd abonnement wint van de tijdteller', () => {
    // Ook na tien minuten: is het abonnement er, dan is het er.
    assert.equal(
      bepaalActivatieState({ ...basis, plan: 'premium', secondenVerstreken: 600 }),
      'actief',
    );
  });

  test('een bevestigd abonnement wint van een verdwenen sessie', () => {
    assert.equal(
      bepaalActivatieState({ ...basis, plan: 'basic', ingelogd: false }),
      'actief',
    );
  });

  test('zonder sessie: geen fout, maar opnieuw inloggen', () => {
    const state = bepaalActivatieState({ ...basis, ingelogd: false });
    assert.equal(state, 'geen_sessie');
  });

  test('geen plan betekent nooit "betaling mislukt"', () => {
    // Er bestaat in deze slice bewust geen foutstaat: afwezigheid van een
    // abonnement is bij een asynchrone betaling gewoon "nog niet".
    for (const seconden of [0, 30, 90, 600]) {
      const state = bepaalActivatieState({ ...basis, secondenVerstreken: seconden });
      assert.ok(
        state === 'wordt_verwerkt' || state === 'duurt_langer',
        `bij ${seconden}s werd het onverwacht ${state}`,
      );
    }
  });

  test('de drempel is instelbaar zonder de regel te veranderen', () => {
    assert.equal(
      bepaalActivatieState({ ...basis, secondenVerstreken: 5, drempelSeconden: 5 }),
      'duurt_langer',
    );
  });
});

describe('magDoorsturen', () => {
  test('alleen een bevestigd abonnement krijgt een weg terug', () => {
    assert.equal(magDoorsturen('actief'), true);
  });

  test('geen enkele onzekere toestand biedt een uitweg aan', () => {
    // Dit is de kern: elke knop in deze toestanden leidt naar een afgesloten
    // app of naar een tweede Checkout.
    for (const state of ['wordt_verwerkt', 'duurt_langer', 'geen_sessie']) {
      assert.equal(magDoorsturen(state), false, `${state} bood wél een uitweg`);
    }
  });
});

describe('de pagina zelf', () => {
  const ruweBron = () =>
    readFileSync(new URL('../app/upgrade/success/page.tsx', import.meta.url), 'utf8');

  // Zonder commentaar, want daar staat juist de uitleg over de oude fout —
  // inclusief de zin die hieronder verboden is. De assertie moet gaan over wat
  // de gebruiker ziet, niet over wat de code over zichzelf vertelt.
  const bron = () =>
    ruweBron()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '');

  test('claimt nergens onvoorwaardelijk dat de betaling geslaagd is', () => {
    assert.ok(!bron().includes('Betaling geslaagd'));
  });

  test('opent de app niet meer automatisch', () => {
    const s = bron();
    assert.ok(!s.includes('setTimeout(() =>'), 'er staat weer een automatische sprong in');
    assert.ok(!s.includes('window.location.href'), 'de pagina navigeert zelf');
  });

  test('verwijst nergens terug naar de planpagina', () => {
    // Een link naar /upgrade vanaf deze pagina is de directe route naar een
    // tweede abonnement.
    assert.ok(!bron().includes('href="/upgrade"'));
  });

  test('haalt de status uit /api/current-plan en niet uit de URL', () => {
    const s = bron();
    assert.ok(s.includes('/api/current-plan'));
    assert.ok(!s.includes('searchParams.get(\'plan\')'));
  });
});
