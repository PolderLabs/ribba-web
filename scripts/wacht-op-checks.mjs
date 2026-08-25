#!/usr/bin/env node
// Wacht tot de CI-checks van een PR er écht zijn, en pas daarna tot ze klaar zijn.
//
// ── Waarom dit bestaat ──────────────────────────────────────────────────────
//
// Op 24 augustus 2026 is twee keer een PR gemerged terwijl de checks nog liepen,
// en op 25 augustus nog eens in deze repo. Elke keer met dezelfde lus:
//
//     until ! gh pr checks $n | grep -qE "pending"; do sleep 20; done
//
// Vlak na `gh pr create` bestaan er nul checks. "Geen pending" is dan wáár, dus
// de lus stopt onmiddellijk en de merge gaat door. De lus kon "nog niet
// verschenen" niet onderscheiden van "klaar" — en dat verschil is precies de
// poort.
//
// Beide keren ging het om documentatie en werden de checks achteraf groen. Het
// was dus geen productie-incident, wel een poort die openstond terwijl hij
// dicht hoorde te zijn. Regel 4 in CLAUDE.md zegt wat er moet gebeuren; dit
// script maakt het uitvoerbaar in plaats van iets dat je elke keer opnieuw met
// de hand goed moet doen.
//
// ── Wat het doet ────────────────────────────────────────────────────────────
//
//   1. leidt uit .github/workflows/ci.yml af wélke checks er hóren te komen;
//   2. wacht tot ze er allemaal zijn — ontbreekt er één, dan wachten we door;
//   3. wacht tot geen enkele meer bezig is;
//   4. exit 0 alleen als alles geslaagd is.
//
// Afgeleid en niet gehardcodeerd, zodat een nieuwe job in ci.yml de lat vanzelf
// verhoogt. Wie een job toevoegt hoeft dit script niet te kennen.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * De jobnamen uit een CI-workflow.
 *
 * Een job-`name:` staat op vier spaties; een step-`name:` staat dieper of achter
 * een streepje. De workflow-`name:` zelf staat op nul en valt er ook buiten.
 */
export function jobnamenUitWorkflow(yamlTekst) {
  return yamlTekst
    .split('\n')
    .map((r) => /^ {4}name: (.+?)\s*$/.exec(r))
    .filter(Boolean)
    .map((m) => m[1]);
}

/**
 * De job-id's (de sleutels onder `jobs:`), niet de weergavenamen.
 *
 * Begint bewust pás bij de regel `jobs:`. Het triggerblok bovenaan gebruikt
 * dezelfde inspringing — `on: push:` zou anders als job worden geteld.
 */
export function jobIdsUitWorkflow(yamlTekst) {
  const regels = yamlTekst.split('\n');
  const start = regels.findIndex((r) => /^jobs:\s*$/.test(r));
  if (start === -1) return [];
  return regels
    .slice(start + 1)
    .map((r) => /^ {2}([a-z0-9][a-z0-9-]*):\s*$/.exec(r))
    .filter(Boolean)
    .map((m) => m[1]);
}

/**
 * De `needs`-lijst van één job.
 *
 * Bestaat voor de structurele test op de poort: elke gewone job hóórt in
 * `ci-gate.needs` te staan, anders valt hij er stil buiten. Dat is de enige
 * zwakke plek van een aggregatiepoort, en een test is goedkoper dan die zwakte
 * accepteren.
 */
export function needsVan(yamlTekst, jobId) {
  const regels = yamlTekst.split('\n');
  const start = regels.findIndex((r) => new RegExp(`^ {2}${jobId}:\\s*$`).test(r));
  if (start === -1) return null;

  let inNeeds = false;
  const uit = [];
  for (const regel of regels.slice(start + 1)) {
    if (/^ {2}[a-z0-9]/.test(regel)) break; // volgende job
    if (/^ {4}needs:\s*$/.test(regel)) { inNeeds = true; continue; }
    if (inNeeds) {
      const m = /^ {6}- (.+?)\s*$/.exec(regel);
      if (m) { uit.push(m[1]); continue; }
      if (regel.trim() !== '') break;
    }
  }
  return uit;
}

/** De job die als enige verplichte check dienstdoet. */
export const POORT_JOB_ID = 'ci-gate';

