import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(req: NextRequest) {
  const schoolId = req.nextUrl.searchParams.get('school_id');
  if (!schoolId) {
    return NextResponse.json({ error: 'school_id is verplicht.' }, { status: 400 });
  }

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
      .select('id')
      .eq('user_id', user.id)
      .eq('drivingschool_id', schoolId)
      .eq('status', 'active')
      .maybeSingle();
    if (!instructor) {
      return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 });
    }

    const [{ count: studentCount }, { count: instructorCount }] = await Promise.all([
      supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('drivingschool_id', schoolId)
        .eq('status', 'active'),
      supabase
        .from('instructors')
        .select('id', { count: 'exact', head: true })
        .eq('drivingschool_id', schoolId)
        .eq('status', 'active'),
    ]);

    return NextResponse.json({
      active_students: studentCount ?? 0,
      active_instructors: instructorCount ?? 0,
    });
  } catch {
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
