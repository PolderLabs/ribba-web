// Daily trial reminder: stuur rijscholen waarvan de proefperiode over 7 of
// 1 dag afloopt een herinneringsmail met link naar /upgrade.
//
// Auth: Vercel Cron stuurt automatisch `Authorization: Bearer ${CRON_SECRET}`.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendTrialEndingReminderMail } from '@/lib/school-emails';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// YYYY-MM-DD voor `n` dagen vanaf nu (UTC).
function dateInDays(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const targets: Array<{ days: number; date: string }> = [
    { days: 7, date: dateInDays(7) },
    { days: 1, date: dateInDays(1) },
  ];

  const sent: Array<{ school_id: string; days: number; email: string }> = [];
  const failed: Array<{ school_id: string; days: number; reason: string }> = [];

  for (const { days, date } of targets) {
    // trial_ends_at valt op `date` (UTC) → range [date 00:00, date+1 00:00)
    const start = `${date}T00:00:00Z`;
    const endDate = new Date(`${date}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const end = endDate.toISOString();

    const { data: licenses, error } = await supabase
      .from('instructor_licenses')
      .select('id, school_id, trial_ends_at')
      .eq('status', 'active')
      .eq('is_trial', true)
      .gte('trial_ends_at', start)
      .lt('trial_ends_at', end);

    if (error) {
      console.error(`trial-reminder: query failed for day=${days}`, error);
      continue;
    }

    for (const license of licenses ?? []) {
      const { data: school } = await supabase
        .from('drivingschools')
        .select('id, name, email')
        .eq('id', license.school_id)
        .maybeSingle();

      if (!school?.email) {
        failed.push({ school_id: license.school_id, days, reason: 'no email' });
        continue;
      }

      try {
        await sendTrialEndingReminderMail(school.email, school.name, days);
        sent.push({ school_id: school.id, days, email: school.email });
        console.log(`trial-reminder: sent to ${school.email} (${days} days left)`);
      } catch (e) {
        failed.push({ school_id: school.id, days, reason: String(e).slice(0, 200) });
        console.error(`trial-reminder: send failed for ${school.email}:`, e);
      }
    }
  }

  return NextResponse.json({
    sent_count: sent.length,
    failed_count: failed.length,
    sent,
    failed,
  });
}
