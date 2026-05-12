import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const internalSecret = process.env.INTERNAL_FUNCTION_SECRET!;

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let body: {
    slug?: string;
    email?: string;
    password?: string;
    drivingschool_id?: string;
    admin_email?: string;
    admin_password?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ongeldige JSON body' }, { status: 400 });
  }

  const { slug, email, password, drivingschool_id, admin_email, admin_password } = body;

  // Verify admin credentials server-side — no JWT tokens needed
  if (!admin_email || !admin_password) {
    return NextResponse.json({ error: 'Admin inloggegevens ontbreken' }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: admin_email,
    password: admin_password,
  });

  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Ongeldige admin inloggegevens' }, { status: 401 });
  }

  if (authData.user.email !== 'onderates86@gmail.com') {
    return NextResponse.json({ error: 'Geen toegang' }, { status: 403 });
  }

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
