import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }

  try {
    const supabase = getSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) {
      return NextResponse.json({ error: 'Ongeldige sessie.' }, { status: 401 });
    }

    const { data: instructor } = await supabase
      .from('instructors')
      .select('drivingschool_id, drivingschools(name)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (!instructor) {
      return NextResponse.json({ error: 'Geen rijschool gekoppeld.' }, { status: 404 });
    }

    const school = Array.isArray(instructor.drivingschools)
      ? instructor.drivingschools[0]
      : instructor.drivingschools;

    return NextResponse.json({
      school_id: instructor.drivingschool_id,
      school_name: school?.name ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
