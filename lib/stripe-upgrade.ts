// Stripe-upgrade-wiring voor /upgrade — UITSLUITEND bedrading, geen
// billinglogica. De echte checkout (Customer Sync, scope, prijzen, btw)
// leeft volledig in de Supabase edge function `stripe-create-checkout`;
// deze module doet alleen: attempt-beheer, dubbelklik-blokkade en de
// aanroep + Nederlandse foutafhandeling.
//
// attempt_id-semantiek (contract met de edge function, #228/F4; aangescherpt
// 21 jul — Stripe cachet op een idempotency-key ook fóuten ~24u):
// - één attempt_id per BEWUSTE checkoutpoging (klik op een plan);
// - NETWERKFOUT/ambigue uitkomst (geen antwoord ontvangen — de aanroep kán
//   geslaagd zijn): zelfde attempt_id hergebruiken, dáárvoor bestaat
//   idempotency;
// - ONTVANGEN definitieve HTTP-fout: poging afgesloten; een bewuste nieuwe
//   klik is een nieuwe poging met een NIEUWE attempt_id (anders blijft de
//   gebruiker Stripe's gecachte fout herhalen);
// - een ander plan is altijd een eigen poging met een eigen attempt_id.

export type UpgradePlan = 'basic' | 'premium';

export type CheckoutFailureKind = 'network' | 'definitive';

export type CheckoutController = {
  /**
   * Start een poging. Geeft de attempt_id terug, of null wanneer er al
   * een aanroep loopt (dubbelklik/tweede knop) — dan niets doen.
   */
  begin(plan: UpgradePlan): string | null;
  /**
   * Aanroep mislukt: knoppen weer vrij. 'network' → attempt_id blijft
   * staan (zelfde poging hervatten); 'definitive' → poging afgesloten,
   * de volgende klik krijgt een nieuwe attempt_id.
   */
  fail(plan: UpgradePlan, kind: CheckoutFailureKind): void;
  /**
   * Herstel na terugkeer uit de bfcache (pageshow met persisted=true,
   * correctieronde 21 jul): bij succes blijft de lock bewust staan tot de
   * redirect, maar wie via browser-back terugkeert krijgt de pagina uit de
   * cache mét die actieve lock — reset() geeft alleen de lock vrij zodat
   * een bewuste nieuwe klik weer kan. De attempt_id-semantiek blijft
   * onaangetast: een bfcache-terugkeer is géén serverantwoord, dus er
   * wordt niets afgesloten of vernieuwd (zelfde plan hervat dezelfde
   * idempotente poging).
   */
  reset(): void;
  /** Alleen voor tests/weergave: loopt er nu een aanroep? */
  inFlight(): UpgradePlan | null;
};

export function createCheckoutController(
  genUuid: () => string = () => crypto.randomUUID(),
): CheckoutController {
  let inFlight: UpgradePlan | null = null;
  const attemptIds = new Map<UpgradePlan, string>();

  return {
    begin(plan) {
      if (inFlight !== null) return null;
      inFlight = plan;
      if (!attemptIds.has(plan)) attemptIds.set(plan, genUuid());
      return attemptIds.get(plan)!;
    },
    fail(plan, kind) {
      if (inFlight === plan) inFlight = null;
      if (kind === 'definitive') attemptIds.delete(plan);
    },
    reset() {
      inFlight = null;
    },
    inFlight() {
      return inFlight;
    },
  };
}

export type StartCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string; kind: CheckoutFailureKind };

/** Nederlandse fallback wanneer de server geen bruikbare fout meegeeft. */
export const GENERIC_CHECKOUT_ERROR =
  'De betaalpagina kon niet worden geopend. Probeer het opnieuw of mail team@ribba.app.';
export const NETWORK_CHECKOUT_ERROR =
  'Kan geen verbinding maken. Controleer je internet en probeer het opnieuw.';

