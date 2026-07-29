// GET /api/referral/school/setup-status — mandaatstatus voor de setup-pagina
// (polling na de Payment Element-redirect tot de webhook 'active' heeft gezet).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/partner-auth';

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }
  const { user, supabase } = authed;

  try {
    const { data: instructorRows } = await supabase
      .from('instructors')
      .select('drivingschool_id')
      .eq('user_id', user.id)
      .in('school_role', ['owner', 'admin']);
    const instructor = instructorRows?.[0];
    if (!instructor) {
      return NextResponse.json({ error: 'Geen rijschool gevonden.' }, { status: 403 });
    }

    const { data: program } = await supabase
      .from('referral_programs')
      .select('sepa_mandate_status')
      .eq('drivingschool_id', instructor.drivingschool_id)
      .maybeSingle();

    return NextResponse.json({
      sepa_mandate_status: program?.sepa_mandate_status ?? 'none',
    });
  } catch (e) {
    console.error('referral-setup-status error:', e);
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
