// De beslissing achter /join/[code].
//
// AANLEIDING (13 aug 2026)
// De route zocht een uitnodiging op met `code.toUpperCase()`. De app genereert
// persoonlijke codes met `Math.random().toString(36)` — kleine letters. Een
// persoonlijke uitnodiging kon die query dus nooit matchen: elke leerling die
// er een kreeg, zag "Link verlopen". Sinds de route bestaat (24 feb 2026).
//
// Het was geen tikfout maar een tweede mening. De database heeft al een
// resolver — `resolve_invite`, die de app gebruikt — en die vergelijkt
// hoofdletterongevoelig én kent de slug-fallback. De webpagina stelde
// daarnaast zijn eigen vraag, met zijn eigen regels. Twee lezers van dezelfde
// waarheid lopen vroeg of laat uiteen; hier duurde dat één commit.
//
// Daarom beslist `resolve_invite` nu, en doet de pagina alleen nog de opmaak.
// Deze module bevat die beslissing los van alle IO, zodat de zeven gevallen
// hieronder testbaar zijn zonder database.

export type JoinUitkomst =
  /** Doorsturen naar het openbare inschrijfformulier van de school. */
  | { soort: 'redirect'; slug: string }
  /** Persoonlijke uitnodiging: toon de "open in de app"-pagina. */
  | { soort: 'persoonlijk'; code: string; schoolNaam: string }
  /** Alles wat niet (meer) geldig is. Eén uitkomst, bewust. */
  | { soort: 'verlopen' };

export type SchoolTreffer = {
  registration_slug: string;
  registration_enabled: boolean;
};

/** Wat `resolve_invite` teruggeeft: de canonieke code, in de opgeslagen schrijfwijze. */
export type ResolveTreffer = { code: string };

/** Weergavegegevens, opgehaald op de canonieke code — nooit om te beslissen. */
export type InviteWeergave = {
  is_multi_use: boolean;
  drivingschools: { registration_slug: string; name: string } | null;
};

export function bepaalJoinUitkomst(input: {
  school: SchoolTreffer | null;
  resolved: ResolveTreffer | null;
  invite: InviteWeergave | null;
}): JoinUitkomst {
  const { school, resolved, invite } = input;

  // 1. De invoer is de registratie-slug van een school.
  //
  // Dit blijft vóór de RPC staan, en dat is geen volgordekwestie maar een
  // poort: `resolve_invite` toetst `status = 'active'` maar NIET
  // `registration_enabled`. Zou een uitgeschakelde school hier doorvallen naar
  // stap 2, dan gaf de RPC alsnog de multi-use code terug en stond de
  // inschrijving weer open. Een school die inschrijving uitzet, krijgt daarom
  // hier een eindpunt — precies zoals vóór deze wijziging.
  if (school) {
    return school.registration_enabled
      ? { soort: 'redirect', slug: school.registration_slug }
      : { soort: 'verlopen' };
  }

  // 2. Vanaf hier is `resolve_invite` de enige autoriteit. Hij bepaalt of de
  //    uitnodiging bestaat, niet verlopen is, en niet al gebruikt. Geen
  //    treffer betekent geen pagina — welke van die drie het was, vertellen we
  //    bewust niet, net zomin als voorheen.
  if (!resolved) {
    return { soort: 'verlopen' };
  }

  // 3. De weergavegegevens horen bij een code die de database zojuist zelf
  //    teruggaf. Ontbreken ze toch, dan is er iets weg tussen twee reads in;
  //    dan tonen we liever niets dan een halve pagina.
  if (!invite) {
    return { soort: 'verlopen' };
  }

  // 4. Een multi-use uitnodiging is de schoollink: die hoort thuis op het
  //    openbare inschrijfformulier.
  if (invite.is_multi_use && invite.drivingschools?.registration_slug) {
    return { soort: 'redirect', slug: invite.drivingschools.registration_slug };
  }

  // 5. Persoonlijke uitnodiging. We tonen de code niet, alleen de deeplink.
  return {
    soort: 'persoonlijk',
    code: resolved.code,
    schoolNaam: invite.drivingschools?.name ?? 'je rijschool',
  };
}
