// GET /api/partner/stripe/status — ververs de onboardingstatus van de partner
// direct bij Stripe. UX-versneller bij terugkeer van de hosted onboarding;
// de account.updated-webhook blijft het autoritatieve synchronisatiepad.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/partner-auth';
import { getStripe } from '@/lib/stripe';
import { syncPartnerAccountState } from '@/lib/referral-stripe';

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }
  const { user, supabase } = authed;

  try {
    const { data: partner } = await supabase
      .from('referral_partners')
      .select('id, stripe_account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!partner) {
      return NextResponse.json({ error: 'Geen partnerprofiel gevonden.' }, { status: 404 });
    }
    if (!partner.stripe_account_id) {
      return NextResponse.json({ payouts_enabled: false, stripe_onboarding_status: 'none' });
    }

    const account = await getStripe().accounts.retrieve(partner.stripe_account_id);
    const state = await syncPartnerAccountState(supabase, partner.id, account);
    return NextResponse.json(state);
  } catch (e) {
    console.error('partner-stripe-status error:', e);
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
