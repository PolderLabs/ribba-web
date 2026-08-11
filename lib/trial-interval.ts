// De duur van een gratis periode — één grammatica, twee bronnen.
//
// Besluit Önder, 11 aug 2026 (na empirisch onderzoek in Stripe-testmodus):
//
//   Ribba gebruikt Stripe Checkout met een absolute `trial_end`. Trial Offers
//   worden niet gebruikt zolang Checkout ze niet native ondersteunt.
//
// "1 maand gratis" is daarmee een KALENDERMAAND en geen 30 dagen: 11 augustus
// → 11 september. Dat is wat we tegen de klant zeggen, dus is het ook wat er
// gebeurt.
//
// ── Twee bronnen, dezelfde taal ─────────────────────────────────────────────
//
//   Stripe Price-metadata  `trial_interval = 1 month`   het standaardaanbod
//   promo_codes            `stripe_trial_interval`      de overschrijving
//                                                        (STARTGRATIS: 6 mons)
//
// Die tweede is een Postgres `interval` en komt er als tekst uit — `6 mons`,
// niet `6 months`. Vandaar dat de parser beide schrijfwijzen accepteert.
//
// ── Stripe doet hier NIETS mee ──────────────────────────────────────────────
//
// `trial_interval` is geen Stripe-begrip. Stripe leest dit veld niet en kent
// het geen betekenis toe. Het is configuratie die Ribba uitleest en omrekent
// naar de absolute `trial_end` die Checkout wél begrijpt. Wie dat verwart,
// gaat later zoeken naar Stripe-gedrag dat niet bestaat.
//
// De winst is dat de duur toch in Stripe woont: jij zet `3 months` in het
// dashboard en zowel de registratiepagina als Checkout volgt, zonder release.

/** Wat er aan gratis periode is afgesproken. Altijd positief. */
export type TrialInterval = {
  eenheid: 'month' | 'day';
  aantal: number;
};

/**
 * Stripe eist dat `trial_end` minstens 48 uur in de toekomst ligt. Een korter
 * ingestelde periode is dus geen "bijna goed" maar een Checkout die weigert —
 * en dat willen we bij ons zien, niet bij de klant.
 */
export const MINIMALE_TRIAL_SECONDEN = 48 * 60 * 60;

// Bewust smal. Alles wat hier niet in past is een configuratiefout en wordt
// geweigerd, niet welwillend geïnterpreteerd: een typefout in het dashboard
// mag geen stilzwijgend ander aanbod opleveren.
const PATROON = /^(\d{1,3})\s*(months?|mons?|days?)$/;

/** Leest `1 month`, `6 mons`, `14 days`. Geeft null bij al het andere. */
export function parseTrialInterval(raw: unknown): TrialInterval | null {
  if (typeof raw !== 'string') return null;
  const genormaliseerd = raw.trim().toLowerCase();
  if (genormaliseerd === '') return null;

  const m = PATROON.exec(genormaliseerd);
  if (!m) return null;

  const aantal = Number.parseInt(m[1], 10);
  if (!Number.isSafeInteger(aantal) || aantal < 1) return null;

  return { eenheid: m[2].startsWith('mon') ? 'month' : 'day', aantal };
}

/**
 * Telt de periode kalendermatig op bij een moment.
 *
 * Maanden worden geklemd op de laatste dag van de doelmaand: 31 januari plus
 * één maand is 28 februari, niet 3 maart. JavaScript doet dat uit zichzelf
 * fout (`setMonth` laat overlopen), dus het staat hier expliciet.
 *
 * Gerekend in UTC. Vercel draait in UTC en Stripe rekent in epoch-seconden;
 * hele maanden optellen in UTC houdt de kalenderdag in Nederland gelijk,
 * ook over de zomertijdgrens heen.
 */
export function trialEinde(vanaf: Date, interval: TrialInterval): Date {
  if (interval.eenheid === 'day') {
    return new Date(vanaf.getTime() + interval.aantal * 86_400_000);
  }

  const maandIndex = vanaf.getUTCMonth() + interval.aantal;
  const jaar = vanaf.getUTCFullYear() + Math.floor(maandIndex / 12);
  const maand = ((maandIndex % 12) + 12) % 12;

  // Dag 0 van de vólgende maand = de laatste dag van de doelmaand.
  const laatsteDagVanDoelmaand = new Date(Date.UTC(jaar, maand + 1, 0)).getUTCDate();
  const dag = Math.min(vanaf.getUTCDate(), laatsteDagVanDoelmaand);

  return new Date(Date.UTC(
    jaar, maand, dag,
    vanaf.getUTCHours(), vanaf.getUTCMinutes(),
    vanaf.getUTCSeconds(), vanaf.getUTCMilliseconds(),
  ));
}

/**
 * De zin die de klant leest. Server-side gerenderd en niet in de browser
 * gereconstrueerd — anders ontstaat er een tweede plek waar "6 maanden" wordt
 * bepaald, en die loopt gegarandeerd een keer uit de pas met Checkout.
 */
export function trialTekst(interval: TrialInterval): string {
  const meervoud = interval.aantal !== 1;
  if (interval.eenheid === 'month') {
    return `${interval.aantal} ${meervoud ? 'maanden' : 'maand'} gratis`;
  }
  return `${interval.aantal} ${meervoud ? 'dagen' : 'dag'} gratis`;
}
