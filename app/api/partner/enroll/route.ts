// POST /api/partner/enroll — schrijf een ingelogde partner in voor het
// referral-programma van een rijschool (open enrollment zolang het programma
// actief is). Maakt zo nodig de partner-rij aan, genereert een unieke code en
// stuurt de welkomstmail met de referral-link. Idempotent: een bestaande
// membership wordt gewoon teruggegeven.

import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { getAuthedUser } from '@/lib/partner-auth';
import { rateLimit } from '@/lib/rate-limit';
import { sendPartnerWelcomeMail } from '@/lib/referral-emails';
import { logBillingEvent } from '@/lib/billing-events';
import { DOMAIN } from '@/lib/domains';
import type { RewardSnapshotItem } from '@/lib/referral-types';

// Zonder 0/O/1/I — codes worden overgetypt en voorgelezen.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`partner-enroll:${ip}`, { maxRequests: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, { status: 429 });
  }

  const authed = await getAuthedUser(req);
  if (!authed) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }
  const { user, supabase } = authed;
  if (!user.email) {
    return NextResponse.json({ error: 'Account zonder e-mailadres.' }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
    if (!slug) {
      return NextResponse.json({ error: 'slug is verplicht.' }, { status: 400 });
    }

    const { data: school } = await supabase
      .from('drivingschools')
      .select('id, name, registration_slug, registration_enabled')
      .eq('registration_slug', slug)
      .maybeSingle();
    if (!school || !school.registration_enabled) {
      return NextResponse.json({ error: 'Rijschool niet gevonden.' }, { status: 404 });
    }

    const { data: program } = await supabase
      .from('referral_programs')
      .select('id, status')
      .eq('drivingschool_id', school.id)
      .eq('status', 'active')
      .maybeSingle();
    if (!program) {
      return NextResponse.json(
        { error: 'Deze rijschool heeft geen actief referral-programma.' },
        { status: 404 },
      );
    }

    // Partner-rij (globale identiteit) — idempotent op user_id.
    const { data: partnerRows, error: partnerError } = await supabase
      .from('referral_partners')
      .upsert(
        { user_id: user.id, email: user.email.toLowerCase() },
        { onConflict: 'user_id', ignoreDuplicates: true },
      )
      .select('id');
    if (partnerError) {
      console.error('partner-enroll: partner upsert failed', partnerError.message);
      return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
    }
    let partnerId = partnerRows?.[0]?.id as string | undefined;
    if (!partnerId) {
      const { data: existingPartner } = await supabase
        .from('referral_partners')
        .select('id')
        .eq('user_id', user.id)
        .single();
      partnerId = existingPartner?.id;
    }
    if (!partnerId) {
      return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
    }

    // Bestaande membership → idempotent teruggeven (geen tweede welkomstmail).
    const { data: existing } = await supabase
      .from('referral_partner_memberships')
      .select('id, code, status')
      .eq('partner_id', partnerId)
      .eq('drivingschool_id', school.id)
      .maybeSingle();

    const referralUrl = (code: string) =>
      `${DOMAIN.referral}/${school.registration_slug}?ref=${code}`;

    if (existing) {
      if (existing.status !== 'active') {
        return NextResponse.json({ error: 'Je deelname is uitgeschakeld.' }, { status: 403 });
      }
      return NextResponse.json({
        code: existing.code,
        referral_url: referralUrl(existing.code),
        school_name: school.name,
        existing: true,
      });
    }

    // Nieuwe membership met unieke code (retry op unique violation).
    let code = '';
    let membershipId: string | null = null;
    for (let attempt = 0; attempt < 5 && !membershipId; attempt++) {
      code = generateCode();
      const { data: inserted, error: insertError } = await supabase
        .from('referral_partner_memberships')
        .insert({ partner_id: partnerId, drivingschool_id: school.id, code })
        .select('id')
        .single();
      if (insertError) {
        // 23505 = unique violation: codebotsing → nieuwe code proberen;
        // botsing op (partner_id, drivingschool_id) → race met onszelf,
        // de bestaande-membership-check hierboven vangt de volgende call.
        if (insertError.code === '23505') continue;
        console.error('partner-enroll: membership insert failed', insertError.message);
        return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
      }
      membershipId = inserted?.id ?? null;
    }
    if (!membershipId) {
      return NextResponse.json({ error: 'Er ging iets mis. Probeer het opnieuw.' }, { status: 500 });
    }

    await logBillingEvent({
      school_id: school.id,
      event_type: 'referral_partner_enrolled',
      source: 'partner-enroll',
      payload: { membership_id: membershipId, partner_id: partnerId },
    });

    const { data: rewards } = await supabase
      .from('referral_program_rewards')
      .select('milestone, reward_kind, amount_cents')
      .eq('program_id', program.id);

    await sendPartnerWelcomeMail({
      schoolId: school.id,
      partnerEmail: user.email.toLowerCase(),
      schoolName: school.name,
      referralUrl: referralUrl(code),
      rewards: (rewards ?? []) as RewardSnapshotItem[],
    });

    return NextResponse.json({
      code,
      referral_url: referralUrl(code),
      school_name: school.name,
      existing: false,
    });
  } catch (e) {
    console.error('partner-enroll error:', e);
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
