// Fase 3B.2 — plankeuze bij inschrijving.
//
// Twee dingen worden hier bewaakt.
//
// 1. DE SERVERGRENS. Het formulier is UX; de route beslist. Alleen exact
//    `basic` of `premium` telt, en een ontbrekende of afwijkende waarde is een
//    400 — nooit een stille default, want dan krijgt een rijschool een
//    abonnement waar hij niet op geklikt heeft.
//
// 2. EEN AFWEZIGHEIDSREGEL. De signupflow mag de Basic-gebruikslimieten niet
//    raadplegen. Niet omdat het nu toevallig altijd goed uitpakt — een nieuwe
//    school heeft nul leerlingen en één instructeur — maar omdat inschrijven
//    en gebruikslimieten twee verschillende verantwoordelijkheden zijn. Zonder
//    deze test glijdt die logica er ooit "voor de zekerheid" in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isSignupPlan, SIGNUP_PLANS } from '../lib/signup-plan.ts';

test('SIGNUP_PLANS bevat precies de twee productplannen', () => {
  assert.deepEqual([...SIGNUP_PLANS], ['basic', 'premium']);
});

test('de servergrens accepteert uitsluitend basic en premium', () => {
  assert.equal(isSignupPlan('basic'), true);
  assert.equal(isSignupPlan('premium'), true);
});

test('elke andere waarde wordt geweigerd — geen normalisatie, geen gok', () => {
  for (const waarde of [
    'Basic', 'PREMIUM', ' basic', 'basic ',     // casing en spaties: niet repareren
    'trial', 'gratis', 'gold', 'basic_plus',    // plausibel maar onbekend
    '', null, undefined, 0, 1, true, {}, [],    // vormfouten
    'basic;premium',                            // injectie-achtig
  ]) {
    assert.equal(isSignupPlan(waarde), false, `onterecht geaccepteerd: ${JSON.stringify(waarde)}`);
  }
});

test('de route dwingt de plankeuze af en kent geen default', () => {
  const route = readFileSync(new URL('../app/api/register-school/route.ts', import.meta.url), 'utf8');

  // De validatie staat er, en gebruikt de gedeelde grens.
  assert.match(route, /isSignupPlan\(plan\)/, 'route valideert het plan niet via isSignupPlan');
  assert.match(route, /Kies een abonnement/, 'route geeft geen begrijpelijke fout terug');

  // En er is nergens een terugval op een vast plan.
  assert.doesNotMatch(
    route,
    /plan\s*(\|\||\?\?)\s*['"](basic|premium)['"]/,
    'route valt terug op een default plan',
  );
});

test('AFWEZIGHEIDSREGEL: de signupflow raadpleegt geen gebruikslimieten', () => {
  // Inschrijven is geen gebruiksmoment. De Basic-limieten horen bij groei en
  // downgrade, niet bij deze keuze. Een nieuwe school heeft per definitie nul
  // leerlingen en één instructeur, dus zo'n check zou hier alleen ruis en een
  // verkeerde verantwoordelijkheid toevoegen.
  const bestanden = {
    'app/api/register-school/route.ts': readFileSync(
      new URL('../app/api/register-school/route.ts', import.meta.url), 'utf8'),
    'components/SchoolRegistrationForm.tsx': readFileSync(
      new URL('../components/SchoolRegistrationForm.tsx', import.meta.url), 'utf8'),
    'lib/signup-plan.ts': readFileSync(
      new URL('../lib/signup-plan.ts', import.meta.url), 'utf8'),
  };

  const verboden = [
    /basicBlockedReason/,
    /BASIC_MAX_STUDENTS/,
    /BASIC_MAX_INSTRUCTORS/,
    /activeStudents/,
    /activeInstructors/,
    /basicLimitError/,
  ];

  for (const [naam, inhoud] of Object.entries(bestanden)) {
    for (const patroon of verboden) {
      assert.doesNotMatch(inhoud, patroon, `${naam} raadpleegt een gebruikslimiet (${patroon})`);
    }
  }
});

test('de plankeuze verandert in deze fase niets aan wat er wordt aangemaakt', () => {
  const route = readFileSync(new URL('../app/api/register-school/route.ts', import.meta.url), 'utf8');

  // De school krijgt onveranderd een trial-licentie; het gekozen plan wordt
  // nergens doorgegeven aan de creatie. Zodra 3B.3/3B.5 dat wél doen, hoort
  // deze test bewust te worden aangepast — niet stilzwijgend te blijven staan.
  assert.match(route, /billing_plan: 'trial'/, 'de trial-licentie is gewijzigd buiten scope om');
  assert.doesNotMatch(
    route,
    /p_school[\s\S]{0,600}?\bplan\b\s*:/,
    'het gekozen plan wordt doorgegeven aan create_school_with_owner — buiten scope van 3B.2',
  );
});

test('het formulier dwingt een expliciete keuze af, zonder voorgeselecteerd plan', () => {
  const form = readFileSync(
    new URL('../components/SchoolRegistrationForm.tsx', import.meta.url), 'utf8');

  assert.match(form, /plan:\s*''/, 'er staat een voorgeselecteerd plan in de begintoestand');
  assert.match(form, /if \(!form\.plan\) e\.plan =/, 'het formulier valideert de keuze niet');
  assert.match(form, /name="plan"/, 'er is geen keuzeveld voor het abonnement');
});
