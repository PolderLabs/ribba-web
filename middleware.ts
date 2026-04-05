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
  '/voorwaarden',
  '/privacy',
  '/verwerkersovereenkomst',
  '/terms',
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

  // On link.ribba.app: route root → /pro (landing page)
  if (isAppSubdomain && pathname === '/') {
    return NextResponse.rewrite(new URL('/pro', request.url));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
