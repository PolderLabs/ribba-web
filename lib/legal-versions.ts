/**
 * Centrale plek voor versies van legal documenten.
 *
 * De versie wordt opgeslagen bij elke acceptatie in `legal_acceptances`,
 * zodat we juridisch kunnen aantonen welke versie iemand heeft geaccepteerd.
 * Deze constanten MOETEN de gepubliceerde versie op de canonieke bron
 * weerspiegelen — anders leggen we een verouderde versie vast (audit-finding H6).
 *
 * Bron van waarheid:
 * - terms   → https://ribba.app/voorwaarden
 * - privacy → https://ribba.app/privacybeleid
 * - dpa     → link.ribba.app/verwerkersovereenkomst (rijschool-specifiek, deze repo)
 *
 * PROCES: bij elke nieuwe versie op ribba.app wordt deze file in DEZELFDE
 * wijzigingsronde opgehoogd. De DPA-versie hoogt alleen op bij een inhoudelijke
 * herziening van dat document (jurist-traject).
 *
 * Versie-formaat: `YYYY-MM-vN` (bijv. 2026-07-v1)
 */
export const LEGAL_VERSIONS = {
  terms: '2026-07-v1',   // ribba.app/voorwaarden — herziening 24 juli 2026
  privacy: '2026-07-v1', // ribba.app/privacybeleid — herziening 24 juli 2026
  dpa: '2026-04-v1',     // ongewijzigd; inhoudelijke 2026-07-herziening = jurist-traject
} as const;

export type LegalDocumentType = keyof typeof LEGAL_VERSIONS;
