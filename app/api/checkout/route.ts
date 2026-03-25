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
  basic: { amount: '29.00', description: 'Ribba Basic – Maandabonnement' },
  premium: { amount: '59.00', description: 'Ribba Premium – Maandabonnement' },
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
      .select('id, mollie_customer_id')
      .eq('school_id', school_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

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
