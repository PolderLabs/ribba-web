import { createHash } from 'crypto';
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
  isValidVatFor,
  normalizeBusinessRegister,
  normalizePostcode,
  normalizeVat,
  requiresLegalName,
} from '@/lib/country-profile';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/app-links';
import { sendAdminNotification } from '@/lib/admin-notifications';
import { sanitizeSignupAttribution, summarizeAttribution } from '@/lib/signup-attribution';
import { DOMAIN } from '@/lib/domains';
import { isSignupPlan } from '@/lib/signup-plan';
import {
  recordLegalAcceptances,
  pickAcceptedVersions,
  extractIpAddress,
  extractUserAgent,
} from '@/lib/legal-acceptances';

const resendApiKey = process.env.RESEND_API_KEY;

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const VERIFY_REDIRECT_URL = `${DOMAIN.account}/welkom`;

/**
 * Deterministische idempotentiesleutel voor create_school_with_owner.
 *
 * HARDE EIS (F0-ontwerp): dezelfde registratiepoging moet dezelfde sleutel
 * opleveren, anders vervalt de idempotentie-garantie van de claims-tabel en
 * blijft alleen de unieke instructors.user_id als vangnet over. Daarom
 * afgeleid van het genormaliseerde e-mailadres — niet van een random waarde,
 * timestamp of request-id.
 *
 * Gehasht zodat de sleutel opaak en vast van lengte is; het e-mailadres zelf
 * staat leesbaar in de kolom school_registration_claims.email.
 */
