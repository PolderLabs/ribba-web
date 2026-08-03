// Herkomst-attributie voor rijschool-registraties ("kwam deze signup via een
// advertentie-LP?"). First-touch: bij het eerste bezoek worden utm-parameters,
// document.referrer en het landingspad in localStorage bewaard; een later
// bezoek mét utm-parameters mag een eerdere utm-loze capture upgraden (direct
// binnengekomen, later via een advertentie teruggekomen). Het formulier stuurt
// de capture mee naar /api/register-school, die hem — server-side gesanitized —
// als drivingschools.signup_attribution opslaat en als "Herkomst"-regel in de
// admin-notificatiemail toont.
//
// Bewust localStorage (geen cookie): de LP's (/pro, /rijschool-planner) en het
// registratieformulier (/registreren) leven allemaal op mijn.ribba.app.

export const ATTRIBUTION_STORAGE_KEY = 'ribba_signup_attribution';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

export interface SignupAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;
  landing_page?: string;
  captured_at?: string;
}

export function captureSignupAttribution(): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const current: SignupAttribution = { captured_at: new Date().toISOString() };
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) current[key] = value.slice(0, 200);
    }
    // Same-origin referrer is navigatie binnen de site, geen herkomst.
    const referrer = document.referrer;
    if (referrer && !referrer.includes(window.location.hostname)) {
      current.referrer = referrer.slice(0, 300);
    }
    current.landing_page = (window.location.pathname + window.location.search).slice(0, 300);

    const storedRaw = window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (storedRaw) {
      // First-touch wint; alleen upgraden als de eerdere capture geen
      // utm_source had en dit bezoek wel.
      const stored = JSON.parse(storedRaw) as SignupAttribution;
      if (stored.utm_source || !current.utm_source) return;
    }
    window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* attributie is best-effort — nooit de pagina laten falen */
  }
}

export function readSignupAttribution(): SignupAttribution | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SignupAttribution) : null;
  } catch {
    return null;
  }
}

// Server-side whitelist/sanitizer: client-input is untrusted — alleen bekende
// keys, alleen strings, lengte begrensd. null bij lege of ongeldige input.
export function sanitizeSignupAttribution(input: unknown): SignupAttribution | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const out: SignupAttribution = {};
  const allowed: Array<keyof SignupAttribution> = [
    ...UTM_KEYS, 'referrer', 'landing_page', 'captured_at',
  ];
  for (const key of allowed) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim().slice(0, 300);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Compacte mensleesbare samenvatting voor de admin-mail, bv.
// "google / cpc / lp-vergelijk-rijscholen".
export function summarizeAttribution(attr: SignupAttribution): string {
  if (attr.utm_source) {
    return [attr.utm_source, attr.utm_medium, attr.utm_campaign].filter(Boolean).join(' / ');
  }
  if (attr.referrer) return attr.referrer;
  return 'direct / onbekend';
}
