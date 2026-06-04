/**
 * Centrale plek voor versies van legal documenten.
 *
 * Verhoog de versie wanneer de inhoud van een document materieel wijzigt.
 * De versie wordt opgeslagen bij elke acceptatie in `legal_acceptances`,
 * zodat we juridisch kunnen aantonen welke versie iemand heeft geaccepteerd.
 *
 * Versie-formaat: `YYYY-MM-vN` (bijv. 2026-04-v1, 2026-04-v2)
 */
export const LEGAL_VERSIONS = {
  terms: '2026-04-v1',
  privacy: '2026-04-v1',
  dpa: '2026-04-v1',
} as const;

export type LegalDocumentType = keyof typeof LEGAL_VERSIONS;
