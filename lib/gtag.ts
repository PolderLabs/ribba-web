// Google Ads (AW-18341801400) conversietracking voor de trial-registratie op
// mijn.ribba.app/registreren. De registratie-CTA van de ribba.app-campagne
// voltooit daar, dus de conversie wordt in deze repo gemeten. Consent Mode v2 +
// cross-domain linker (incl. mijn.ribba.app) worden in app/layout.tsx geladen.

export const GADS_ID = process.env.NEXT_PUBLIC_GADS_ID || 'AW-18341801400';

// "AW-18341801400/<label>". Alleen als dit geconfigureerd is vuren we de
// Ads-conversie — géén account-level fallback (dat houdt ribba.app als vangnet
// voor de aanvraag-conversie; die meting moet schoon blijven).
const SIGNUP_SEND_TO = process.env.NEXT_PUBLIC_GADS_SIGNUP_SEND_TO;

function getGtag(): ((...args: unknown[]) => void) | null {
  if (typeof window === 'undefined') return null;
  return typeof window.gtag === 'function' ? window.gtag : null;
}

// Vuur bij een VOLTOOIDE trial-registratie (stap direct ná account-aanmaak).
// transactionId (school-id) dedupet een eventuele dubbele fire.
export function trackTrialSignup(transactionId?: string): void {
  const gtag = getGtag();
  if (!gtag) return;

  if (SIGNUP_SEND_TO) {
    gtag('event', 'conversion', {
      send_to: SIGNUP_SEND_TO,
      transaction_id: transactionId,
      value: 1.0,
      currency: 'EUR',
    });
  }
  // Los GA4/rapportage-event; onafhankelijk van de Ads-conversie.
  gtag('event', 'trial_signup', { transaction_id: transactionId });
}
