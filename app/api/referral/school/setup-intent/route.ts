// POST /api/referral/school/setup-intent — start de eenmalige SEPA-machtiging
// waarmee de rijschool bevestigde referral-payouts financiert. Maakt (zo
// nodig) het referral_programs-rijtje + de Stripe Customer aan en geeft een
// SetupIntent-client_secret terug voor het Payment Element op
// /mijn-ribba/referral/betaling. De setup_intent.succeeded-webhook zet de
// mandaatstatus op 'active'.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/partner-auth';
import { getStripe } from '@/lib/stripe';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`referral-setup:${ip}`, { maxRequests: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, { status: 429 });
  }

  const authed = await getAuthedUser(req);
  if (!authed) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }
  const { user, supabase } = authed;

  try {
    const body = await req.json().catch(() => ({}));
    const requestedSchoolId = typeof body?.school_id === 'string' ? body.school_id : null;

    // Alleen owner/admin mag de betaalinstelling doen.
    let query = supabase
      .from('instructors')
      .select('drivingschool_id, school_role')
      .eq('user_id', user.id)
      .in('school_role', ['owner', 'admin']);
    if (requestedSchoolId) {
      query = query.eq('drivingschool_id', requestedSchoolId);
    }
    const { data: instructorRows } = await query;
    const instructor = instructorRows?.[0];
    if (!instructor) {
      return NextResponse.json({ error: 'Geen rijschool gevonden waarvoor je dit mag instellen.' }, { status: 403 });
    }
    const schoolId = instructor.drivingschool_id;

    const { data: school } = await supabase
      .from('drivingschools')
      .select('id, name, email')
      .eq('id', schoolId)
      .single();
    if (!school) {
      return NextResponse.json({ error: 'Rijschool niet gevonden.' }, { status: 404 });
    }

    // Programma-rij mag al vóór de app-configuratie bestaan (betaling eerst).
    await supabase
      .from('referral_programs')
      .upsert({ drivingschool_id: schoolId }, { onConflict: 'drivingschool_id', ignoreDuplicates: true });
    const { data: program } = await supabase
      .from('referral_programs')
      .select('id, stripe_customer_id, sepa_mandate_status')
      .eq('drivingschool_id', schoolId)
      .single();
    if (!program) {
      return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
    }

    const stripe = getStripe();
    let customerId = program.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          name: school.name,
          email: school.email ?? undefined,
          metadata: { drivingschool_id: schoolId, referral_program_id: program.id },
        },
        { idempotencyKey: `referral-school-customer-${program.id}` },
      );
      customerId = customer.id;
      const { error: updateError } = await supabase
        .from('referral_programs')
        .update({
          stripe_customer_id: customerId,
          sepa_mandate_status: program.sepa_mandate_status === 'none' ? 'pending' : program.sepa_mandate_status,
        })
        .eq('id', program.id);
      if (updateError) {
        console.error('referral-setup-intent: customer opslaan mislukt', updateError.message);
        return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
      }
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['sepa_debit'],
      metadata: { referral_program_id: program.id, drivingschool_id: schoolId },
    });

    return NextResponse.json({
      client_secret: setupIntent.client_secret,
      school_id: schoolId,
      school_name: school.name,
    });
  } catch (e) {
    console.error('referral-setup-intent error:', e);
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
