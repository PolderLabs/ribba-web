// Stripe-upgrade-wiring voor /upgrade — UITSLUITEND bedrading, geen
// billinglogica. De echte checkout (Customer Sync, scope, prijzen, btw)
// leeft volledig in de Supabase edge function `stripe-create-checkout`;
// deze module doet alleen: attempt-beheer, dubbelklik-blokkade en de
// aanroep + Nederlandse foutafhandeling.
//
// attempt_id-semantiek (contract met de edge function, #228/F4):
// - één attempt_id per BEWUSTE checkoutpoging (klik op een plan);
// - bij een fout blijft dezelfde attempt_id staan zodat een bewuste
//   nieuwe poging voor hetzelfde plan de idempotency-key hergebruikt
//   (Stripe ziet dat als dezelfde operatie);
// - een ander plan is een andere poging → eigen attempt_id.

export type UpgradePlan = 'basic' | 'premium';

export type CheckoutController = {
  /**
   * Start een poging. Geeft de attempt_id terug, of null wanneer er al
   * een aanroep loopt (dubbelklik/tweede knop) — dan niets doen.
   */
  begin(plan: UpgradePlan): string | null;
  /** Aanroep mislukt: knoppen weer vrij; attempt_id blijft voor retry. */
  fail(plan: UpgradePlan): void;
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
    fail(plan) {
      if (inFlight === plan) inFlight = null;
    },
    inFlight() {
      return inFlight;
    },
  };
}

export type StartCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/** Nederlandse fallback wanneer de server geen bruikbare fout meegeeft. */
export const GENERIC_CHECKOUT_ERROR =
  'De betaalpagina kon niet worden geopend. Probeer het opnieuw of mail hallo@ribba.app.';
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
    return { ok: false, error: NETWORK_CHECKOUT_ERROR };
  }

  let body: { checkoutUrl?: unknown; error?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    // lege/onleesbare body → generieke melding hieronder
  }

  if (!res.ok || typeof body.checkoutUrl !== 'string' || body.checkoutUrl === '') {
    const serverError = typeof body.error === 'string' && body.error.trim() !== ''
      ? body.error
      : GENERIC_CHECKOUT_ERROR;
    return { ok: false, error: serverError };
  }
  return { ok: true, checkoutUrl: body.checkoutUrl };
}

// ── Succespagina ────────────────────────────────────────────────────────────
// De edge function zet alleen ?session_id= in de success-URL; het gekozen
// plan reist daarom client-side mee via sessionStorage (gezet vlak vóór de
// redirect naar Stripe). De Mollie-flow gebruikt ?plan= en blijft werken.
// Onbekend plan → neutrale tekst, NOOIT stil "Premium" aannemen.

export const UPGRADE_PLAN_STORAGE_KEY = 'ribba_upgrade_plan';

export function successPlanLabel(
  urlPlan: string | null,
  storedPlan: string | null,
): 'Basic' | 'Premium' | null {
  const plan = urlPlan ?? storedPlan;
  if (plan === 'basic') return 'Basic';
  if (plan === 'premium') return 'Premium';
  return null;
}