export function checkoutFunctionUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/stripe-create-checkout`;
}

/**
 * Roept de bewezen edge function aan. De edge function geeft zelf al
 * Nederlandse foutteksten terug (422 profiel, 503 bezig, enz.) — die tonen
 * we ongewijzigd; alleen bij een lege/onbruikbare fout valt dit terug op
 * een generieke Nederlandse melding.
 */
export async function startStripeCheckout(opts: {
  supabaseUrl: string;
  accessToken: string;
  schoolId: string;
  plan: UpgradePlan;
  attemptId: string;
  fetchImpl?: typeof fetch;
}): Promise<StartCheckoutResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(checkoutFunctionUrl(opts.supabaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.accessToken}`,
      },
      body: JSON.stringify({
        school_id: opts.schoolId,
        plan: opts.plan,
        attempt_id: opts.attemptId,
      }),
    });
  } catch {
    // Geen antwoord ontvangen: uitkomst ambigu — zelfde poging mag hervatten.
    return { ok: false, error: NETWORK_CHECKOUT_ERROR, kind: 'network' };
  }

  let body: { checkoutUrl?: unknown; error?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    // lege/onleesbare body → generieke melding hieronder
  }

  if (!res.ok || typeof body.checkoutUrl !== 'string' || body.checkoutUrl === '') {
    // Antwoord ontvangen: definitieve uitkomst — poging afsluiten.
    const serverError = typeof body.error === 'string' && body.error.trim() !== ''
      ? body.error
      : GENERIC_CHECKOUT_ERROR;
    return { ok: false, error: serverError, kind: 'definitive' };
  }
  return { ok: true, checkoutUrl: body.checkoutUrl };
}

// ── Mijn Ribba: portal via de edge function ─────────────────────────────────
// Zelfde patroon als de checkout: de webclient roept geauthenticeerd de
// Supabase edge function aan (stripe-portal-session) — alle Stripe-secrets
// blijven binnen de projectbrede Supabase-secretset (B5), er staat niets
// in Vercel. De return_url wordt server-side bepaald; de client stuurt
// alleen school_id ter disambiguatie mee.

export const GENERIC_PORTAL_ERROR =
  'De beheerpagina kon niet worden geopend. Probeer het opnieuw of mail team@ribba.app.';

export type PortalGate = {
  /**
   * Synchrone in-flight lock (correctieronde 21 jul): true = lock verkregen,
   * start precies één aanroep; false = er loopt al een aanroep — stop vóór
   * getSession/fetch. UI-state (disabled-knop) is hier bewust geen onderdeel
   * van: twee click-events kunnen dezelfde render-state zien, deze gate niet.
   */
  begin(): boolean;
  /** Geeft de lock vrij — altijd in finally, ongeacht de uitkomst. */
  end(): void;
  /** Alleen voor tests/weergave. */
  inFlight(): boolean;
};

// Geen attempt_id hier (bewust): een portal-sessie is efemeer en kent geen
// idempotente resource — de gate bewaakt uitsluitend het aantal requests.
export function createPortalGate(): PortalGate {
  let busy = false;
  return {
    begin() {
      if (busy) return false;
      busy = true;
      return true;
    },
    end() {
      busy = false;
    },
    inFlight() {
      return busy;
    },
  };
}

export function portalFunctionUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/stripe-portal-session`;
}

export type OpenPortalResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function openStripePortal(opts: {
  supabaseUrl: string;
  accessToken: string;
  schoolId: string;
  fetchImpl?: typeof fetch;
}): Promise<OpenPortalResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(portalFunctionUrl(opts.supabaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.accessToken}`,
      },
      body: JSON.stringify({ school_id: opts.schoolId }),
    });
  } catch {
    return { ok: false, error: NETWORK_CHECKOUT_ERROR };
  }

  let body: { url?: unknown; error?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    // lege/onleesbare body → generieke melding hieronder
  }

  if (!res.ok || typeof body.url !== 'string' || body.url === '') {
    const serverError = typeof body.error === 'string' && body.error.trim() !== ''
      ? body.error
      : GENERIC_PORTAL_ERROR;
    return { ok: false, error: serverError };
  }
  return { ok: true, url: body.url };
}
