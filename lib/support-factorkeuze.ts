// Welke tweede factor gebruikt de supportmedewerker om binnen te komen?
//
// Apart bestand omdat het een REGEL is en geen bedrading: toetsbaar zonder
// browser, Supabase-client of React.
//
// ── Waarom dit bestaat ──────────────────────────────────────────────────────
//
// `/support` koos altijd `totp[0]`, zonder keuzescherm. Zolang er één factor is
// klopt dat. Maar het herstelmodel dat we hebben gekozen is een tweede,
// onafhankelijk bewaarde TOTP-factor op hetzelfde persoonlijke staffaccount —
// Supabase levert zelf geen recoverycodes en beveelt precies dit aan.
//
// Met `totp[0]` hard gekozen zou die tweede factor géén herstelwaarde hebben:
// raakt het apparaat met de eerste factor kwijt, dan blijft het portaal die
// eerste uitdagen en kom je nooit bij de tweede. Dat is de gevaarlijkste
// uitkomst — je dénkt gedekt te zijn. Supabase' eigen documentatie zegt het
// ook: "If listFactors() returns more than one factor you should present the
// user with a choice."
//
// ── Wat hier bewust NIET gebeurt ────────────────────────────────────────────
//
// Geen automatische terugval op een andere factor. Wie zijn code niet krijgt
// ingevoerd, kiest zelf opnieuw. Automatisch doorschuiven zou betekenen dat het
// portaal een factor uitdaagt die de gebruiker niet bedoelde, en dat is bij een
// tweede factor die je juist apart bewaart precies verkeerd.

/** De velden die we van een factor gebruiken. Bewust een subset van Supabase' type. */
export type Factor = {
  id: string;
  status: string;
  factor_type: string;
  friendly_name?: string | null;
  created_at?: string | null;
};

export type Factorpad =
  /** Geen bruikbare factor: de bestaande enrollmentflow. */
  | { soort: 'instellen' }
  /** Precies één: direct uitdagen, geen extra scherm. */
  | { soort: 'invoeren'; factorId: string }
  /** Meer dan één: de gebruiker kiest. */
  | { soort: 'kiezen'; opties: Factoroptie[] };

/** Wat de gebruiker te zien krijgt. Nooit een id of andere technische metadata. */
export type Factoroptie = { id: string; naam: string };

/**
 * Alleen een geverifieerde TOTP-factor is een bruikbare optie.
 *
 * De Supabase-client filtert `data.totp` zelf al op `verified`, maar dat is een
 * interne keuze van die bibliotheek. Een achtergebleven `unverified` enrollment
 * als "reservefactor" aanbieden zou betekenen dat iemand denkt een tweede weg
 * naar binnen te hebben die niet bestaat. Die invariant houden we daarom zelf
 * vast, en een test bewaakt hem.
 */
function bruikbaar(f: Factor): boolean {
  return f.status === 'verified' && f.factor_type === 'totp';
}

/**
 * Stabiele volgorde: oudste eerst.
 *
 * Zonder vaste ordening zou een herlading de labels kunnen omwisselen, en dan
 * kiest iemand "Reserve" terwijl hij zijn dagelijkse authenticator bedoelde.
 * Bij gelijke of ontbrekende datum valt hij terug op het id — niet omdat dat
 * betekenis heeft, maar omdat het deterministisch is.
 */
function opVolgorde(a: Factor, b: Factor): number {
  const da = a.created_at ?? '';
  const db = b.created_at ?? '';
  if (da !== db) return da < db ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * Naam voor in de keuzelijst.
 *
 * `friendly_name` komt van Supabase en wordt bij het koppelen gezet. Wij zetten
 * hem vandaag niet, dus in de praktijk is hij leeg — vandaar de positionele
 * terugval. Nooit het id tonen: dat zegt de gebruiker niets en het hoort niet
 * op een inlogscherm.
 */
function naamVoor(f: Factor, index: number, totaal: number): string {
  const eigen = f.friendly_name?.trim();
  if (eigen) return eigen;
  if (index === 0) return 'Primaire authenticator';
  return totaal > 2 ? `Reserve-authenticator ${index}` : 'Reserve-authenticator';
}

/** Bepaalt welk pad het portaal moet nemen. */
export function kiesFactorpad(factoren: readonly Factor[] | null | undefined): Factorpad {
  const bruikbare = (factoren ?? []).filter(bruikbaar).slice().sort(opVolgorde);

  if (bruikbare.length === 0) return { soort: 'instellen' };
  if (bruikbare.length === 1) return { soort: 'invoeren', factorId: bruikbare[0].id };

  return {
    soort: 'kiezen',
    opties: bruikbare.map((f, i) => ({ id: f.id, naam: naamVoor(f, i, bruikbare.length) })),
  };
}
