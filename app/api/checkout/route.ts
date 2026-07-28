import { NextRequest, NextResponse } from 'next/server';
import { createMollieClient, SequenceType } from '@mollie/api-client';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { BASIC_MAX_STUDENTS, BASIC_MAX_INSTRUCTORS } from '@/lib/plan-limits';
import { logBillingEvent } from '@/lib/billing-events';
import {
  isPaidPlan,
  getPlanPricing,
  formatCentsForMollie,
  planDescription,
} from '@/lib/plan-pricing';

function getMollie() {
  return createMollieClient({ apiKey: process.env.MOLLIE_API_KEY! });
}

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`checkout:${ip}`, { maxRequests: 5, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, { status: 429 });
  }

  try {
    const { school_id, plan } = await request.json();

    // Fail-closed: alleen bekende betaalde plannen; nooit een fallback-bedrag.
    if (!school_id || !isPaidPlan(plan)) {
      return NextResponse.json(
        { error: 'school_id en plan (basic/premium) zijn verplicht.' },
        { status: 400 },
      );
    }

    // Verify the caller owns this school
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
    }
    const { data: { user }, error: authError } = await getSupabase().auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      return NextResponse.json({ error: 'Ongeldige sessie.' }, { status: 401 });
    }
    // Toegang ÉN bevoegdheid: EIGENAAR-ONLY (fase 2a, productbesluit 27 jul).
    //
    // Een abonnement is een juridische en financiële verplichting van de
    // ondernemíng; de eigenaar vertegenwoordigt die. Een admin bestuurt de
    // dagelijkse operatie en mag de abonnementsinformatie zien, maar hem niet
    // wijzigen. Historie: tot 25 jul volstond "actieve instructeur", fase 0
    // versmalde naar owner|admin omdat zeven rijscholen nog geen eigenaar
    // hadden; migratie B (28 jul) gaf elke school er een.
    // Zie docs/design/schoollicentie-epic-canoniek-plan-2026-07-25.md in ribbaPro.
    const { data: instructor } = await getSupabase()
      .from('instructors')
      .select('id')
      .eq('user_id', user.id)
      .eq('drivingschool_id', school_id)
      .eq('status', 'active')
      .eq('school_role', 'owner')
      .maybeSingle();
    if (!instructor) {
      return NextResponse.json(
        {
          error: 'Alleen de eigenaar van deze rijschool kan het abonnement beheren.',
          reason: 'subscription_management_forbidden',
        },
        { status: 403 },
      );
    }

    // Prijzen zijn excl. 21% btw; Mollie incasseert het bruto bedrag (SSoT).
    const pricing = getPlanPricing(plan);

    // Get school info for Mollie customer name
    const { data: school } = await getSupabase()
      .from('drivingschools')
      .select('name, email')
      .eq('id', school_id)
      .single();

    if (!school) {
      return NextResponse.json(
        { error: 'Rijschool niet gevonden.' },
        { status: 404 },
      );
    }

    // Check if school already has a Mollie customer
    const { data: license } = await getSupabase()
      .from('instructor_licenses')
      .select('id, mollie_customer_id, external_subscription_id, billing_plan')
      .eq('school_id', school_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Basic-limietcheck: ALTIJD uitvoeren bij keuze voor Basic, niet alleen
    // bij downgrade van Premium. Voorkomt dat een school met >30 leerlingen of
    // >1 instructeur (vanuit trial/expired/nieuw) alsnog Basic kan afsluiten.
    // Zie handoff: docs/handoff/abonnement-leerling-limiet-billing.md in ribbaPro.
    if (plan === 'basic') {
      // Tel vlak vóór checkout (geen gecachte waarde), zoals de handoff vraagt.
      const { count: studentCount } = await getSupabase()
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('drivingschool_id', school_id)
        .eq('status', 'active');

      const { count: instructorCount } = await getSupabase()
        .from('instructors')
        .select('id', { count: 'exact', head: true })
        .eq('drivingschool_id', school_id)
        .eq('status', 'active');

      const activeStudents = studentCount ?? 0;
      const activeInstructors = instructorCount ?? 0;

      if (activeStudents > BASIC_MAX_STUDENTS) {
        return NextResponse.json(
          {
            error: `Je rijschool heeft ${activeStudents} actieve leerlingen (max ${BASIC_MAX_STUDENTS} voor Basic). Kies Premium, of archiveer leerlingen tot ${BASIC_MAX_STUDENTS} en probeer opnieuw.`,
            reason: 'basic_student_limit_exceeded',
            active_students: activeStudents,
            limit: BASIC_MAX_STUDENTS,
          },
          { status: 400 },
        );
      }
      if (activeInstructors > BASIC_MAX_INSTRUCTORS) {
        return NextResponse.json(
          {
            error: `Je rijschool heeft ${activeInstructors} actieve instructeurs (max ${BASIC_MAX_INSTRUCTORS} voor Basic). Kies Premium om met meerdere instructeurs te werken.`,
            reason: 'basic_instructor_limit_exceeded',
            active_instructors: activeInstructors,
            limit: BASIC_MAX_INSTRUCTORS,
          },
          { status: 400 },
        );
      }
    }

    // B1: de eventuele oude subscription NIET meer direct hier cancelen.
    // Als de user de iDEAL-flow afbreekt, zou de oude sub anders al dood zijn
    // terwijl de nieuwe nooit is aangemaakt → school raakt toegang kwijt zonder
    // waarschuwing. In plaats daarvan geven we de oude subscription-id mee als
    // `replaces_subscription_id` in de payment.metadata; de webhook cancelt 'm
    // pas nadat de nieuwe subscription succesvol is aangemaakt (in mollie-webhook).
    const replacesSubscriptionId = license?.external_subscription_id ?? null;

    let mollieCustomerId = license?.mollie_customer_id;

    // Create Mollie customer if not exists
    if (!mollieCustomerId) {
      const customer = await getMollie().customers.create({
        name: school.name,
        email: school.email || undefined,
        metadata: JSON.stringify({ school_id }),
      });
      mollieCustomerId = customer.id;

      // Store Mollie customer ID
      if (license) {
        await getSupabase()
          .from('instructor_licenses')
          .update({ mollie_customer_id: mollieCustomerId })
          .eq('id', license.id);
      }
    }

    // Create first payment (iDEAL) — this establishes the SEPA mandate
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ribba.app';
    const payment = await getMollie().payments.create({
      amount: { currency: 'EUR', value: formatCentsForMollie(pricing.grossMonthlyCents) },
      description: planDescription(pricing.plan),
      customerId: mollieCustomerId,
      sequenceType: SequenceType.first,
      redirectUrl: `${baseUrl}/upgrade/success?school_id=${school_id}&plan=${plan}`,
      webhookUrl: `${baseUrl}/api/mollie-webhook`,
      metadata: JSON.stringify({
        school_id,
        plan,
        type: 'subscription_setup',
        replaces_subscription_id: replacesSubscriptionId,
      }),
    });

    await logBillingEvent({
      school_id,
      event_type: 'checkout_initiated',
      source: 'checkout',
      payload: {
        plan,
        payment_id: payment.id,
        mollie_customer_id: mollieCustomerId,
        previous_billing_plan: license?.billing_plan ?? null,
        replaces_subscription_id: replacesSubscriptionId,
      },
    });

    return NextResponse.json({
      checkoutUrl: payment.getCheckoutUrl(),
      paymentId: payment.id,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: 'Er ging iets mis bij het aanmaken van de betaling.' },
      { status: 500 },
    );
  }
}
