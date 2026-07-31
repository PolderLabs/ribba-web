/**
 * reset-link — welke vorm heeft de resetlink, en wat moet de pagina doen?
 *
 * Waarom dit bestaat (31 juli 2026): `/reset` keek uitsluitend naar de
 * hash-vormen (`#access_token`, `#error=`). Maar `createBrowserClient` uit
 * `@supabase/ssr` gebruikt STANDAARD de PKCE-flow, en die levert de link af
 * als `?code=<uuid>` in de query. Die vorm viel door naar het
 * e-mailformulier.
 *
 * Het gevolg voor de gebruiker was een lus die er van buiten uitziet als een
 * kapotte link, terwijl de eerste klik gewoon slaagde:
 *   klik → "vul je e-mailadres in" → nog eens klikken → token is eenmalig,
 *   dus nu 403 → opnieuw aanvragen → 429 rate limit.
 * In de auth-logs is dat terug te zien als 303 login → 403 "One-time token
 * not found" → 429.
 *
 * Deze module is puur: geen Supabase, geen DOM. Daardoor is de beslissing
 * testbaar zonder browser — en dat is precies de laag waarin de fout zat.
 */

export type ResetAction =
  /** Er is al een sessie: direct het wachtwoordveld tonen. */
  | { kind: 'set-password' }
  /** PKCE: wissel deze code in voor een sessie. */
  | { kind: 'exchange-code'; code: string }
  /** Implicit (oudere links): zet de sessie met deze tokens. */
  | { kind: 'set-session'; accessToken: string; refreshToken: string }
  /** Supabase gaf een fout terug, of de link is onbruikbaar. */
  | { kind: 'error' }
  /** Gewoon de pagina bezoeken zonder link. */
  | { kind: 'request' };

export type ResetUrlInput = {
  /** `window.location.search`, bijv. `?code=abc`. */
  search: string;
  /** `window.location.hash`, bijv. `#access_token=...`. */
  hash: string;
  /** Heeft de client al een geldige sessie? */
  hasSession: boolean;
};

/**
 * Bepaalt wat de resetpagina moet doen.
 *
 * Volgorde is bewust:
 *   1. een bestaande sessie wint altijd — de link is dan al verzilverd, en
 *      opnieuw om een e-mailadres vragen zou onzin zijn;
 *   2. PKCE (`?code=`) — de huidige vorm;
 *   3. implicit (`#access_token=`) — oudere links, blijft ondersteund;
 *   4. een expliciete fout van Supabase (`#error=`);
 *   5. anders: gewoon het formulier.
 */
export function classifyResetUrl(input: ResetUrlInput): ResetAction {
  if (input.hasSession) return { kind: 'set-password' };

  const code = new URLSearchParams(input.search || '').get('code');
  if (code) return { kind: 'exchange-code', code };

  const hash = input.hash || '';
  if (hash.includes('access_token')) {
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (accessToken && refreshToken) {
      return { kind: 'set-session', accessToken, refreshToken };
    }
    // access_token zonder refresh_token is onbruikbaar: setSession faalt dan
    // sowieso. Meteen als fout behandelen scheelt een mislukte netwerkronde.
    return { kind: 'error' };
  }

  if (hash.includes('error=')) return { kind: 'error' };

  return { kind: 'request' };
}

/**
 * Eén melding voor alle onbruikbare links.
 *
 * Bewust niet "verlopen": de meest voorkomende oorzaak is dat de link al is
 * gebruikt — een resetlink is eenmalig, en tot deze fix klikten mensen er
 * juist een tweede keer op omdat de eerste keer niets leek te doen. "Verlopen"
 * stuurt iemand op het verkeerde been.
 */
export const RESET_LINK_ONBRUIKBAAR =
  'Deze resetlink is al gebruikt of verlopen. Vraag hieronder een nieuwe aan.';
