// Referral-attributie op de leerling-inschrijving (/api/register).
// Best-effort by design: een fout hier mag de registratie NOOIT laten falen —
// de caller wikkelt recordReferralAttribution al niet in een try/catch,
// dus deze module vangt alles zelf af en logt alleen.
//
// Regels (zie supabase/migrations/20260729000000_referral_program.sql):
// - code moet horen bij een actieve membership van DEZE school, met een
//   actief programma (code van school A op het formulier van school B → negeren);
// - self-referral (partner-e-mail == leerling-e-mail) → negeren;
// - eerste attributie wint: INSERT ... ON CONFLICT (student_id) DO NOTHING;
// - reward_snapshot wordt bij attributie bevroren (configwijziging raakt
//   bestaande referrals niet).

import { createClient } from '@supabase/supabase-js';
import { logBillingEvent } from '@/lib/billing-events';
import { sendPartnerReferralRegisteredMail } from '@/lib/referral-emails';
import type { RewardSnapshotItem } from '@/lib/referral-types';

const CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface AttributionInput {
  refCode: unknown; // raw uit de request-body
  drivingschoolId: string;
  schoolName: string;
  studentId: string;
  firstName: string;
  email: string;
}

export async function recordReferralAttribution(input: AttributionInput): Promise<void> {
  try {
    if (typeof input.refCode !== 'string') return;
    const code = input.refCode.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) return;

    const supabase = getSupabase();

    const { data: membership } = await supabase
      .from('referral_partner_memberships')
      .select('id, partner_id, drivingschool_id, status')
      .eq('code', code)
      .eq('status', 'active')
      .maybeSingle();
    if (!membership || membership.drivingschool_id !== input.drivingschoolId) return;

    const { data: program } = await supabase
      .from('referral_programs')
      .select('id, status')
      .eq('drivingschool_id', input.drivingschoolId)
      .eq('status', 'active')
      .maybeSingle();
    if (!program) return;

    const { data: partner } = await supabase
      .from('referral_partners')
      .select('id, email')
      .eq('id', membership.partner_id)
      .maybeSingle();
    if (!partner) return;

    const studentEmail = input.email.trim().toLowerCase();
    if (partner.email.trim().toLowerCase() === studentEmail) return; // self-referral

    const { data: rewards } = await supabase
      .from('referral_program_rewards')
      .select('milestone, reward_kind, amount_cents')
      .eq('program_id', program.id);
    const snapshot: RewardSnapshotItem[] = rewards ?? [];

    // Eerste attributie wint; hersubmissies dupliceren niet.
    const { data: inserted, error: insertError } = await supabase
      .from('referrals')
      .upsert(
        {
          membership_id: membership.id,
          partner_id: membership.partner_id,
          drivingschool_id: input.drivingschoolId,
          student_id: input.studentId,
          referred_first_name: input.firstName.trim(),
          referred_email: studentEmail,
          reward_snapshot: snapshot,
        },
        { onConflict: 'student_id', ignoreDuplicates: true },
      )
      .select('id');

    if (insertError) {
      console.error('referral-attribution insert failed:', insertError.message);
      return;
    }
    if (!inserted || inserted.length === 0) return; // al eerder geattribueerd

    await logBillingEvent({
      school_id: input.drivingschoolId,
      event_type: 'referral_attributed',
      source: 'register',
      payload: { referral_id: inserted[0].id, membership_id: membership.id, code },
    });

    await sendPartnerReferralRegisteredMail({
      schoolId: input.drivingschoolId,
      partnerEmail: partner.email,
      schoolName: input.schoolName,
      referredFirstName: input.firstName.trim(),
    });
  } catch (e) {
    console.error('referral-attribution unexpected error:', String(e).slice(0, 300));
  }
}
