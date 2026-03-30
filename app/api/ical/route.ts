import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy voor de iCal feed.
 * Kort URL: app.ribba.app/api/ical?t=TOKEN
 * → redirect naar Supabase Edge Function: /functions/v1/ical-feed?token=TOKEN
 *
 * Agenda-apps (iCloud, Google) volgen de redirect en cachen de feed.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('t');

  if (!token) {
    return NextResponse.json({ error: 'Token ontbreekt' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const target = `${supabaseUrl}/functions/v1/ical-feed?token=${token}`;

  return NextResponse.redirect(target, 301);
}
