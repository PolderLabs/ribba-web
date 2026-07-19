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

const VERIFY_REDIRECT_URL = 'https://link.ribba.app/welkom';

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
      legal_acceptances: clientLegalVersions,
    } = body;

    // Server-side validation — de client valideert ook, maar HIER wordt
    // afgedwongen. Regel (Önder, 19 jul 2026): ontbrekende kritieke
    // factuurgegevens weigeren, nooit stil terugvallen op een default.
    if (!school_name || !first_name || !last_name || !email || !phone || !address || !postal_code || !city || !kvk_number || !password) {
      return NextResponse.json(
        { error: 'Alle verplichte velden moeten ingevuld zijn.' },
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

    // 3. Insert driving school
    const { data: school, error: schoolError } = await supabase
      .from('drivingschools')
      .insert({
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
        iban: null,
        registration_slug: slug,
        registration_enabled: true,
        status: 'active',
      })
      .select('id')
      .single();

    if (schoolError || !school) {
      console.error('School insert error:', schoolError);
      // Cleanup: delete auth user
      await supabase.auth.admin.deleteUser(authUserId);
      return NextResponse.json(
        { error: 'Kon rijschool niet aanmaken. Probeer het opnieuw.' },
        { status: 500 },
      );
    }

    // 4. Insert instructor
    const { data: instructor, error: instructorError } = await supabase
      .from('instructors')
      .insert({
        user_id: authUserId,
        drivingschool_id: school.id,
        status: 'active',
      })
      .select('id')
      .single();

    if (instructorError || !instructor) {
      console.error('Instructor insert error:', instructorError);
      // Cleanup
      await supabase.from('drivingschools').delete().eq('id', school.id);
      await supabase.auth.admin.deleteUser(authUserId);
      return NextResponse.json(
        { error: 'Kon instructeur niet aanmaken. Probeer het opnieuw.' },
        { status: 500 },
      );
    }

    // 5. Insert instructor license (30-day trial)
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error: licenseError } = await supabase
      .from('instructor_licenses')
      .insert({
        instructor_id: instructor.id,
        school_id: school.id,
        status: 'active',
        billing_plan: 'trial',
        is_trial: true,
        trial_ends_at: trialEndsAt,
        max_active_students: 9999,
        price_per_month: 0,
      });

    if (licenseError) {
      console.error('License insert error:', licenseError);
      // Non-fatal: continue anyway, license can be added manually
    }

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

    // 6b. Admin notification — fire-and-forget, blokkeert flow niet
    sendAdminNotification('school_registered', {
      id: school.id,
      name: school_name.trim(),
      email: emailLower,
      city: city.trim(),
      billing_plan: 'trial',
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
          Vragen? Mail ons op <a href="mailto:hallo@ribba.app" style="color: #2563EB;">hallo@ribba.app</a>
        </p>
      </div>
      `,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Registration error:', error);

    // Attempt cleanup if auth user was created
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
