// POST /api/signup/start — fase 3B.3.
//
// De nieuwe registratieroute: formulier → pending registratie → Stripe
// Checkout. Er ontstaat hier GEEN school, geen account en geen licentie; dat
// gebeurt pas in 3B.5, en uitsluitend op bevestiging van Stripe.
//
// DIT ENDPOINT IS NOG NIET DE LIVE ROUTE. `/api/register-school` blijft
// onaangeroerd de productie-route totdat 3B.5 klaar is en het formulier
// omschakelt. Bewust naast elkaar in plaats van een feature flag: een
// schakelaar wordt zelf toestand, en een tweede endpoint dat straks het eerste
// vervangt is eerlijker.
//
// VOLGORDE, EN WAAROM DIE ZO IS:
//
//   1. validatie          — vormfouten kosten geen Stripe-verkeer
//   2. e-mail vrij?       — vóór het mandaat. Niemand geeft een machtiging af
//                           voor een account dat niet kan bestaan.
//   3. aanbod + G5        — vóór Checkout. Een Price zonder geldige
//                           plan-metadata mag nooit een betaalpagina worden.
//   4. pending registratie — het id gaat mee als metadata, zodat de webhook
//                           straks weet welke registratie hij afrondt.
//   5. Checkout Session   — als laatste. Alles wat mis kan gaan, ging al mis.
//
// WAT ER NIET IN ZIT: webhookactivatie, mailflow, promocode. En geen
// wachtwoord — het account ontstaat pas ná het mandaat, en de rijschool kiest
// daarna zelf een wachtwoord via de set-wachtwoordmail.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { isValidEmail } from '@/utils/validation';
import {
  getCountryProfile,
  isLegalForm,
  isValidBusinessRegisterFor,
  isValidPhoneFor,
  isValidPostcodeFor,
  normalizeBusinessRegister,
  normalizePostcode,
  requiresLegalName,
} from '@/lib/country-profile';
import { DOMAIN } from '@/lib/domains';
import { isSignupPlan } from '@/lib/signup-plan';
import { resolveSignupOffer } from '@/lib/signup-offer';
import { getStripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/** Hoe lang een onafgeronde registratie blijft staan. Alleen vóór de checkout. */
const PENDING_GELDIG_UREN = 24;

function supabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function fout(bericht: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: bericht, ...extra }, { status });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'onbekend';
  if (!rateLimit(`signup-start:${ip}`, { maxRequests: 3, windowMs: 60_000 })) {
    return fout('Te veel pogingen. Probeer het over een minuut opnieuw.', 429);
  }

  const db = supabase();

  try {
    const body = await request.json();
    const {
      plan, legal_form, country_code, school_name, first_name, last_name,
      email, phone, address, postal_code, city, legal_name,
      billing_address, billing_postal_code, billing_city,
      kvk_number, btw_number, registration_slug,
    } = body;

    // ── 1. Validatie ─────────────────────────────────────────────────────
    if (!isSignupPlan(plan)) return fout('Kies een abonnement (Basic of Premium).');

    if (!school_name || !first_name || !last_name || !email || !phone
        || !address || !postal_code || !city || !kvk_number) {
      return fout('Alle verplichte velden moeten ingevuld zijn.');
    }
    if (!isLegalForm(legal_form)) {
      return fout('Kies de bedrijfsvorm van je rijschool (eenmanszaak, VOF of BV).');
    }
    const profile = getCountryProfile(country_code);
    if (!profile) return fout('Dit land wordt nog niet ondersteund.');
    if (!isValidEmail(email)) return fout('Ongeldig e-mailadres.');
    if (!isValidPhoneFor(profile, phone)) return fout('Ongeldig telefoonnummer.');
    if (!isValidPostcodeFor(profile, postal_code)) return fout(profile.postcode.errorHint + '.');
    if (!isValidBusinessRegisterFor(profile, kvk_number)) {
      return fout(profile.businessRegister.errorHint + '.');
    }
    const legalNameTrimmed = typeof legal_name === 'string' ? legal_name.trim() : '';
    if (requiresLegalName(legal_form) && !legalNameTrimmed) {
      return fout('Statutaire naam is verplicht voor een BV.');
    }

    const billingRaw = [billing_address, billing_postal_code, billing_city]
      .map((v) => (typeof v === 'string' ? v.trim() : ''));
    const billingIngevuld = billingRaw.filter((v) => v !== '').length;
    const useBilling = billingIngevuld === 3;
    if (billingIngevuld > 0 && !useBilling) {
      return fout('Vul het volledige vestigingsadres in (adres, postcode én plaats), of laat alle drie leeg.');
    }
    if (useBilling && legal_form !== 'bv') {
      return fout('Een afwijkend vestigingsadres is alleen mogelijk bij een BV.');
    }

    const emailNorm = String(email).trim().toLowerCase();

    // ── 2. E-mailadres vrij? ─────────────────────────────────────────────
    // Vóór het mandaat, niet erna. Anders geeft iemand een machtiging af voor
    // een account dat nooit kan ontstaan.
    const { data: bestaandeSchool } = await db
      .from('drivingschools').select('id').ilike('email', emailNorm).maybeSingle();
    if (bestaandeSchool) {
      return fout('Er bestaat al een rijschool met dit e-mailadres. Log in of gebruik een ander adres.', 409);
    }

    // ── 3. Aanbod ophalen + G5 ───────────────────────────────────────────
    let stripe: ReturnType<typeof getStripe>;
    try {
      stripe = getStripe();
    } catch {
      console.error('signup/start: STRIPE_SECRET_KEY ontbreekt');
      return fout('Inschrijven is tijdelijk niet mogelijk. Mail team@ribba.app.', 503);
    }

    const aanbod = await resolveSignupOffer(stripe, plan);
    if (!aanbod.ok) {
      // G5. Nooit doorlaten naar een betaalpagina: dan betaalt iemand voor een
      // aanbod waar wij geen rechten aan kunnen koppelen.
      console.error('signup/start: aanbod geweigerd', { plan, reason: aanbod.reason, detail: aanbod.detail });
      return fout('Inschrijven is tijdelijk niet mogelijk. Mail team@ribba.app.', 503,
        { reason: aanbod.reason });
    }

    // ── 4. Pending registratie ───────────────────────────────────────────
    const rij = {
      plan,
      email: emailNorm,
      school_name: String(school_name).trim(),
      first_name: String(first_name).trim(),
      last_name: String(last_name).trim(),
      phone: String(phone).trim(),
      address: String(address).trim(),
      postal_code: normalizePostcode(postal_code),
      city: String(city).trim(),
      country_code: profile.code,
      legal_form,
      legal_name: requiresLegalName(legal_form) ? legalNameTrimmed : null,
      kvk_number: normalizeBusinessRegister(kvk_number),
      btw_number: typeof btw_number === 'string' && btw_number.trim() ? btw_number.trim() : null,
      billing_address: useBilling ? billingRaw[0] : null,
      billing_postal_code: useBilling ? normalizePostcode(billingRaw[1]) : null,
      billing_city: useBilling ? billingRaw[2] : null,
      registration_slug: typeof registration_slug === 'string' && registration_slug.trim()
        ? registration_slug.trim() : null,
      expires_at: new Date(Date.now() + PENDING_GELDIG_UREN * 3600_000).toISOString(),
    };

    let gevondenId: string | null = null;
    const { data: nieuw, error: insertFout } = await db
      .from('pending_registrations').insert(rij).select('id').single();

    if (insertFout) {
      // Uniek op lower(email) zolang de registratie niet is afgerond. Twee keer
      // op Betalen mag nooit twee registraties — en dus nooit twee Checkouts en
      // twee abonnementen — opleveren. Hergebruik de bestaande rij.
      const { data: bestaand } = await db
        .from('pending_registrations')
        .select('id, status')
        .ilike('email', emailNorm)
        .neq('status', 'activated')
        .maybeSingle();

      if (!bestaand) {
        console.error('signup/start: pending registratie mislukt', insertFout);
        return fout('Er ging iets mis. Probeer het opnieuw.', 500);
      }
      if (bestaand.status !== 'pending_checkout') {
        // Betaald maar nog niet geactiveerd: niet opnieuw laten betalen.
        return fout(
          'Je inschrijving is al ontvangen en wordt afgerond. Je hoeft niets opnieuw te doen.',
          409,
        );
      }
      gevondenId = bestaand.id;
    } else {
      gevondenId = nieuw?.id ?? null;
    }

    // Vanaf hier moet het id vaststaan. Zonder id kan de webhook straks niet
    // weten welke registratie hij afrondt, en dan is een Checkout waardeloos —
    // dus liever hier stoppen dan een sessie maken die nergens op aansluit.
    if (!gevondenId) {
      console.error('signup/start: geen pending-registratie-id na insert/hergebruik');
      return fout('Er ging iets mis. Probeer het opnieuw.', 500);
    }
    const pendingId: string = gevondenId;

    // ── 5. Checkout Session ──────────────────────────────────────────────
    // De trialduur komt uit Stripe en wordt hier alleen doorgegeven. Ontbreekt
    // hij, dan is dat een geldig aanbod: direct betalen.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: aanbod.priceId, quantity: 1 }],
      payment_method_types: ['ideal', 'sepa_debit'],
      automatic_tax: { enabled: true },
      customer_email: emailNorm,
      client_reference_id: pendingId,
      subscription_data: {
        ...(aanbod.trialDays ? { trial_period_days: aanbod.trialDays } : {}),
        metadata: { pending_registration_id: pendingId },
      },
      metadata: { pending_registration_id: pendingId },
      success_url: `${DOMAIN.account}/registreren/ontvangen`,
      cancel_url: `${DOMAIN.account}/registreren`,
    });

    await db.from('pending_registrations')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', pendingId);

    return NextResponse.json({ checkoutUrl: session.url, pendingRegistrationId: pendingId }, { status: 200 });
  } catch (e) {
    console.error('signup/start onverwachte fout:', e);
    return fout('Er ging iets mis. Probeer het opnieuw.', 500);
  }
}
