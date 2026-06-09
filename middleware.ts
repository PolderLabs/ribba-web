import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes owned by the Rijschool Planner (this repo).
// When accessed on the main domain (ribba.app), we redirect to link.ribba.app
// to avoid conflicts with the comparison site that lives on ribba.app.
const PLANNER_ROUTES = [
  '/pro',
  '/login',
  '/upgrade',
  '/registreren',
  '/rijschool-planner',
  '/verwerkersovereenkomst',
  '/payment',
  '/reset',
  '/join',
];

function isPlannerRoute(pathname: string): boolean {
  return PLANNER_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  const pathname = request.nextUrl.pathname;
  const isAppSubdomain = hostname === 'link.ribba.app' || hostname.startsWith('link.ribba.app:');
  const isMainDomain = hostname === 'ribba.app' || hostname.startsWith('ribba.app:');

  // On ribba.app: redirect planner routes to link.ribba.app
  if (isMainDomain && isPlannerRoute(pathname)) {
    const url = new URL(request.url);
    url.hostname = 'link.ribba.app';
    return NextResponse.redirect(url, 308);
  }

  // Root path on link.ribba.app is handled by app/page.tsx so we can inspect
  // the URL hash (e.g. Supabase auth-reset tokens) before redirecting away.
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
