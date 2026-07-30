// GET /api/referral/school/mandate-options — welke mandaat-routes heeft deze
// school? Voedt /mijn-ribba/referral/betaling: is er al een sepa_debit-mandaat
// op de billing-customer van het abonnement, dan kan de eigenaar die met één
// bevestiging adopteren i.p.v. een tweede machtiging af te geven. Alleen de
// last4 gaat naar de client; de adopt-route resolvet de payment method
// altijd opnieuw server-side.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, getAdminSchoolId } from '@/lib/partner-auth';
import { getStripe } from '@/lib/stripe';
import { findAdoptableBillingMandate } from '@/lib/referral-billing-mandate';

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }
  const { user, supabase } = authed;

  try {
    const schoolId = await getAdminSchoolId(supabase, user.id);
    if (!schoolId) {
      return NextResponse.json({ error: 'Geen rijschool gevonden.' }, { status: 403 });
    }

    const { data: program } = await supabase
      .from('referral_programs')
      .select('sepa_mandate_status')
      .eq('drivingschool_id', schoolId)
      .maybeSingle();
    const mandateStatus = program?.sepa_mandate_status ?? 'none';

    if (mandateStatus === 'active') {
      return NextResponse.json({ sepa_mandate_status: 'active', existing_mandate: null });
    }

    const adoptable = await findAdoptableBillingMandate(supabase, getStripe(), schoolId);
    return NextResponse.json({
      sepa_mandate_status: mandateStatus,
      existing_mandate: adoptable ? { last4: adoptable.last4 } : null,
    });
  } catch (e) {
    console.error('referral-mandate-options error:', e);
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
