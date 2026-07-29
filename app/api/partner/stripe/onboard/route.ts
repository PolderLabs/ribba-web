// POST /api/partner/stripe/onboard — maak (zo nodig) een Stripe Express
// connected account voor de partner en geef een Account Link terug voor de
// Stripe-hosted onboarding/KYC. Partners ontvangen alleen transfers, dus het
// recipient-service-agreement volstaat (lichtste KYC-profiel; geen
// card_payments-capability).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/partner-auth';
import { getStripe } from '@/lib/stripe';
import { rateLimit } from '@/lib/rate-limit';
import { DOMAIN } from '@/lib/domains';

const PORTAL_URL = `${DOMAIN.referral}/partner`;

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`partner-onboard:${ip}`, { maxRequests: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, { status: 429 });
  }

  const authed = await getAuthedUser(req);
  if (!authed) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }
  const { user, supabase } = authed;

  try {
    const { data: partner } = await supabase
      .from('referral_partners')
      .select('id, email, stripe_account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!partner) {
      return NextResponse.json({ error: 'Geen partnerprofiel gevonden.' }, { status: 404 });
    }

    const stripe = getStripe();
    let accountId = partner.stripe_account_id;

    if (!accountId) {
      const account = await stripe.accounts.create(
        {
          type: 'express',
          country: 'NL',
          email: partner.email,
          capabilities: { transfers: { requested: true } },
          tos_acceptance: { service_agreement: 'recipient' },
          metadata: { referral_partner_id: partner.id },
        },
        // Idempotent per partner: een dubbele klik maakt geen tweede account.
        { idempotencyKey: `referral-partner-account-${partner.id}` },
      );
      accountId = account.id;

      const { error: updateError } = await supabase
        .from('referral_partners')
        .update({ stripe_account_id: accountId, stripe_onboarding_status: 'pending' })
        .eq('id', partner.id);
      if (updateError) {
        console.error('partner-onboard: account-id opslaan mislukt', updateError.message);
        return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
      }
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: `${PORTAL_URL}?onboarding=return`,
      refresh_url: `${PORTAL_URL}?onboarding=refresh`,
    });

    return NextResponse.json({ url: link.url });
  } catch (e) {
    console.error('partner-onboard error:', e);
    return NextResponse.json({ error: 'Onboarding starten mislukt.' }, { status: 500 });
  }
}
