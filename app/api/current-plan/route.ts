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
    const { data, error } = await supabase
      .from('instructor_licenses')
      .select('billing_plan, is_trial, trial_ends_at')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      return NextResponse.json({ plan: null });
    }

    return NextResponse.json({
      plan: data.billing_plan,
      isTrial: data.is_trial,
      trialEndsAt: data.trial_ends_at,
    });
  } catch {
    return NextResponse.json({ plan: null });
  }
}
