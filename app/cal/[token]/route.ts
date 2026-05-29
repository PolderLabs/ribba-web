// Edge-runtime proxy: link.ribba.app/cal/{token}.ics → Supabase ical-feed
// Verbergt de Supabase URL voor eindgebruikers en geeft een nette
// ribba.app-link die ze in Apple Calendar / Google / Outlook kunnen
// toevoegen.
//
// Belangrijk: dit is een PROXY (haalt body op en serveert die), geen redirect —
// veel calendar-apps (Apple Calendar, Outlook) volgen geen redirects voor .ics.

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

const SUPABASE_ICAL_URL =
  'https://vsuhctqdtsxyimzsbjds.supabase.co/functions/v1/ical-feed';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // Strip eventuele .ics suffix zodat /cal/abc.ics → token=abc werkt
  const cleanToken = token.replace(/\.ics$/i, '');

  if (!/^[a-f0-9-]{36}$/i.test(cleanToken)) {
    return new Response('Ongeldig token formaat.', { status: 400 });
  }

  const upstream = await fetch(
    `${SUPABASE_ICAL_URL}?token=${encodeURIComponent(cleanToken)}`,
  );
  const body = await upstream.text();

  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type':
        upstream.headers.get('Content-Type') ?? 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ribba-agenda.ics"',
      'Cache-Control': upstream.headers.get('Cache-Control') ?? 'max-age=900',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
