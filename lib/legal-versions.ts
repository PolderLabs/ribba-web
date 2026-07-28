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
 * - dpa     → mijn.ribba.app/verwerkersovereenkomst (deze repo; sinds de
 *             hostsplitsing canonicaliseert /verwerkersovereenkomst naar
 *             mijn.ribba.app — zie lib/domains.ts)
 *
 * PROCES: bij elke nieuwe versie op ribba.app wordt deze file in DEZELFDE
 * wijzigingsronde opgehoogd. Dat geldt óók voor de DPA: niet alleen bij een
 * inhoudelijke herziening, maar bij elke wijziging van de gepubliceerde tekst.
 * Anders wijst een vastgelegde acceptatie naar een document dat inmiddels iets
 * anders zegt.
 *
 * Deze constanten moeten gelijk lopen met src/lib/legal.ts in de ribbaPro-repo.
 *
 * Versie-formaat: `YYYY-MM-vN` (bijv. 2026-07-v1)
 */
export const LEGAL_VERSIONS = {
  terms: '2026-07-v1',   // ribba.app/voorwaarden — herziening 24 juli 2026
  privacy: '2026-07-v1', // ribba.app/privacybeleid — herziening 24 juli 2026
  dpa: '2026-07-v1',     // partijaanduiding → Ribba B.V. (KVK 42114132), 28 juli 2026
} as const;

export type LegalDocumentType = keyof typeof LEGAL_VERSIONS;
