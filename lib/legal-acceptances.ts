/**
 * Helper voor het opslaan van legal_acceptances rijen.
 *
 * Append-only: deze module schrijft alleen INSERTs. RLS op de tabel
 * blokkeert UPDATE/DELETE voor alle rollen (behalve service_role).
 */
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LEGAL_VERSIONS, type LegalDocumentType } from './legal-versions';

type AcceptanceInput = {
  user_id: string;
  school_id?: string | null;
  document_type: LegalDocumentType;
  document_version: string;
  ip_address?: string | null;
  user_agent?: string | null;
};

/**
 * Haal IP-adres uit Vercel/forwarded headers.
 */
export function extractIpAddress(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? null;
  }
  return request.headers.get('x-real-ip') ?? null;
}

export function extractUserAgent(request: NextRequest): string | null {
  return request.headers.get('user-agent') ?? null;
}

/**
 * Insert één of meerdere acceptance-rijen. Logt fouten maar gooit nooit
 * (legal logging mag de hoofd-flow niet breken).
 */
export async function recordLegalAcceptances(
  supabase: SupabaseClient,
  acceptances: AcceptanceInput[],
): Promise<void> {
  if (acceptances.length === 0) return;

  const rows = acceptances.map((a) => ({
    user_id: a.user_id,
    school_id: a.school_id ?? null,
    document_type: a.document_type,
    document_version: a.document_version,
    ip_address: a.ip_address ?? null,
    user_agent: a.user_agent ?? null,
  }));

  const { error } = await supabase.from('legal_acceptances').insert(rows);
  if (error) {
    console.error('[legal_acceptances] insert failed:', error, { rows });
  }
}

/**
 * Valideer en filter de versies die de client meestuurt.
 * Voorkomt dat de client een willekeurige versie-string in de DB schrijft —
 * we accepteren alleen de versies die op de server bekend zijn.
 */
export function pickAcceptedVersions(
  clientVersions: Record<string, unknown> | undefined,
  expectedTypes: LegalDocumentType[],
): Array<{ document_type: LegalDocumentType; document_version: string }> {
  if (!clientVersions || typeof clientVersions !== 'object') return [];

  return expectedTypes
    .filter((type) => {
      const provided = clientVersions[type];
      const expected = LEGAL_VERSIONS[type];
      // Accept the version only if it matches the currently published version.
      // This makes the client a witness, not the source of truth.
      return typeof provided === 'string' && provided === expected;
    })
    .map((type) => ({
      document_type: type,
      document_version: LEGAL_VERSIONS[type],
    }));
}
