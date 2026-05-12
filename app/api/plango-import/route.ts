import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const internalSecret = process.env.INTERNAL_FUNCTION_SECRET!;

export const maxDuration = 300; // 5 min — Vercel Pro timeout

export async function POST(request: NextRequest) {
  // Verify the caller is the Ribba admin
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 });
  }

  // Verify token via Supabase and check it's the admin account
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: 'Ongeldige sessie' }, { status: 401 });
  }

  if (user.email !== 'onderates86@gmail.com') {
    return NextResponse.json({ error: 'Geen toegang' }, { status: 403 });
  }

  // Parse request body
  let body: { slug?: string; email?: string; password?: string; drivingschool_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ongeldige JSON body' }, { status: 400 });
  }

  const { slug, email, password, drivingschool_id } = body;
  if (!slug || !email || !password || !drivingschool_id) {
    return NextResponse.json(
      { error: 'slug, email, password en drivingschool_id zijn verplicht' },
      { status: 400 },
    );
  }

  // Proxy to Supabase edge function
  const edgeFunctionUrl = `${supabaseUrl}/functions/v1/plango-migrate`;

  try {
    const res = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalSecret,
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ slug, email, password, drivingschool_id }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Onbekende fout';
    return NextResponse.json(
      { success: false, error: `Edge function fout: ${message}`, logs: [] },
      { status: 500 },
    );
  }
}
