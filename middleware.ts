import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { APP_HOSTS, canonicalHostForPath } from '@/lib/domains';

// Drie domeinen, één app. Elke paginaroute heeft een canonieke host
// (zie lib/domains.ts). Bezoek je een route op het verkeerde domein, dan
// 308-redirecten we naar het juiste. API-routes, _next en .well-known worden
// NIET geredirect (canonicalHostForPath geeft daar null) zodat same-origin
// fetches, webhooks, cron en per-host AASA blijven werken.
//
// De vergelijkingssite draait op apex ribba.app (andere repo). Komt een
// app-route toch op ribba.app binnen, dan sturen we die ook naar zijn
// canonieke host.

function normalizeHost(hostHeader: string): string {
  return hostHeader.split(':')[0].toLowerCase();
}

export function middleware(request: NextRequest) {
  const host = normalizeHost(request.headers.get('host') || '');
  const pathname = request.nextUrl.pathname;

  const canonical = canonicalHostForPath(pathname);
  if (!canonical) return;

  const isAppHost = APP_HOSTS.includes(host);
  const isMainDomain = host === 'ribba.app' || host === 'www.ribba.app';

  // Alleen redirecten als we op een van onze hosts zitten (of het apex-vangnet)
  // én de host niet al canoniek is. Lokale dev (localhost) laten we met rust.
  if ((isAppHost || isMainDomain) && host !== canonical) {
    const url = new URL(request.url);
    url.hostname = canonical;
    url.port = '';
    url.protocol = 'https:'; // canonieke domeinen zijn https-only
    return NextResponse.redirect(url, 308);
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
