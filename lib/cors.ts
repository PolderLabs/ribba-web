// CORS voor endpoints die door de statische vergelijkingssite (ribba.app,
// GitHub Pages) cross-origin aangeroepen worden.

const ALLOWED_ORIGINS = new Set([
  'https://ribba.app',
  'https://www.ribba.app',
]);

// Astro draait lokaal op :4321, Next op :3000.
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.add('http://localhost:4321');
  ALLOWED_ORIGINS.add('http://localhost:3000');
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function corsPreflight(origin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
