// Drie productie-domeinen, één Next-app (zelfde Vercel-project). Elk domein
// heeft één doel; de middleware canonicaliseert paginaroutes naar het juiste
// host en link-generatie gebruikt de juiste base-URL per doel.
//
// - chat.ribba.app  → anonieme web-chat + marketplace-entry (/chat, /i, /r)
// - link.ribba.app  → referral/invite-links (/join, /[slug])
// - mijn.ribba.app  → "Mijn Ribba": account/planner + de rest (login, upgrade,
//                     registreren, betaling, reset, legal, ...)

export const HOST = {
  chat: 'chat.ribba.app',
  referral: 'link.ribba.app',
  account: 'mijn.ribba.app',
} as const;

export const DOMAIN = {
  chat: `https://${HOST.chat}`,
  referral: `https://${HOST.referral}`,
  account: `https://${HOST.account}`,
} as const;

// Alle domeinen waarop de app zelf draait (voor de cross-domain linker en de
// middleware-hostcheck). Apex ribba.app is de vergelijkingssite (andere repo).
export const APP_HOSTS: readonly string[] = [HOST.chat, HOST.referral, HOST.account];

// Chat/marketplace-entry routes → chat.ribba.app
const CHAT_PREFIXES = ['/chat', '/i', '/r'];
// Referral/invite-links + partner-portal → link.ribba.app  (/[slug] blijft
// bewust ongeclassificeerd: een catch-all is in de middleware niet te
// onderscheiden van een typefout, dus die dwingen we niet af — invite-links
// worden al mét link.ribba.app gegenereerd.)
const REFERRAL_PREFIXES = ['/join', '/partner'];
// Account/planner + de rest → mijn.ribba.app
const ACCOUNT_PREFIXES = [
  '/login', '/upgrade', '/registreren', '/mijn-ribba', '/payment', '/reset',
  '/set-password', '/welkom', '/pro', '/rijschool-planner', '/verwerkersovereenkomst',
  '/privacy', '/voorwaarden', '/terms', '/admin', '/cal', '/parent-invite',
  '/support',
];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Canonieke host voor een paginaroute, of null als de route niet
// gecanonicaliseerd wordt (API's, _next, .well-known, root, /[slug], onbekend).
export function canonicalHostForPath(pathname: string): string | null {
  if (
    pathname === '/' ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/.well-known')
  ) {
    return null;
  }
  if (matches(pathname, CHAT_PREFIXES)) return HOST.chat;
  if (matches(pathname, REFERRAL_PREFIXES)) return HOST.referral;
  if (matches(pathname, ACCOUNT_PREFIXES)) return HOST.account;
  return null;
}
