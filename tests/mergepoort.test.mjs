// De mergepoort van ribba-web.
//
// Tot 25 aug 2026 draaide er in deze repo niets automatisch en was `main`
// helemaal niet beschermd — de GitHub-API antwoordde letterlijk "Branch not
// protected". De 268 tests bewaakten dus niets, terwijl een merge hier meteen
// een deploy naar productie is.
//
// Het bewijs kwam dezelfde dag: PR #77 landde met een gebroken testsuite. De
// tests waren gedraaid vóór `npm install` een pakket verwijderde, daarna niet
// meer, en niets ving dat op.
//
// Waar het misgaat als deze tests omvallen:
//
//   • een lege uitslag die als groen telt → mergen terwijl er nog niets draait;
//   • een job die buiten de gate valt → hij mag rood zijn terwijl de poort
//     groen wordt;
//   • Vercel of CodeRabbit die in de verkeerde lijst belandt → ofwel een
//     brekende build glipt erdoor, ofwel elke dependabot-PR zet zich vast op
//     een check die daar nooit verschijnt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  beoordeel,
  jobIdsUitWorkflow,
  jobnamenUitWorkflow,
  needsVan,
  verwachteChecks,
  EXTERNE_CHECKS,
  POORT_JOB_ID,
} from '../scripts/wacht-op-checks.mjs';

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const check = (name, bucket) => ({ name, bucket, state: bucket.toUpperCase() });

// ── de lat komt uit ci.yml ───────────────────────────────────────────────────

test('de vier kwaliteitschecks staan in de workflow', () => {
  const namen = jobnamenUitWorkflow(ci);
  for (const n of ['Tests', 'Typecheck', 'Build', 'CI Gate']) {
    assert.ok(namen.includes(n), `job '${n}' ontbreekt in ci.yml`);
  }
});

test('een nieuwe job verhoogt de lat vanzelf', () => {
  const metNieuwe = ci + '\n  verzonnen:\n    name: Verzonnen Job\n    runs-on: ubuntu-latest\n';
  assert.ok(verwachteChecks(metNieuwe).includes('Verzonnen Job'));
  assert.ok(!verwachteChecks(ci).includes('Verzonnen Job'));
});

// ── de poort ─────────────────────────────────────────────────────────────────

test('CI Gate hangt aan élke gewone job', () => {
  const gewoon = jobIdsUitWorkflow(ci).filter((id) => id !== POORT_JOB_ID);
  const needs = needsVan(ci, POORT_JOB_ID);
  for (const job of gewoon) {
    assert.ok(needs.includes(job), `job '${job}' staat niet in ${POORT_JOB_ID}.needs`);
  }
  assert.ok(!needs.includes(POORT_JOB_ID), 'de poort telt zichzelf niet mee');
});

test('de poort verwijst niet naar onbekende jobs', () => {
  const gewoon = jobIdsUitWorkflow(ci).filter((id) => id !== POORT_JOB_ID);
  for (const n of needsVan(ci, POORT_JOB_ID)) assert.ok(gewoon.includes(n), `onbekende job '${n}'`);
});

test('de poort rapporteert ook als een job faalt', () => {
  // Zonder `if: always()` wordt de gate zelf overgeslagen zodra een job faalt.
  // Een overgeslagen required check rapporteert niets, en dan blijft de PR
  // hangen op "waiting for status" in plaats van eerlijk rood te worden.
  assert.ok(ci.split(`  ${POORT_JOB_ID}:`)[1].includes('if: always()'));
});

test('de poort eist success, niet "niet-gefaald"', () => {
  assert.ok(ci.split(`  ${POORT_JOB_ID}:`)[1].includes('!= "success"'));
});

// ── externe checks: de juiste in de juiste lijst ─────────────────────────────

test('Vercel telt mee als poortcheck', () => {
  // Een gefaalde preview-build betekent dat de productiedeploy zou breken, en
  // in deze repo ÍS een merge de deploy. Geverifieerd op elf PR's: Vercel
  // verschijnt overal, ook op dependabot-PR's.
  assert.ok(EXTERNE_CHECKS.includes('Vercel'));
  assert.ok(verwachteChecks(ci).includes('Vercel'));
});

