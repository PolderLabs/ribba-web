import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const schoolId = req.nextUrl.searchParams.get('school_id');

  if (!schoolId) {
    return NextResponse.json({ plan: null });
  }

  try {
    const supabase = getSupabase();

    // Verify the caller owns this school
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
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
    const { data, error } = await supabase
      .from('instructor_licenses')
      .select('billing_plan, is_trial, trial_ends_at, cancelled_at, period_end')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      return NextResponse.json({ plan: null });
    }

    // If cancelled and period_end has passed, the subscription has expired
    const isExpired =
      data.cancelled_at &&
      data.period_end &&
      new Date(data.period_end) < new Date();

    return NextResponse.json({
      plan: isExpired ? null : data.billing_plan,
      isTrial: data.is_trial,
      trialEndsAt: data.trial_ends_at,
      cancelledAt: data.cancelled_at,
      periodEnd: data.period_end,
      isExpired: Boolean(isExpired),
    });
  } catch {
    return NextResponse.json({ plan: null });
  }
}
