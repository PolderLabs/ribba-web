import { NextRequest, NextResponse } from 'next/server';
import { createMollieClient, SequenceType } from '@mollie/api-client';
import { createClient } from '@supabase/supabase-js';

function getMollie() {
  return createMollieClient({ apiKey: process.env.MOLLIE_API_KEY! });
}

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const PLANS = {
  basic: { amount: '25.00', description: 'Ribba Basic – Maandabonnement' },
  premium: { amount: '45.00', description: 'Ribba Premium – Maandabonnement' },
} as const;

export async function POST(request: NextRequest) {
  try {
    const { school_id, plan } = await request.json();

    if (!school_id || !plan || !(plan in PLANS)) {
      return NextResponse.json(
        { error: 'school_id en plan (basic/premium) zijn verplicht.' },
        { status: 400 },
      );
    }

    const planInfo = PLANS[plan as keyof typeof PLANS];

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

    // Prevent downgrade via checkout (must meet limits first)
    if (license?.billing_plan === 'premium' && plan === 'basic') {
      // Count active students for this school
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

      if ((studentCount ?? 0) > 30) {
        return NextResponse.json(
          { error: `Je hebt ${studentCount} actieve leerlingen. Verlaag dit naar maximaal 30 om naar Basic te kunnen wisselen.` },
          { status: 400 },
        );
      }
      if ((instructorCount ?? 0) > 1) {
        return NextResponse.json(
          { error: `Je hebt ${instructorCount} actieve instructeurs. Basic ondersteunt maximaal 1 instructeur.` },
          { status: 400 },
        );
      }
    }

    // Cancel existing Mollie subscription if upgrading/changing plan
    if (license?.external_subscription_id && license?.mollie_customer_id) {
      try {
        await getMollie().customerSubscriptions.cancel(
          license.external_subscription_id,
          { customerId: license.mollie_customer_id },
        );
        console.log(`Cancelled old subscription ${license.external_subscription_id} for plan change`);
      } catch (cancelErr) {
        console.warn('Could not cancel old subscription (may already be cancelled):', cancelErr);
      }
    }

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
      amount: { currency: 'EUR', value: planInfo.amount },
      description: planInfo.description,
      customerId: mollieCustomerId,
      sequenceType: SequenceType.first,
      redirectUrl: `${baseUrl}/upgrade/success?school_id=${school_id}&plan=${plan}`,
      webhookUrl: `${baseUrl}/api/mollie-webhook`,
      metadata: JSON.stringify({ school_id, plan, type: 'subscription_setup' }),
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
