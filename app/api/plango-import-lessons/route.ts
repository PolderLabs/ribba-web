import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const internalSecret = process.env.INTERNAL_FUNCTION_SECRET!;

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const debug: string[] = [];

  debug.push(`supabaseUrl: ${supabaseUrl ? 'aanwezig' : 'ONTBREEKT'}`);
  debug.push(`supabaseServiceKey: ${supabaseServiceKey ? 'aanwezig' : 'ONTBREEKT'}`);
  debug.push(`internalSecret: ${internalSecret ? 'aanwezig' : 'ONTBREEKT'}`);

  let body: {
    slug?: string;
    email?: string;
    password?: string;
    drivingschool_id?: string;
    admin_email?: string;
    admin_password?: string;
    mode?: 'lessons' | 'credit' | 'both';
    months_back?: number;
    months_forward?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ongeldige JSON body', debug }, { status: 400 });
  }

  const { slug, email, password, drivingschool_id, admin_email, admin_password, mode, months_back, months_forward } = body;

  debug.push(`admin_email: ${admin_email ?? 'ONTBREEKT'}`);
  debug.push(`mode: ${mode ?? 'both'} | back: ${months_back ?? 18}mnd | forward: ${months_forward ?? 6}mnd`);

  if (!admin_email || !admin_password) {
    return NextResponse.json({ error: 'Admin inloggegevens ontbreken', debug }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: admin_email,
    password: admin_password,
  });

  if (authError || !authData.user) {
    return NextResponse.json({
      error: `Ongeldige admin inloggegevens: ${authError?.message ?? 'geen user'}`,
      debug,
    }, { status: 401 });
  }

  if (authData.user.email !== 'onderates86@gmail.com') {
    return NextResponse.json({
      error: `Geen toegang — ingelogd als: ${authData.user.email}`,
      debug,
    }, { status: 403 });
  }

  if (!slug || !email || !password || !drivingschool_id) {
    return NextResponse.json({ error: 'Plango velden ontbreken', debug }, { status: 400 });
  }

  const edgeFunctionUrl = `${supabaseUrl}/functions/v1/plango-migrate-lessons`;
  debug.push(`edge function URL: ${edgeFunctionUrl}`);

  try {
    const res = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'x-service-key': supabaseServiceKey,
        ...(internalSecret ? { 'x-internal-secret': internalSecret } : {}),
      },
      body: JSON.stringify({
        slug, email, password, drivingschool_id,
        mode: mode ?? 'both',
        months_back: months_back ?? 18,
        months_forward: months_forward ?? 6,
      }),
    });

    debug.push(`edge function status: ${res.status}`);
    const data = await res.json();
    return NextResponse.json({ ...data, debug }, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Onbekende fout';
    return NextResponse.json(
      { success: false, error: `Edge function fout: ${message}`, debug, logs: [] },
      { status: 500 },
    );
  }
}
