'use client';

// Gedeelde supabase-client en sessiecontrole voor de supportschermen.
//
// De client wordt lui aangemaakt: tijdens het prerenderen bestaat er geen
// browser en zou createBrowserClient de build laten klappen.

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  client ??= createBrowserClient(supabaseUrl, supabaseAnonKey);
  return client;
}

export type SessieStatus = 'laden' | 'ok' | 'geen-toegang';

/**
 * Geeft het access token terug, maar alleen als de tweede factor in deze
 * sessie daadwerkelijk is gebruikt (aal2).
 *
 * Dit is gemak, geen beveiliging: de API controleert de aal2-claim zelf. Deze
 * hook voorkomt alleen dat je een leeg scherm met een 403 te zien krijgt.
 */
export function useSupportToken(): { token: string | null; status: SessieStatus } {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<SessieStatus>('laden');

  useEffect(() => {
    let afgebroken = false;
    (async () => {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (!afgebroken) setStatus('geen-toegang'); return; }

      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel !== 'aal2') { if (!afgebroken) setStatus('geen-toegang'); return; }

      if (!afgebroken) { setToken(session.access_token); setStatus('ok'); }
    })();
    return () => { afgebroken = true; };
  }, []);

  return { token, status };
}