test('CodeRabbit telt NIET mee', () => {
  // Verschijnt niet op dependabot-PR's. Wachten op een check die daar nooit
  // komt zou elke afhankelijkheidsupdate voorgoed vastzetten.
  assert.ok(!EXTERNE_CHECKS.includes('CodeRabbit'));
  assert.ok(!verwachteChecks(ci).includes('CodeRabbit'));
});

test('Vercel Preview Comments telt NIET mee', () => {
  assert.ok(!verwachteChecks(ci).some((n) => n.includes('Preview Comments')));
});

// ── leeg is niet groen ───────────────────────────────────────────────────────

test('nul checks betekent wachten, niet mergen', () => {
  const o = beoordeel(['A', 'B'], []);
  assert.equal(o.klaar, false);
  assert.deepEqual(o.ontbreekt, ['A', 'B']);
});

test('de helft verschenen en groen is nog steeds wachten', () => {
  assert.equal(beoordeel(['A', 'B'], [check('A', 'pass')]).klaar, false);
});

test('alles verschenen en groen is pas groen', () => {
  const o = beoordeel(['A', 'B'], [check('A', 'pass'), check('B', 'pass')]);
  assert.deepEqual([o.klaar, o.groen], [true, true]);
});

test('gefaald sluit de poort meteen, ook als er nog iets loopt', () => {
  const o = beoordeel(['A', 'B'], [check('A', 'fail'), check('B', 'pending')]);
  assert.deepEqual([o.klaar, o.groen], [true, false]);
});

test('overgeslagen blokkeert niet', () => {
  const o = beoordeel(['A', 'B'], [check('A', 'skipping'), check('B', 'pass')]);
  assert.deepEqual([o.klaar, o.groen], [true, true]);
});

// ── de twee soorten checks ───────────────────────────────────────────────────
//
// GitHub kent er twee: check-runs (GitHub Actions) en commit statuses (externe
// integraties zoals Vercel). Ze hebben verschillende velden en verschillende
// woorden voor hetzelfde. Dit is de vertaling naar één vorm.
//
// De aanleiding: op 25 aug 2026 keek dit script naar de PR in plaats van naar de
// commit, en oordeelde daardoor op de uitslag van een commit die al vervangen
// was — "POORT DICHT" terwijl de nieuwe run net was gestart.

import { bucketVanCheckRun, bucketVanStatus } from '../scripts/wacht-op-checks.mjs';

test('een lopende check-run is bezig, wat de conclusie ook zegt', () => {
  assert.equal(bucketVanCheckRun({ status: 'in_progress', conclusion: null }), 'pending');
  assert.equal(bucketVanCheckRun({ status: 'queued', conclusion: null }), 'pending');
});

test('een afgeronde check-run vertaalt naar de juiste emmer', () => {
  const v = (conclusion) => bucketVanCheckRun({ status: 'completed', conclusion });
  assert.equal(v('success'), 'pass');
  assert.equal(v('skipped'), 'skipping');
  assert.equal(v('neutral'), 'skipping');
  assert.equal(v('cancelled'), 'cancel');
  assert.equal(v('failure'), 'fail');
  assert.equal(v('timed_out'), 'fail');
});

test('action_required telt als bezig, niet stilzwijgend als geslaagd', () => {
  // Zo'n check wacht op een mens. Hem als groen tellen zou de poort openzetten
  // op iets wat niemand heeft bekeken; de timeout noemt hem straks bij naam.
  assert.equal(bucketVanCheckRun({ status: 'completed', conclusion: 'action_required' }), 'pending');
});

test('een onbekende conclusie is fail, niet pass', () => {
  // Bij twijfel dicht. Een nieuwe conclusiewaarde van GitHub mag geen gat maken.
  assert.equal(bucketVanCheckRun({ status: 'completed', conclusion: 'iets_nieuws' }), 'fail');
});

test('commit statuses vertalen net zo', () => {
  assert.equal(bucketVanStatus('success'), 'pass');
  assert.equal(bucketVanStatus('pending'), 'pending');
  assert.equal(bucketVanStatus('failure'), 'fail');
  assert.equal(bucketVanStatus('error'), 'fail');
});
