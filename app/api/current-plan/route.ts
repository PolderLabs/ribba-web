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

    // Normaliseer DB-staat naar wat de frontend verwacht.
    // Contract met de Pro-app (geverifieerd): instructor_licenses.status blijft
    // altijd 'active'; trial-afloop = billing_plan-sentinel 'expired' (door
    // cron) of is_trial+trial_ends_at; opzegging = cancelled_at + period_end.
    const isPaidPlan = data.billing_plan === 'basic' || data.billing_plan === 'premium';

    // Lazy trial-check: niet wachten op de dagelijkse cron — als trial_ends_at
    // voorbij is, behandel het direct als expired (zelfde gedrag als PlanContext
    // in de Pro-app, voorkomt ~24u inconsistentie tussen app en website).
    const trialActuallyExpired = Boolean(
      data.is_trial &&
      data.trial_ends_at &&
      new Date(data.trial_ends_at) < new Date()
    );

    const cancelledAndPeriodEnded = Boolean(
      data.cancelled_at &&
      data.period_end &&
      new Date(data.period_end) < new Date()
    );

    const isExpired =
      trialActuallyExpired ||
      cancelledAndPeriodEnded ||
      (!isPaidPlan && !data.is_trial); // sentinel 'expired' of andere onbekende waarde

    return NextResponse.json({
      plan: isExpired || !isPaidPlan ? null : data.billing_plan,
      isTrial: Boolean(data.is_trial && !trialActuallyExpired),
      trialEndsAt: data.trial_ends_at,
      cancelledAt: data.cancelled_at,
      periodEnd: data.period_end,
      isExpired,
    });
  } catch {
    return NextResponse.json({ plan: null });
  }
}
