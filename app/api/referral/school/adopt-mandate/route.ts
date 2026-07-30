// POST /api/referral/school/adopt-mandate — de eigenaar bevestigt expliciet
// dat de bestaande SEPA-machtiging van het Ribba-abonnement óók voor
// referral-uitbetalingen gebruikt mag worden. Geen nieuwe checkout: we
// koppelen de billing-customer + sepa_debit payment method aan
// referral_programs en zetten het mandaat op 'active'.
//
// De bevestigingsklik is bewust een aparte stap (ander doel + variabele
// bedragen). Consent wordt vastgelegd op de programma-rij
// (sepa_mandate_adopted_at/_by) én in billing_events. De payment method wordt
// hier server-side opnieuw geresolved — client-input bepaalt nooit wélk
// mandaat er gekoppeld wordt.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, getAdminSchoolId } from '@/lib/partner-auth';
import { getStripe } from '@/lib/stripe';
import { findAdoptableBillingMandate } from '@/lib/referral-billing-mandate';
import { logBillingEvent } from '@/lib/billing-events';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`referral-adopt:${ip}`, { maxRequests: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, { status: 429 });
  }

  const authed = await getAuthedUser(req);
  if (!authed) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }
  const { user, supabase } = authed;

  try {
    const body = await req.json().catch(() => ({}));
    const schoolId = await getAdminSchoolId(
      supabase,
      user.id,
      typeof body?.school_id === 'string' ? body.school_id : null,
    );
    if (!schoolId) {
      return NextResponse.json({ error: 'Geen rijschool gevonden waarvoor je dit mag instellen.' }, { status: 403 });
    }

    const adoptable = await findAdoptableBillingMandate(supabase, getStripe(), schoolId);
    if (!adoptable) {
      return NextResponse.json(
        { error: 'Geen bestaande SEPA-machtiging gevonden om te hergebruiken.' },
        { status: 404 },
      );
    }

    // Programma-rij mag al vóór de app-configuratie bestaan (betaling eerst).
    await supabase
      .from('referral_programs')
      .upsert({ drivingschool_id: schoolId }, { onConflict: 'drivingschool_id', ignoreDuplicates: true });

    const { data: updated, error: updateError } = await supabase
      .from('referral_programs')
      .update({
        stripe_customer_id: adoptable.customerId,
        stripe_payment_method_id: adoptable.paymentMethodId,
        sepa_mandate_status: 'active',
        sepa_mandate_adopted_at: new Date().toISOString(),
        sepa_mandate_adopted_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('drivingschool_id', schoolId)
      .select('id');
    if (updateError || !updated || updated.length === 0) {
      console.error('referral-adopt-mandate: update mislukt', updateError?.message);
      return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
    }

    await logBillingEvent({
      school_id: schoolId,
      event_type: 'referral_mandate_adopted',
      source: 'referral-adopt-mandate',
      payload: {
        program_id: updated[0].id,
        stripe_customer_id: adoptable.customerId,
        payment_method_last4: adoptable.last4,
        adopted_by: user.id,
      },
    });

    return NextResponse.json({ sepa_mandate_status: 'active', last4: adoptable.last4 });
  } catch (e) {
    console.error('referral-adopt-mandate error:', e);
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
