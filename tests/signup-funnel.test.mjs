// De koppeling tussen de actieve inschrijfroute en de actiecode.
//
// Dit is de invariant die voorkomt dat we iets beloven wat we niet uitvoeren:
// een bezoeker mag geen promotie-aanbod te zien krijgen dat de route waar hij
// naartoe verzendt niet kan honoreren.
//
// De oude route kent `promo_code` niet. Zou het veld tóch zichtbaar zijn, dan
// kan iemand STARTGRATIS invullen, "6 maanden gratis" lezen, zich inschrijven
// en die zes maanden niet krijgen.
//
// Deze test bewaakt niet WELKE route actief is — dat is een besluit — maar dat
// de zichtbaarheid van de actiecode eraan vastzit en niet los kan gaan zweven.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OUDE_SIGNUP_ROUTE,
  NIEUWE_SIGNUP_ROUTE,
  ACTIEVE_SIGNUP_ROUTE,
  promoBeschikbaar,
} from '../lib/signup-funnel.ts';

test('de actieve route is er één van de twee, niet iets anders', () => {
  assert.ok(
    ACTIEVE_SIGNUP_ROUTE === OUDE_SIGNUP_ROUTE || ACTIEVE_SIGNUP_ROUTE === NIEUWE_SIGNUP_ROUTE,
    `onbekende route: ${ACTIEVE_SIGNUP_ROUTE}`,
  );
});

test('de actiecode is beschikbaar dan en slechts dan als de nieuwe route actief is', () => {
  assert.equal(promoBeschikbaar, ACTIEVE_SIGNUP_ROUTE === NIEUWE_SIGNUP_ROUTE);
});

test('op de oude route kan de actiecode nooit aan staan', () => {
  // Het gevaarlijke geval expliciet: promo zichtbaar terwijl de route hem
  // niet kan honoreren. Als iemand `promoBeschikbaar` ooit hardcodeert op
  // true, valt deze test om zolang de oude route actief is.
  if (ACTIEVE_SIGNUP_ROUTE === OUDE_SIGNUP_ROUTE) {
    assert.equal(promoBeschikbaar, false);
  }
});

test('de twee routes zijn verschillend — anders is de schakelaar betekenisloos', () => {
  assert.notEqual(OUDE_SIGNUP_ROUTE, NIEUWE_SIGNUP_ROUTE);
});
