// Welke toestand toont de pagina na terugkeer uit Stripe Checkout?
//
// WAAROM DIT BESTAAT. `/upgrade/success` beweerde onvoorwaardelijk "Betaling
// geslaagd" en opende twee seconden later de app. Bij een betaalmethode die
// niet direct afrekent klopt dat niet: de activatie is dan nog niet rond, de
// gebruiker landt achter de toegangspoort, concludeert dat het mislukt is en
// begint een tweede Checkout. Dat is op 11 aug 2026 echt gebeurd — één
// rijschool hield er twee actieve abonnementen aan over.
//
// De regel die dat voorkomt: de pagina claimt nooit een toestand die zij niet
// heeft gecontroleerd, en biedt in de onzekere toestanden niets aan wat een
// tweede betaling kan starten.
//
// Dit is bewust een pure functie. De keuze tussen "wordt verwerkt" en "actief"
// is de kern van het gedrag; die hoort toetsbaar te zijn zonder browser,
// netwerk of tijd.

/** Hoe lang we "een paar seconden" beloven voordat we het anders formuleren. */
export const DUURT_LANGER_NA_SECONDEN = 90;

export type ActivatieState =
  /** Bestelling ontvangen, activatie loopt. Altijd de eerste toestand. */
  | 'wordt_verwerkt'
  /** Ribba bevestigt zelf een lopend abonnement. Pas hier mag er een vinkje staan. */
  | 'actief'
  /** Duurt langer dan de belofte. Géén fout — bij incasso is dit normaal. */
  | 'duurt_langer'
  /** Geen (geldige) sessie; we kunnen de status niet opvragen. */
  | 'geen_sessie';

export type StatusInvoer = {
  /** Is er een bruikbare sessie? Zonder sessie kunnen we niets vaststellen. */
  ingelogd: boolean;
  /**
   * `plan` uit /api/current-plan. `null` betekent "Ribba kent geen lopend
   * abonnement" — dat is NIET hetzelfde als "de betaling is mislukt".
   */
  plan: string | null;
  /** `isExpired` uit /api/current-plan. */
  isExpired: boolean;
  /** Seconden sinds terugkeer uit Stripe. Alleen voor de tekst, nooit voor de status. */
  secondenVerstreken: number;
  drempelSeconden?: number;
};

/**
 * Bepaalt welke toestand de pagina toont.
 *
 * De volgorde is bewust: eerst "actief", want een bevestigd abonnement wint
 * altijd — ook als de sessie inmiddels weg is of de teller allang voorbij de
 * drempel staat. Daarna pas de onzekere toestanden.
 */
export function bepaalActivatieState(invoer: StatusInvoer): ActivatieState {
  const drempel = invoer.drempelSeconden ?? DUURT_LANGER_NA_SECONDEN;

  // Ribba bevestigt een lopend abonnement. Exact dezelfde regel die /upgrade
  // gebruikt om te bepalen of er een plan is — geen tweede definitie.
  if (invoer.plan !== null && !invoer.isExpired) return 'actief';

  // Zonder sessie kunnen we niets opvragen. Dat is geen fout en zeker geen
  // mislukte betaling: alleen een reden om opnieuw in te loggen.
  if (!invoer.ingelogd) return 'geen_sessie';

  // Puur een tekstwissel. De status blijft uit dezelfde bron komen en het
  // pollen gaat door; dit is nadrukkelijk geen billingtoestand.
  return invoer.secondenVerstreken >= drempel ? 'duurt_langer' : 'wordt_verwerkt';
}

/**
 * Mag deze toestand een weg terug naar de app of naar de planpagina tonen?
 *
 * Alleen `actief`. In elke andere toestand zou zo'n knop de gebruiker naar een
 * afgesloten app sturen of, erger, naar een tweede Checkout. Dat is precies
 * hoe het dubbele abonnement ontstond.
 */
export function magDoorsturen(state: ActivatieState): boolean {
  return state === 'actief';
}