/**
 * Checks die niet uit de workflow komen maar er wel horen te zijn.
 *
 * `Vercel` is de preview-build. Die hoort erbij: een gefaalde preview betekent
 * dat de productiedeploy zou breken, en in deze repo ÍS een merge de deploy.
 * Geverifieerd 25 aug 2026 op elf PR's, inclusief alle dependabot-PR's:
 * `Vercel` verschijnt overal.
 *
 * Bewust NIET in deze lijst:
 *
 *   • `CodeRabbit` — verschijnt niet op dependabot-PR's. Wachten op een check
 *     die daar nooit komt zou elke afhankelijkheidsupdate voorgoed vastzetten.
 *     Hij draait wel en is nuttig; hij is alleen geen poort.
 *   • `Vercel Preview Comments` — een commentaarintegratie, geen
 *     kwaliteitssignaal.
 */
export const EXTERNE_CHECKS = ['Vercel'];

export function verwachteChecks(yamlTekst) {
  return [...jobnamenUitWorkflow(yamlTekst), ...EXTERNE_CHECKS];
}

/**
 * Het oordeel over één peiling.
 *
 * Onderscheidt bewust drie dingen die er op het scherm hetzelfde uitzien:
 * ontbrekend (nog niet verschenen), bezig, en gefaald. Alleen het laatste is
 * een dichte poort; de eerste twee betekenen "wacht nog even".
 */
export function beoordeel(verwacht, checks) {
  const gezien = new Set(checks.map((c) => c.name));
  const ontbreekt = verwacht.filter((n) => !gezien.has(n));
  const bezig = checks.filter((c) => c.bucket === 'pending').map((c) => c.name);
  const gefaald = checks
    .filter((c) => c.bucket === 'fail' || c.bucket === 'cancel')
    .map((c) => `${c.name} (${c.state})`);

  if (gefaald.length) return { klaar: true, groen: false, ontbreekt, bezig, gefaald };
  if (ontbreekt.length || bezig.length) return { klaar: false, groen: false, ontbreekt, bezig, gefaald };
  return { klaar: true, groen: true, ontbreekt, bezig, gefaald };
}

// ── Uitvoering ──────────────────────────────────────────────────────────────

function haalChecks(pr) {
  try {
    const uit = execFileSync('gh', ['pr', 'checks', String(pr), '--json', 'name,state,bucket'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(uit);
  } catch {
    // `gh pr checks` geeft een foutstatus zolang er nog geen enkele check is.
    // Dat is geen fout maar precies de toestand waar dit script voor bestaat.
    return [];
  }
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pr = process.argv[2];
  if (!pr) {
    console.error('Gebruik: node scripts/wacht-op-checks.mjs <pr-nummer> [timeout-seconden]');
    process.exit(2);
  }
  const timeoutSec = Number(process.argv[3] ?? 1800);
  const verwacht = verwachteChecks(readFileSync('.github/workflows/ci.yml', 'utf8'));
  console.log(`Wacht op ${verwacht.length} checks: ${verwacht.join(', ')}`);

  const eind = Date.now() + timeoutSec * 1000;
  let vorige = '';
  while (Date.now() < eind) {
    const oordeel = beoordeel(verwacht, haalChecks(pr));

    const stand = `ontbreekt=${oordeel.ontbreekt.length} bezig=${oordeel.bezig.length}`;
    if (stand !== vorige) {
      console.log(`  ${stand}${oordeel.ontbreekt.length ? ` → ${oordeel.ontbreekt.join(', ')}` : ''}`);
      vorige = stand;
    }

    if (oordeel.klaar) {
      if (oordeel.groen) {
        console.log(`ALLE ${verwacht.length} CHECKS GROEN — mergen mag.`);
        process.exit(0);
      }
      console.error(`POORT DICHT — gefaald: ${oordeel.gefaald.join(', ')}`);
      process.exit(1);
    }
    await wacht(15_000);
  }

  const laatste = beoordeel(verwacht, haalChecks(pr));
  console.error(
    `TIMEOUT na ${timeoutSec}s — ontbreekt: ${laatste.ontbreekt.join(', ') || 'niets'} · ` +
      `bezig: ${laatste.bezig.join(', ') || 'niets'}. NIET mergen zonder te kijken waarom.`,
  );
  process.exit(3);
}

// Alleen draaien als script, niet bij een import vanuit een test.
if (process.argv[1] && process.argv[1].endsWith('wacht-op-checks.mjs')) {
  main();
}
