import { NextRequest, NextResponse } from 'next/server';
import { createMollieClient } from '@mollie/api-client';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { sendAdminNotification } from '@/lib/admin-notifications';
import { logBillingEvent } from '@/lib/billing-events';

function getMollie() {
  return createMollieClient({ apiKey: process.env.MOLLIE_API_KEY! });
}

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`cancel:${ip}`, { maxRequests: 5, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, { status: 429 });
  }

  try {
    const { school_id } = await request.json();
    if (!school_id) {
      return NextResponse.json({ error: 'school_id is verplicht.' }, { status: 400 });
    }

    // Verify the caller owns this school
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
    }
    const supabase = getSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      return NextResponse.json({ error: 'Ongeldige sessie.' }, { status: 401 });
    }
    const { data: instructor } = await supabase
      .from('instructors')
      .select('id')
      .eq('user_id', user.id)
      .eq('drivingschool_id', school_id)
      .eq('status', 'active')
      .maybeSingle();
    if (!instructor) {
      return NextResponse.json({ error: 'Geen toegang tot deze rijschool.' }, { status: 403 });
    }

    // Fetch the active license for this school
    const { data: license } = await supabase
      .from('instructor_licenses')
      .select('id, mollie_customer_id, external_subscription_id, billing_plan')
      .eq('school_id', school_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!license?.external_subscription_id || !license?.mollie_customer_id) {
      return NextResponse.json({ error: 'Geen actief abonnement gevonden.' }, { status: 404 });
    }

    // Cancel the Mollie subscription — no more charges will happen.
    // Mollie does not automatically end the current period; the plan stays active
    // until we mark it ended based on the stored next billing date.
    try {
      await getMollie().customerSubscriptions.cancel(license.external_subscription_id, {
        customerId: license.mollie_customer_id,
      });
    } catch (cancelErr) {
      console.warn('Mollie cancel failed (may already be cancelled):', cancelErr);
    }

    // Mark the license as cancelled (still active until the end of the paid period).
    // `cancelled_at` = when cancellation was requested. The monthly job or webhook
    // should downgrade access once the current paid period ends.
    await supabase
      .from('instructor_licenses')
      .update({
        cancelled_at: new Date().toISOString(),
        external_subscription_id: null,
      })
      .eq('id', license.id);

    await logBillingEvent({
      school_id,
      event_type: 'subscription_cancelled',
      source: 'cancel-subscription',
      payload: {
        billing_plan: license.billing_plan,
        cancelled_external_subscription_id: license.external_subscription_id,
        mollie_customer_id: license.mollie_customer_id,
      },
    });

    // Admin notification — fire-and-forget
    try {
      const { data: schoolRow } = await supabase
        .from('drivingschools')
        .select('name, email, city')
        .eq('id', school_id)
        .maybeSingle();
      if (schoolRow) {
        sendAdminNotification('subscription_cancelled', {
          id: school_id,
          name: schoolRow.name,
          email: schoolRow.email,
          city: schoolRow.city,
          billing_plan: license.billing_plan,
        }).catch((e) => console.error('Admin notify (subscription_cancelled) failed:', e));
      }
    } catch (e) {
      console.error('Admin notify lookup failed:', e);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return NextResponse.json({ error: 'Er ging iets mis bij het annuleren.' }, { status: 500 });
  }
}
