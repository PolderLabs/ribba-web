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
//   3. akkoorden          — vóór het mandaat, want het akkoord gáát vooraf aan
//                           de machtiging. Reist mee op de pending-rij en
//                           wordt bij activatie gematerialiseerd.
//   4. aanbod + G5        — vóór Checkout. Een Price zonder geldige
//                           plan-metadata mag nooit een betaalpagina worden.
//   5. pending registratie — het id gaat mee als metadata, zodat de webhook
//                           straks weet welke registratie hij afrondt.
//   6. Checkout Session   — als laatste. Alles wat mis kan gaan, ging al mis.
//
// WAT ER NIET IN ZIT: webhookactivatie en mailflow. En geen wachtwoord — het
// account ontstaat pas ná het mandaat, en de rijschool kiest daarna zelf een
// wachtwoord via de set-wachtwoordmail.

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
import {
  extractIpAddress,
  extractUserAgent,
  pickAcceptedVersions,
} from '@/lib/legal-acceptances';
import { sanitizeSignupAttribution } from '@/lib/signup-attribution';
import { INSCHRIJFPLAN } from '@/lib/signup-plan';
import { resolveSignupOffer } from '@/lib/signup-offer';
import { maakOfferDeps } from '@/lib/signup-offer-deps';

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
      legal_form, country_code, school_name, first_name, last_name,
      email, phone, address, postal_code, city, legal_name,
      billing_address, billing_postal_code, billing_city,
      kvk_number, btw_number, registration_slug, promo_code,
      legal_acceptances: clientLegalVersions,
    } = body;

    // Herkomst-attributie (utm/referrer/landing) — untrusted client-input,
    // server-side gewhitelist door dezelfde sanitizer als de oude route.
    // Best-effort: mag een registratie nooit tegenhouden, en `null` is een
    // geldige uitkomst voor wie rechtstreeks binnenkwam.
    const signupAttribution = sanitizeSignupAttribution(body.attribution);

    // ── 1. Validatie ─────────────────────────────────────────────────────
    // Geen plankeuze: iedereen start op Premium (besluit 16 aug). Een `plan`
    // in de body wordt genegeerd, niet gevalideerd — zou hij worden
    // overgenomen, dan kan iemand met een aangepast verzoek Basic kiezen en
    // het Premium-aanbod krijgen.
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

    // ── 3. Juridische akkoorden ──────────────────────────────────────────
    // Het akkoord ontstaat HIER, vóór het mandaat. Maar `legal_acceptances`
    // eist een user_id en die bestaat pas na de betaling, dus het reist mee op
    // de pending-registratie en wordt bij activatie gematerialiseerd.
    //
    // `pickAcceptedVersions` accepteert alleen versies die overeenkomen met
    // wat we nú publiceren — de client is getuige, geen bron. Publiceer je een
    // nieuwe versie terwijl iemand het formulier open heeft staan, dan krijgt
    // hij een 400 en moet hij herladen. Dat is bewust: liever opnieuw vragen
    // dan een akkoord vastleggen op een document dat hij niet zag.
    const akkoorden = pickAcceptedVersions(clientLegalVersions, ['terms', 'privacy', 'dpa']);
    if (akkoorden.length !== 3) {
      return fout(
        'Je moet akkoord gaan met de Algemene Voorwaarden, Privacyverklaring en Verwerkersovereenkomst.',
      );
    }

    // Eén moment voor alle drie: het was één handeling, geen drie klikken.
    // Dit moment, dit IP en deze user-agent reizen letterlijk mee naar
    // `legal_acceptances`. Zou de activatie ze opnieuw bepalen, dan stond het
    // tijdstip van de webhook en het IP van Stripe in de bewijstabel.
    const legalAcceptance = {
      accepted_at: new Date().toISOString(),
      ip_address: extractIpAddress(request),
      user_agent: extractUserAgent(request),
      documents: Object.fromEntries(
        akkoorden.map((a) => [a.document_type, a.document_version]),
      ),
    };

    // ── 4. Aanbod OPNIEUW resolven + G5 ──────────────────────────────────
    // Bewust opnieuw, met exact dezelfde functie als `/api/signup/offer`.
    // Wat de browser eerder te zien kreeg is weergave, nooit invoer: bedragen
    // en trialdatum uit een client zijn een suggestie van iemand anders. Wat
    // hier uitkomt is wat naar Checkout gaat.
    let deps: ReturnType<typeof maakOfferDeps>;
    try {
      deps = maakOfferDeps();
    } catch {
      console.error('signup/start: STRIPE_SECRET_KEY ontbreekt');
      return fout('Inschrijven is tijdelijk niet mogelijk. Mail team@ribba.app.', 503);
    }
    const stripe = deps.stripe;

    const aanbod = await resolveSignupOffer(deps, INSCHRIJFPLAN, { promoCode: promo_code });
    if (!aanbod.ok) {
      // G5. Nooit doorlaten naar een betaalpagina: dan betaalt iemand voor een
      // aanbod waar wij geen rechten aan kunnen koppelen.
      console.error('signup/start: aanbod geweigerd',
        { plan: INSCHRIJFPLAN, reason: aanbod.reason, detail: aanbod.detail });
      return fout('Inschrijven is tijdelijk niet mogelijk. Mail team@ribba.app.', 503,
        { reason: aanbod.reason });
    }

    // Alleen een code die de resolver DAADWERKELIJK heeft toegepast telt. Een
    // onbekende, verlopen of uitgeputte code komt hier als `null` uit en mag
    // niet als gebruikte campagne op de registratie belanden — anders staat er
    // straks een inwisseling geregistreerd voor een aanbod dat nooit is
    // gegeven. De inschrijving zelf gaat gewoon door, met het standaardaanbod.
    const toegepastePromocode = aanbod.korting?.code ?? null;

    // ── 5. Pending registratie ───────────────────────────────────────────
    const rij = {
      plan: INSCHRIJFPLAN,
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
      promo_code: toegepastePromocode,
      legal_acceptance: legalAcceptance,
      signup_attribution: signupAttribution,
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

    // ── 6. Checkout Session ──────────────────────────────────────────────
    // TWEE MECHANISMEN DIE ELKAAR UITSLUITEN — zie signup-offer.ts.
    //
    //   standaard → `trial_end`, een ABSOLUTE datum en geen aantal dagen.
    //               Daardoor is "1 maand gratis" een kalendermaand: 16 augustus
    //               wordt 16 september, geen afronding op 30 dagen.
    //   campagne  → `discounts`, en GEEN trial. Zouden ze allebei meegaan, dan
    //               is STARTGRATIS zeven maanden gratis in plaats van zes.
    //
    // De resolver garandeert al dat `trial` en `korting` niet allebei gevuld
    // zijn; hier wordt dat alleen doorgegeven.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: aanbod.priceId, quantity: 1 }],
      // ── TIJDELIJK: ALLEEN SEPA-INCASSO ───────────────────────────────────
      //
      // Dit hoort hier niet te staan. Normaal bepaalt Stripe zelf welke
      // betaalmethoden geldig zijn voor een sessie, en dat is ook de bedoeling:
      // dan komen nieuwe methoden er vanzelf bij en wordt er nooit iets getoond
      // wat niet kan.
      //
      // Waarom het er tóch staat. Op 18 aug 2026 faalt iDEAL bij een
      // verschuldigd bedrag van 0,00 EUR met:
      //
      //   POST /v1/payment_pages/{sessie}/confirm
      //   HTTP 500 -- "An unknown error occurred", type api_error
      //
      // Gemeten in drie varianten, en alle drie falen:
      //   1. wij gaven ['ideal','sepa_debit'] mee, MET coupon (discounts)
      //   2. idem, ZONDER coupon (trial_end)
      //   3. ZONDER payment_method_types, dus met Stripe's eigen selectie --
      //      die bood toen uitsluitend iDEAL aan, en die faalde net zo goed
      //
      // Variant 3 is de reden dat dit veld terug moest. Zonder dit veld toont
      // Stripe namelijk ALLEEN iDEAL en geen SEPA, en dan kan er niemand meer
      // inschrijven. Met dit veld is er tenminste een werkende weg: SEPA-incasso
      // is op 18 aug in productie bewezen, inclusief een geldig herbruikbaar
      // mandaat op de subscription.
      //
      // Er loopt een melding bij Stripe support: hun eigen methodeselectie biedt
      // hier een methode aan die vervolgens niet bevestigd kan worden.
      //
      // WEGHALEN ZODRA IDEAL BIJ 0,00 EUR WERKT. Dit veld is een pleister, geen
      // ontwerpkeuze -- het zet Stripe's selectie buitenspel, en dat willen we
      // niet houden. Controleer dat met een echte inschrijving, niet met een
      // aanname.
      payment_method_types: ['sepa_debit'],
      automatic_tax: { enabled: true },
      customer_email: emailNorm,
      client_reference_id: pendingId,
      ...(aanbod.korting
        ? { discounts: [{ promotion_code: aanbod.korting.promotionCodeId }] }
        : {}),
      subscription_data: {
        ...(aanbod.trial ? { trial_end: aanbod.trial.trialEndUnix } : {}),
        metadata: {
          pending_registration_id: pendingId,
          plan: INSCHRIJFPLAN,
          ...(toegepastePromocode ? { promo_code: toegepastePromocode } : {}),
        },
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
