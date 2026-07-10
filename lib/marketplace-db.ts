// Gedeelde DB-helpers voor de marketplace-flow (inquiry-intake + web-chat).
// Houdt de service-role client en de cbr_rijscholen kolom-mapping op één plek.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ChatRole, InquiryRecipientStatus } from './marketplace-types';

let cached: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (!cached) {
    cached = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }
  return cached;
}

// ⚠️ Kolomnamen van cbr_rijscholen (vergelijkingssite-data, zelfde Supabase-
// project). Vóór livegang verifiëren in het dashboard; een rename is dan een
// one-line fix hier.
export const CBR_COLUMNS = {
  id: 'id',
  name: 'name',
  email: 'email',
  city: 'city',
} as const;

export interface CbrRijschool {
  id: number;
  name: string;
  email: string | null;
  city: string | null;
}

export interface RecipientTokenLookup {
  recipient: {
    id: string;
    inquiry_id: string;
    rijschool_id: number;
    rijschool_user_id: string | null;
    status: InquiryRecipientStatus;
    notified_email: string | null;
    leerling_email_optout_at: string | null;
    rijschool_email_optout_at: string | null;
  };
  role: ChatRole;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isChatToken(token: string): boolean {
  return UUID_RE.test(token);
}

// Zoekt de inquiry_recipient bij een chat-token; de kolom die matcht bepaalt
// de rol. Service role — tokens zijn nooit via client-RLS bereikbaar.
export async function lookupRecipientByToken(token: string): Promise<RecipientTokenLookup | null> {
  if (!isChatToken(token)) return null;
  const supabase = getServiceClient();
  const columns =
    'id, inquiry_id, rijschool_id, rijschool_user_id, status, notified_email, leerling_email_optout_at, rijschool_email_optout_at';

  const { data: asRijschool } = await supabase
    .from('inquiry_recipients')
    .select(columns)
    .eq('rijschool_chat_token', token)
    .maybeSingle();
  if (asRijschool) return { recipient: asRijschool, role: 'rijschool' };

  const { data: asLeerling } = await supabase
    .from('inquiry_recipients')
    .select(columns)
    .eq('leerling_chat_token', token)
    .maybeSingle();
  if (asLeerling) return { recipient: asLeerling, role: 'leerling' };

  return null;
}

export async function getCbrRijscholen(ids: number[]): Promise<CbrRijschool[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('cbr_rijscholen')
    .select(`${CBR_COLUMNS.id}, ${CBR_COLUMNS.name}, ${CBR_COLUMNS.email}, ${CBR_COLUMNS.city}`)
    .in(CBR_COLUMNS.id, ids);

  if (error) {
    throw new Error(`cbr_rijscholen lookup failed: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r[CBR_COLUMNS.id] as number,
      name: (r[CBR_COLUMNS.name] as string) ?? `Rijschool ${r[CBR_COLUMNS.id]}`,
      email: (r[CBR_COLUMNS.email] as string | null) ?? null,
      city: (r[CBR_COLUMNS.city] as string | null) ?? null,
    };
  });
}
