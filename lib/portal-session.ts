// Pure beslislogica voor het portal-session-endpoint (/api/portal).
// UITSLUITEND bedrading rond de bestaande stripe_customers-koppeling:
// geen Customer-aanmaak, geen herstel, geen billinglogica. Wie geen
// actieve koppeling heeft, krijgt een nette Nederlandse melding en rondt
// eerst de abonnementskeuze af — de koppeling ontstaat alleen via de
// checkout (F4).

/** Spiegel van de keyprefix-verwachting uit de edge function (F3, bindend
 *  ontwerp): onbekende prefix = fail-closed, nooit raden. */
export function expectedLivemodeForKey(
  key: string,
): { ok: true; livemode: boolean } | { ok: false } {
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) {
    return { ok: true, livemode: false };
  }
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) {
    return { ok: true, livemode: true };
  }
  return { ok: false };
}

export type PortalCustomerRow = {
  stripe_customer_id: string | null;
  livemode: boolean;
  status: string;
};

export type PortalCustomerDecision =
  | { action: 'open'; stripeCustomerId: string }
  | { action: 'no_customer' }
  | { action: 'ambiguous' };

/**
 * Kiest de Customer waarvoor een portal-sessie geopend mag worden.
 * Alleen een rij die actief is, in de verwachte modus staat én een
 * customer-id draagt telt; nul rijen = nog geen koppeling (geen fout,
 * wel een duidelijke vervolgstap), meer dan één = configuratieprobleem
 * dat nooit stil opgelost mag worden.
 */
export function selectPortalCustomer(
  rows: PortalCustomerRow[],
  expectedLivemode: boolean,
): PortalCustomerDecision {
  const candidates = rows.filter(
    (r) =>
      r.status === 'active' &&
      r.livemode === expectedLivemode &&
      typeof r.stripe_customer_id === 'string' &&
      r.stripe_customer_id !== '',
  );
  if (candidates.length === 0) return { action: 'no_customer' };
  if (candidates.length > 1) return { action: 'ambiguous' };
  return { action: 'open', stripeCustomerId: candidates[0].stripe_customer_id! };
}

export const NO_CUSTOMER_MESSAGE =
  'Er is nog geen actieve Stripe-koppeling voor deze rijschool. Kies eerst een abonnement via de upgradepagina.';
export const PORTAL_CONFIG_ERROR =
  'De facturatie-omgeving is niet goed geconfigureerd. Mail team@ribba.app.';
