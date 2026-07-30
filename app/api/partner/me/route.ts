// GET /api/partner/me — dashboard-payload voor de partner-portal.
// Service-role reads, server-side geshaped/gemaskeerd: referrals bevatten
// alleen de voornaam-snapshot (nooit referred_email of andere leerling-PII).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/partner-auth';
import { DOMAIN } from '@/lib/domains';
import type {
  ReferralPayoutRow,
  ReferralRow,
} from '@/lib/referral-types';

// Statussen die meetellen als "in behandeling" (verdiend maar nog niet op de
// rekening): milestone gehaald t/m incasso geslaagd.
const PENDING_STATUSES = ['pending', 'confirmed', 'charging', 'charged'];

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }
  const { user, supabase } = authed;

  try {
    const { data: partner } = await supabase
      .from('referral_partners')
      .select('id, email, display_name, stripe_account_id, stripe_onboarding_status, payouts_enabled')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!partner) {
      return NextResponse.json({ partner: null, memberships: [] });
    }

    const [{ data: memberships }, { data: referrals }, { data: payouts }] = await Promise.all([
      supabase
        .from('referral_partner_memberships')
        .select('id, code, status, drivingschool_id, drivingschools(name, registration_slug)')
        .eq('partner_id', partner.id),
      supabase
        .from('referrals')
        .select('id, membership_id, referred_first_name, status, registered_at, proefles_at, eerste_betaalde_les_at')
        .eq('partner_id', partner.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('referral_payouts')
        .select('id, membership_id, referral_id, milestone, reward_kind, amount_cents, currency, status, confirmed_at, paid_at, created_at')
        .eq('partner_id', partner.id)
        .order('created_at', { ascending: false }),
    ]);

    type ReferralSlice = Pick<
      ReferralRow,
      'id' | 'membership_id' | 'referred_first_name' | 'status' | 'registered_at' | 'proefles_at' | 'eerste_betaalde_les_at'
    >;
    type PayoutSlice = Pick<
      ReferralPayoutRow,
      'id' | 'membership_id' | 'referral_id' | 'milestone' | 'reward_kind' | 'amount_cents' | 'currency' | 'status' | 'confirmed_at' | 'paid_at' | 'created_at'
    >;

    const allReferrals = (referrals ?? []) as ReferralSlice[];
    const allPayouts = (payouts ?? []) as PayoutSlice[];

    const shaped = (memberships ?? []).map((m) => {
      const school = Array.isArray(m.drivingschools) ? m.drivingschools[0] : m.drivingschools;
      const memberReferrals = allReferrals.filter((r) => r.membership_id === m.id);
      const memberPayouts = allPayouts.filter((p) => p.membership_id === m.id);

      const earnedCents = memberPayouts
        .filter((p) => p.status === 'paid' && p.reward_kind === 'cash')
        .reduce((sum, p) => sum + (p.amount_cents ?? 0), 0);
      const pendingCents = memberPayouts
        .filter((p) => PENDING_STATUSES.includes(p.status) && p.reward_kind === 'cash')
        .reduce((sum, p) => sum + (p.amount_cents ?? 0), 0);

      return {
        membership_id: m.id,
        code: m.code,
        status: m.status,
        school_name: school?.name ?? null,
        referral_url: school?.registration_slug
          ? `${DOMAIN.referral}/${school.registration_slug}?ref=${m.code}`
          : null,
        counts: {
          registered: memberReferrals.filter((r) => r.status === 'registered').length,
          proefles: memberReferrals.filter((r) => r.status === 'proefles').length,
          eerste_betaalde_les: memberReferrals.filter((r) => r.status === 'eerste_betaalde_les').length,
        },
        earned_cents: earnedCents,
        pending_cents: pendingCents,
        referrals: memberReferrals.map((r) => ({
          id: r.id,
          first_name: r.referred_first_name,
          status: r.status,
          registered_at: r.registered_at,
        })),
        payouts: memberPayouts.map((p) => ({
          id: p.id,
          milestone: p.milestone,
          reward_kind: p.reward_kind,
          amount_cents: p.amount_cents,
          status: p.status,
          confirmed_at: p.confirmed_at,
          paid_at: p.paid_at,
          created_at: p.created_at,
        })),
      };
    });

    // Onboarding is pas relevant zodra er een cash-payout bestaat (of gaat
    // ontstaan): zonder cash-rewards is er niets uit te betalen.
    const hasCashPayouts = allPayouts.some((p) => p.reward_kind === 'cash');

    return NextResponse.json({
      partner: {
        email: partner.email,
        display_name: partner.display_name,
        payouts_enabled: partner.payouts_enabled,
        stripe_onboarding_status: partner.stripe_onboarding_status,
        needs_onboarding: hasCashPayouts && !partner.payouts_enabled,
      },
      memberships: shaped,
    });
  } catch (e) {
    console.error('partner-me error:', e);
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