function registrationOperationKey(emailLower: string): string {
  return createHash('sha256')
    .update(`school-registration:v1:${emailLower}`)
    .digest('hex');
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not set, skipping email');
    return;
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Ribba <noreply@ribba.app>',
      to,
      subject,
      html,
    }),
  });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`register-school:${ip}`, { maxRequests: 3, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, { status: 429 });
  }

  let authUserId: string | null = null;
  // Vanaf het moment dat de RPC commit bestaat de school écht. De outer catch
  // mag de auth-user dan NIET meer verwijderen: dat zou een school achterlaten
  // met een instructeur die naar een verwijderd account wijst — precies de
  // wees-rij die F0 uitbant. Side-effects ná de commit mogen nooit meer
  // terugwerken op de registratie zelf.
  let registrationCommitted = false;
  const supabase = getSupabase();

  try {
    const body = await request.json();

    const {
      legal_form,
      country_code,
      school_name,
      first_name,
      last_name,
      email,
      phone,
      address,
      postal_code,
      city,
      legal_name,
      billing_address,
      billing_postal_code,
      billing_city,
      kvk_number,
      btw_number,
      password,
      plan,
      legal_acceptances: clientLegalVersions,
    } = body;

    // Herkomst-attributie (utm/referrer/landing) — untrusted client-input,
    // server-side gewhitelist. Best-effort: mag registratie nooit raken.
    const signupAttribution = sanitizeSignupAttribution(body.attribution);

    // Server-side validation — de client valideert ook, maar HIER wordt
    // afgedwongen. Regel (Önder, 19 jul 2026): ontbrekende kritieke
    // factuurgegevens weigeren, nooit stil terugvallen op een default.
    if (!school_name || !first_name || !last_name || !email || !phone || !address || !postal_code || !city || !kvk_number || !password) {
      return NextResponse.json(
        { error: 'Alle verplichte velden moeten ingevuld zijn.' },
        { status: 400 },
      );
    }

    // Plankeuze — fase 3B.2. De servergrens, niet het formulier, bepaalt wat
    // een geldige keuze is. In deze fase heeft de waarde nog GEEN gevolg voor
    // wat er wordt aangemaakt: de school krijgt onveranderd een trial-licentie.
    // Hij wordt hier alleen afgedwongen zodat het contract vaststaat vóórdat
    // 3B.3 hem gebruikt om het Stripe-aanbod op te zoeken.
    //
    // Bewust géén default: stil terugvallen op 'basic' zou betekenen dat een
    // rijschool een plan krijgt dat hij niet gekozen heeft.
    if (!isSignupPlan(plan)) {
      return NextResponse.json(
        { error: 'Kies een abonnement (Basic of Premium).' },
        { status: 400 },
      );
    }

    if (!isLegalForm(legal_form)) {
      return NextResponse.json(
        { error: 'Kies de bedrijfsvorm van je rijschool (eenmanszaak, VOF of BV).' },
        { status: 400 },
      );
    }

    // Alleen enabled landen; profiel stuurt alle land-specifieke validatie.
    const profile = getCountryProfile(country_code);
    if (!profile) {
      return NextResponse.json(
        { error: 'Dit land wordt nog niet ondersteund.' },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Wachtwoord moet minimaal 8 tekens zijn.' },
        { status: 400 },
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Ongeldig e-mailadres.' }, { status: 400 });
    }
    if (!isValidPhoneFor(profile, phone)) {
      return NextResponse.json({ error: 'Ongeldig telefoonnummer.' }, { status: 400 });
    }
    if (!isValidPostcodeFor(profile, postal_code)) {
      return NextResponse.json({ error: profile.postcode.errorHint + '.' }, { status: 400 });
    }
    if (!isValidBusinessRegisterFor(profile, kvk_number)) {
      return NextResponse.json({ error: profile.businessRegister.errorHint + '.' }, { status: 400 });
    }
    if (btw_number && typeof btw_number === 'string' && btw_number.trim() !== ''
        && !isValidVatFor(profile, btw_number)) {
      return NextResponse.json(
        { error: `Ongeldig BTW-nummer (bijv. ${profile.vat.placeholder}).` },
        { status: 400 },
      );
    }

    // BV → statutaire naam verplicht (spiegelt de DB-constraint
    // drivingschools_bv_requires_legal_name, zodat de gebruiker een nette
    // fout krijgt in plaats van een database-error).
    const legalNameTrimmed = typeof legal_name === 'string' ? legal_name.trim() : '';
    if (requiresLegalName(legal_form) && !legalNameTrimmed) {
      return NextResponse.json(
        { error: 'Statutaire naam is verplicht voor een BV.' },
        { status: 400 },
      );
    }

    // Afwijkend vestigingsadres (alleen BV): alles-of-niets. Een half adres
    // is een datafout — weigeren, niet stilzwijgend mengen met het
    // rijschooladres.
    const billingRaw = [billing_address, billing_postal_code, billing_city]
      .map((v) => (typeof v === 'string' ? v.trim() : ''));
    const billingFilled = billingRaw.filter((v) => v !== '').length;
    const useBilling = billingFilled === 3;
    if (billingFilled > 0 && !useBilling) {
      return NextResponse.json(
        { error: 'Vul het volledige vestigingsadres in (adres, postcode én plaats), of laat alle drie leeg.' },
        { status: 400 },
      );
    }
    if (useBilling && legal_form !== 'bv') {
      return NextResponse.json(
        { error: 'Een afwijkend vestigingsadres is alleen mogelijk bij een BV.' },
        { status: 400 },
      );
    }
    if (useBilling && !isValidPostcodeFor(profile, billingRaw[1])) {
      return NextResponse.json({ error: profile.postcode.errorHint + '.' }, { status: 400 });
    }

    // Valideer dat alle 3 legal acceptances zijn meegestuurd met de juiste versie
    const acceptedDocs = pickAcceptedVersions(clientLegalVersions, ['terms', 'privacy', 'dpa']);
    if (acceptedDocs.length !== 3) {
      return NextResponse.json(
        { error: 'Je moet akkoord gaan met de Algemene Voorwaarden, Privacyverklaring en Verwerkersovereenkomst.' },
        { status: 400 },
      );
    }

    const emailLower = email.trim().toLowerCase();
    const operationKey = registrationOperationKey(emailLower);

    // 0. IDEMPOTENTIE-PRECHECK — hervat een registratie die al gecommit is.
    //    Scenario dat dit oplost: een eerdere poging heeft de RPC succesvol
    //    uitgevoerd (school + owner + trial staan er), maar de caller hoorde
    //    dat niet (serverless-timeout). Zonder deze check zou de retry stranden
    //    op "e-mailadres al in gebruik" bij generateLink, terwijl de registratie
    //    juist geslaagd is — de 409-wedge uit het F0-onderzoek.
    const { data: existingClaim, error: claimLookupError } = await supabase
      .from('school_registration_claims')
      .select('school_id, instructor_id, status')
      .eq('operation_key', operationKey)
      .maybeSingle();

    if (claimLookupError) {
      // Niet fataal: we vallen terug op het normale pad. Bestond er toch een
      // claim, dan geeft de RPC straks 'already_created' — nog steeds geen
      // duplicaat, alleen een minder nette 409 bij generateLink.
      console.error('Claim lookup error (niet fataal):', claimLookupError);
    }

    if (existingClaim?.status === 'completed' && existingClaim.school_id) {
      // De registratie is eerder al volledig gecommit. Geen tweede school, geen
      // tweede auth-user: gewoon succes teruggeven.
      //
      // BEKENDE BEPERKING: de bevestigingsmail kan hier niet opnieuw worden
      // verstuurd — de action_link komt uitsluitend uit generateLink, en dat
      // faalt voor een bestaand account. Kreeg de gebruiker in de eerste poging
      // geen mail, dan is "wachtwoord vergeten" de route. Bewust zo gelaten in
      // plaats van een ongeverifieerd hersteldpad te bouwen.
      console.warn(
        `[register-school] hervatte registratie (claim bestond al) school=${existingClaim.school_id}`,
      );
      return NextResponse.json({ success: true, school_id: existingClaim.school_id });
    }

    // 1. Create auth user as UNCONFIRMED + generate signup confirmation link.
    //    `generateLink({ type: 'signup' })` creates the user (unconfirmed) and
    //    returns the email-confirmation action_link in one call. We then send
    //    that link via Resend in our own branded email.
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'signup',
      email: emailLower,
      password,
      options: {
        data: {
          role: 'instructor',
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          name: `${first_name.trim()} ${last_name.trim()}`,
        },
        redirectTo: VERIFY_REDIRECT_URL,
      },
    });

    if (linkError) {
      const msg = linkError.message?.toLowerCase() ?? '';
      if (msg.includes('already') || msg.includes('registered') || linkError.status === 422) {
        return NextResponse.json(
          { error: 'Dit e-mailadres is al in gebruik.' },
          { status: 409 },
        );
      }
      console.error('generateLink error:', linkError);
      return NextResponse.json(
        { error: 'Kon account niet aanmaken. Probeer het opnieuw.' },
        { status: 500 },
      );
    }

    const confirmationLink = linkData?.properties?.action_link;
    const createdUser = linkData?.user;

    if (!confirmationLink || !createdUser) {
      return NextResponse.json(
        { error: 'Kon account niet aanmaken. Probeer het opnieuw.' },
        { status: 500 },
      );
    }

    authUserId = createdUser.id;

    // 2. Generate unique registration slug (retry on collision)
    let slug = generateSlug(school_name);
    let slugAttempt = slug;
    let suffix = 1;
    while (true) {
      const { data: existing } = await supabase
        .from('drivingschools')
        .select('id')
        .eq('registration_slug', slugAttempt)
        .maybeSingle();
      if (!existing) break;
      suffix++;
      slugAttempt = `${slug}-${suffix}`;
    }
    slug = slugAttempt;

    // 3. ATOMAIRE CREATIE — school + eigenaar + trial in ÉÉN transactie.
    //
    // Vervangt de drie losse inserts van vóór F0. Die konden bij een fout of
    // serverless-timeout halverwege blijven steken: de outer catch ruimde
    // alleen de auth-user op, niet de al aangemaakte school/instructeur, en de
    // licentie-insert was non-fataal (school zonder entitlement → de app leest
    // 'expired'). De RPC is alles-of-niets: faalt één stap, dan bestaat er
    // niets — geen wees-rijen, geen cleanup-logica meer nodig aan deze kant.
    //
    // De slug wordt bewust meegegeven: de DB-trigger genereert hem anders
    // zónder koppeltekens, wat het publieke inschrijflink-formaat zou wijzigen.
    // De trigger doet daarna de definitieve collision-resolutie.
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'create_school_with_owner',
      {
        p_operation_key: operationKey,
        p_user_id: authUserId,
        p_school: {
          name: school_name.trim(),
          // country_code expliciet meesturen — de kolomdefault 'NL' is een
          // overgangsmaatregel en gaat eraf zodra dit pad live is.
          country_code: profile.code,
          legal_form,
          legal_name: requiresLegalName(legal_form) ? legalNameTrimmed : null,
          address: address.trim(),
          postal_code: normalizePostcode(postal_code),
          city: city.trim(),
          billing_address: useBilling ? billingRaw[0] : null,
          billing_postal_code: useBilling ? normalizePostcode(billingRaw[1]) : null,
          billing_city: useBilling ? billingRaw[2] : null,
          phone: phone.trim(),
          email: emailLower,
          kvk_number: normalizeBusinessRegister(kvk_number),
          btw_number: btw_number && btw_number.trim() !== '' ? normalizeVat(btw_number) : null,
          registration_slug: slug,
        },
      },
    );

    if (rpcError) {
      console.error('create_school_with_owner error:', rpcError);
      // De transactie is volledig teruggerold: er is géén school, instructeur,
      // licentie of claim. Alleen de auth-user (buiten de transactie) resteert.
      await supabase.auth.admin.deleteUser(authUserId);
      return NextResponse.json(
        { error: 'Kon rijschool niet aanmaken. Probeer het opnieuw.' },
        { status: 500 },
      );
    }

    const outcome = (rpcResult as { outcome?: string } | null)?.outcome;

    if (outcome === 'busy') {
      // Een gelijktijdige registratie met dezelfde sleutel is nog bezig.
      // Onze eigen auth-user is dan overbodig — opruimen en de gebruiker
      // vragen het zo opnieuw te proberen.
      console.warn('[register-school] busy: gelijktijdige registratie in behandeling');
      await supabase.auth.admin.deleteUser(authUserId);
      return NextResponse.json(
        { error: 'Je registratie wordt al verwerkt. Probeer het over enkele seconden opnieuw.' },
        { status: 409 },
      );
    }

    const schoolId = (rpcResult as { school_id?: string } | null)?.school_id;
    const instructorId = (rpcResult as { instructor_id?: string } | null)?.instructor_id;

    if ((outcome !== 'created' && outcome !== 'already_created') || !schoolId || !instructorId) {
      console.error('create_school_with_owner onverwachte uitkomst:', rpcResult);
      await supabase.auth.admin.deleteUser(authUserId);
      return NextResponse.json(
        { error: 'Kon rijschool niet aanmaken. Probeer het opnieuw.' },
        { status: 500 },
      );
    }

    const school = { id: schoolId };
    const instructor = { id: instructorId };
    registrationCommitted = true;

    // ── Vanaf hier: uitsluitend side-effects NÁ een geslaagde commit ───────
    // De school bestaat nu gegarandeerd. Alles hieronder is aanvullend en mag
    // de registratie niet meer ongedaan maken.

    // 5b. Log legal acceptances (append-only audit log)
    await recordLegalAcceptances(
      supabase,
      acceptedDocs.map((doc) => ({
        user_id: authUserId!,
        school_id: school.id,
        document_type: doc.document_type,
        document_version: doc.document_version,
        ip_address: extractIpAddress(request),
        user_agent: extractUserAgent(request),
      })),
    );

    // 6. Create multi-use invitation link for the school
    const { error: inviteLinkError } = await supabase
      .from('invitation_links')
      .insert({
        instructor_id: instructor.id,
        drivingschool_id: school.id,
        code: slug,
        email: emailLower,
        is_multi_use: true,
        invite_type: 'student',
        expires_at: '2099-01-01T00:00:00Z',
      });

    if (inviteLinkError) {
      console.error('Invite link insert error:', inviteLinkError);
      // Non-fatal: continue anyway
    }

    // 6b. Herkomst opslaan op de school — best-effort, non-fatal.
    if (signupAttribution) {
      try {
        const { error: attributionError } = await supabase
          .from('drivingschools')
          .update({ signup_attribution: signupAttribution })
          .eq('id', school.id);
        if (attributionError) {
          console.error('signup_attribution opslaan mislukt:', attributionError.message);
        }
      } catch (e) {
        console.error('signup_attribution opslaan mislukt:', e);
      }
    }

    // 6c. Admin notification — fire-and-forget, blokkeert flow niet
    sendAdminNotification('school_registered', {
      id: school.id,
      name: school_name.trim(),
      email: emailLower,
      city: city.trim(),
      billing_plan: 'trial',
      extra: signupAttribution
        ? {
            Herkomst: summarizeAttribution(signupAttribution),
            Landingspagina: signupAttribution.landing_page ?? null,
          }
        : { Herkomst: 'direct / onbekend' },
    }).catch((e) => console.error('Admin notify (school_registered) failed:', e));

    // 7. Send branded confirmation email — user MUST click the link to
    //    verify their email address before they can log in.
    await sendEmail(
      emailLower,
      'Bevestig je e-mailadres voor Ribba',
      `
      <div style="font-family: Inter, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px; color: #1e293b;">
        <div style="background: #2563EB; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 24px;">
          <span style="color: #fff; font-weight: 900; font-size: 20px;">R</span>
        </div>
        <h1 style="font-size: 24px; font-weight: 800; margin: 0 0 16px 0;">Welkom bij Ribba! 🎉</h1>
        <p style="color: #64748b; line-height: 1.6; font-size: 15px; margin: 0 0 20px 0;">
          Hoi ${escapeHtml(first_name.trim())},<br><br>
          Je account voor <strong>${escapeHtml(school_name.trim())}</strong> staat klaar.
          Klik op de knop hieronder om je e-mailadres te bevestigen — daarna kun je inloggen in de Ribba app.
        </p>
        <div style="margin: 28px 0;">
          <a href="${confirmationLink}" style="display: inline-block; background: #2563EB; color: #ffffff; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 700;">
            Bevestig mijn e-mailadres →
          </a>
        </div>
        <p style="color: #94a3b8; font-size: 13px; margin: 0 0 28px 0;">
          Werkt de knop niet? Kopieer deze link in je browser:<br>
          <a href="${confirmationLink}" style="color: #2563EB; word-break: break-all;">${confirmationLink}</a>
        </p>
        <div style="padding: 16px; background: #eff6ff; border-radius: 12px; margin-bottom: 24px;">
          <p style="font-size: 13px; color: #1e293b; font-weight: 700; margin: 0 0 6px 0;">Je krijgt 30 dagen Premium gratis:</p>
          <p style="font-size: 13px; color: #475569; margin: 0; line-height: 1.7;">
            ✅ Onbeperkt leerlingen beheren<br>
            ✅ Facturatie & pakketten<br>
            ✅ CBR-koppeling<br>
            ✅ Boekhouding (Moneybird)<br>
            ✅ Leerling-inschrijfpagina
          </p>
        </div>
        <p style="color: #1e293b; line-height: 1.6; font-size: 15px; font-weight: 600; margin: 0 0 12px 0;">
          Download alvast de Ribba app:
        </p>
        <div style="margin-bottom: 24px;">
          <a href="${APP_STORE_URL}" style="display: inline-block; background: #000; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; margin-right: 8px; margin-bottom: 8px;">📱 App Store</a>
          <a href="${PLAY_STORE_URL}" style="display: inline-block; background: #000; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">▶ Google Play</a>
        </div>
        <p style="color: #94a3b8; font-size: 13px; margin: 24px 0 0 0;">
          Geen account aangemaakt bij Ribba? Negeer deze e-mail dan.<br>
          Vragen? Mail ons op <a href="mailto:team@ribba.app" style="color: #2563EB;">team@ribba.app</a>
        </p>
      </div>
      `,
    );

    return NextResponse.json({ success: true, school_id: schoolId });
  } catch (error) {
    console.error('Registration error:', error);

    if (registrationCommitted) {
      // De school + eigenaar + trial staan er al (RPC gecommit). Een fout in
      // een side-effect (mail, audit, invite) mag die registratie niet
      // ongedaan maken — en het account zeker niet verwijderen. De gebruiker
      // is geregistreerd; we melden succes en loggen het probleem.
      console.error(
        '[register-school] side-effect faalde NA een geslaagde registratie — account blijft bestaan',
      );
      return NextResponse.json({ success: true });
    }

    // Nog niets gecommit: de RPC-transactie is (indien aangeroepen) volledig
    // teruggerold, dus alleen de auth-user kan resteren.
    if (authUserId) {
      try {
        await supabase.auth.admin.deleteUser(authUserId);
      } catch (cleanupErr) {
        console.error('Cleanup failed:', cleanupErr);
      }
    }

    return NextResponse.json(
      { error: 'Er ging iets mis. Probeer het opnieuw.' },
      { status: 500 },
    );
  }
}
