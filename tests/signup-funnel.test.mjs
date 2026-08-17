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
  wachtwoordBijInschrijven,
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

// ── Het wachtwoord ──────────────────────────────────────────────────────────
//
// Spiegelbeeld van de actiecode, en net zo hard: de oude route maakt het
// account meteen aan en WEIGERT een inschrijving zonder wachtwoord. Zouden de
// velden verdwijnen terwijl die route nog draait, dan is inschrijven
// onmogelijk — een stillere maar ergere storing dan een verborgen actiecode.

test('het wachtwoord wordt gevraagd dan en slechts dan als de oude route actief is', () => {
  assert.equal(wachtwoordBijInschrijven, ACTIEVE_SIGNUP_ROUTE === OUDE_SIGNUP_ROUTE);
});

test('wachtwoord en actiecode sluiten elkaar uit — er is er altijd precies één', () => {
  // Ze horen bij verschillende routes, dus nooit allebei aan of allebei uit.
  assert.notEqual(wachtwoordBijInschrijven, promoBeschikbaar);
});

test('op de nieuwe route kan het wachtwoordveld nooit terugkomen', () => {
  if (ACTIEVE_SIGNUP_ROUTE === NIEUWE_SIGNUP_ROUTE) {
    assert.equal(wachtwoordBijInschrijven, false);
  }
});

// ── De belofte van de knop volgt de route ───────────────────────────────────

test('de verzendknop belooft wat er echt gebeurt', async () => {
  const { ACTIEVE_SIGNUP_ROUTE, OUDE_SIGNUP_ROUTE, verzendknopLabel, registratieIntro } =
    await import('../lib/signup-funnel.ts');

  if (ACTIEVE_SIGNUP_ROUTE === OUDE_SIGNUP_ROUTE) {
    // Oude route: het account ontstaat meteen, dus dat mag de knop zeggen.
    assert.equal(verzendknopLabel, 'Account aanmaken');
    assert.match(registratieIntro, /begin direct/);
  } else {
    // Nieuwe route: er ontstaat hier géén account. Zou de knop dat toch
    // beloven, dan klopt hij pas twee stappen later.
    assert.notEqual(verzendknopLabel, 'Account aanmaken');
    assert.doesNotMatch(registratieIntro, /begin direct/);
  }
});

test('een Stripe-storing blokkeert de OUDE route nooit', async () => {
  const { ACTIEVE_SIGNUP_ROUTE, OUDE_SIGNUP_ROUTE, aanbodVereistVoorInschrijven } =
    await import('../lib/signup-funnel.ts');

  // De oude route maakt zelf een school aan en raakt Stripe niet aan. Zou een
  // mislukt aanbod daar de knop uitschakelen, dan blokkeren we inschrijvingen
  // die het gewoon zouden hebben gered.
  assert.equal(
    aanbodVereistVoorInschrijven,
    ACTIEVE_SIGNUP_ROUTE !== OUDE_SIGNUP_ROUTE,
  );
});
