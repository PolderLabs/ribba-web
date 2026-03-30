import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';

  // Route app.ribba.app root → /pro (leave other paths like /upgrade intact)
  if (
    (hostname === 'app.ribba.app' || hostname.startsWith('app.ribba.app:')) &&
    request.nextUrl.pathname === '/'
  ) {
    return NextResponse.rewrite(new URL('/pro', request.url));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
