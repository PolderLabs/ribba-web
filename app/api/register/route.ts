import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { isValidEmail, isValidInternationalPhone, isMinimumAge } from '@/utils/validation';
import { isValidPostalCode } from '@/lib/validation';
import {
  pickAcceptedVersions,
  extractIpAddress,
  extractUserAgent,
} from '@/lib/legal-acceptances';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const resendApiKey = process.env.RESEND_API_KEY;

function getSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  if (!rateLimit(`register:${ip}`, { maxRequests: 5, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, { status: 429 });
  }

  try {
    const body = await request.json();

    const {
      first_name,
      last_name,
      email,
      phone,
      address,
      postal_code,
      city,
      license_type,
      date_of_birth,
      drivingschool_id,
      legal_acceptances: clientLegalVersions,
    } = body;

    // Server-side validation
    if (!first_name || !last_name || !email || !phone || !address || !postal_code || !city || !license_type || !date_of_birth || !drivingschool_id) {
      return NextResponse.json(
        { error: 'Alle velden zijn verplicht.' },
        { status: 400 },
      );
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Ongeldig e-mailadres.' }, { status: 400 });
    }
    if (!isValidInternationalPhone(phone)) {
      return NextResponse.json({ error: 'Ongeldig telefoonnummer.' }, { status: 400 });
    }
    if (!isValidPostalCode(postal_code)) {
      return NextResponse.json({ error: 'Ongeldige postcode.' }, { status: 400 });
    }
    if (!isMinimumAge(date_of_birth, 16)) {
      return NextResponse.json({ error: 'Je moet minimaal 16 jaar oud zijn.' }, { status: 400 });
    }

    const validLicenseTypes = ['B', 'A', 'A1', 'A2', 'AM'];
    if (!validLicenseTypes.includes(license_type)) {
      return NextResponse.json({ error: 'Ongeldig rijbewijstype.' }, { status: 400 });
    }

    // Valideer dat zowel terms als privacy zijn geaccepteerd (geen DPA voor leerlingen)
    const acceptedDocs = pickAcceptedVersions(clientLegalVersions, ['terms', 'privacy']);
    if (acceptedDocs.length !== 2) {
      return NextResponse.json(
        { error: 'Je moet akkoord gaan met de Algemene Voorwaarden en Privacyverklaring.' },
        { status: 400 },
      );
    }
    const termsVersion = acceptedDocs.find((d) => d.document_type === 'terms')!.document_version;
    const privacyVersion = acceptedDocs.find((d) => d.document_type === 'privacy')!.document_version;
    const nowIso = new Date().toISOString();
    const legalIp = extractIpAddress(request);
    const legalUa = extractUserAgent(request);

    const supabase = getSupabase();

    // Check of email al bekend is bij deze rijschool
    const { data: existing } = await supabase
      .from('students')
      .select('id, user_id, status')
      .eq('email', email.trim().toLowerCase())
      .eq('drivingschool_id', drivingschool_id)
      .limit(1);

    const existingStudent = existing && existing.length > 0 ? existing[0] : null;

    // Als de student al een auth-account heeft (=echt geregistreerd) → blokkeren
    if (existingStudent && existingStudent.user_id) {
      return NextResponse.json(
        { error: 'Dit e-mailadres is al aangemeld bij deze rijschool.' },
        { status: 409 },
      );
    }

    // Get school info for notification email
    const { data: school } = await supabase
      .from('drivingschools')
      .select('name, email')
      .eq('id', drivingschool_id)
      .single();

    if (!school) {
      return NextResponse.json(
        { error: 'Rijschool niet gevonden.' },
        { status: 404 },
      );
    }

    // Als er al een placeholder-student bestaat (zelfde email, geen auth_user) →
    // verrijk die rij in plaats van een duplicaat aan te maken.
    const studentData = {
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      address: address.trim(),
      postal_code: postal_code.trim().toUpperCase(),
      city: city.trim(),
      license_type,
      date_of_birth,
      drivingschool_id,
      status: 'waitlist',
      terms_version: termsVersion,
      terms_accepted_at: nowIso,
      privacy_version: privacyVersion,
      privacy_accepted_at: nowIso,
      legal_ip_address: legalIp,
      legal_user_agent: legalUa,
    };

    if (existingStudent) {
      const { error: updateError } = await supabase
        .from('students')
        .update(studentData)
        .eq('id', existingStudent.id);
      if (updateError) {
        console.error('Update error:', updateError);
        return NextResponse.json(
          { error: 'Er ging iets mis bij het bijwerken. Probeer het opnieuw.' },
          { status: 500 },
        );
      }
    } else {
      const { error: insertError } = await supabase.from('students').insert(studentData);
      if (insertError) {
        console.error('Insert error:', insertError);
        return NextResponse.json(
          { error: 'Er ging iets mis bij het opslaan. Probeer het opnieuw.' },
          { status: 500 },
        );
      }
    }

    // Send confirmation email to student
    await sendEmail(
      email.trim().toLowerCase(),
      `Bevestiging inschrijving bij ${escapeHtml(school.name)}`,
      `
      <div style="font-family: Inter, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: #0d9488; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 24px;">
          <span style="color: #fff; font-weight: 900; font-size: 20px;">R</span>
        </div>
        <h1 style="font-size: 24px; font-weight: 800; color: #1e293b; margin-bottom: 16px;">Inschrijving ontvangen 🎉</h1>
        <p style="color: #64748b; line-height: 1.6; font-size: 15px;">
          Hoi ${escapeHtml(first_name)},<br><br>
          Je inschrijving bij <strong>${escapeHtml(school.name)}</strong> is goed ontvangen. De rijschool neemt binnenkort contact met je op om je rijlessen in te plannen.
        </p>
        <div style="margin-top: 24px; padding: 16px; background: #f0fdfa; border-radius: 12px;">
          <p style="font-size: 13px; color: #64748b; margin: 0;">
            <strong>Naam:</strong> ${escapeHtml(first_name)} ${escapeHtml(last_name)}<br>
            <strong>E-mail:</strong> ${escapeHtml(email)}<br>
            <strong>Rijbewijs:</strong> ${escapeHtml(license_type)}
          </p>
        </div>
        <div style="margin-top: 24px; padding: 16px; background: #eff6ff; border-radius: 12px;">
          <p style="font-size: 14px; color: #1e293b; font-weight: 700; margin: 0 0 8px 0;">📱 Wat gebeurt er nu?</p>
          <p style="font-size: 13px; color: #475569; margin: 0; line-height: 1.7;">
            Zodra je rijschool je activeert, krijg je een <strong>tweede e-mail</strong> waarmee je een wachtwoord kunt instellen en de Ribba app kunt downloaden. Daarmee zie je je lessen, voortgang en facturen.
          </p>
        </div>
        <p style="color: #94a3b8; font-size: 13px; margin-top: 32px;">
          Dit is een automatisch bericht van Ribba.<br>
          Vragen? Mail ons op <a href="mailto:hallo@ribba.app" style="color: #2563EB;">hallo@ribba.app</a>
        </p>
      </div>
      `,
    );

    // Send notification to driving school
    if (school.email) {
      await sendEmail(
        school.email,
        `Nieuwe inschrijving: ${escapeHtml(first_name)} ${escapeHtml(last_name)}`,
        `
        <div style="font-family: Inter, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <div style="background: #0d9488; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 24px;">
            <span style="color: #fff; font-weight: 900; font-size: 20px;">R</span>
          </div>
          <h1 style="font-size: 24px; font-weight: 800; color: #1e293b; margin-bottom: 16px;">Nieuwe inschrijving</h1>
          <p style="color: #64748b; line-height: 1.6; font-size: 15px;">
            Er is een nieuwe leerling aangemeld via de website.
          </p>
          <div style="margin-top: 24px; padding: 16px; background: #f0fdfa; border-radius: 12px;">
            <p style="font-size: 13px; color: #64748b; margin: 0;">
              <strong>Naam:</strong> ${escapeHtml(first_name)} ${escapeHtml(last_name)}<br>
              <strong>E-mail:</strong> ${escapeHtml(email)}<br>
              <strong>Telefoon:</strong> ${escapeHtml(phone)}<br>
              <strong>Adres:</strong> ${escapeHtml(address)}, ${escapeHtml(postal_code)} ${escapeHtml(city)}<br>
              <strong>Geboortedatum:</strong> ${escapeHtml(date_of_birth)}<br>
              <strong>Rijbewijs:</strong> ${escapeHtml(license_type)}<br>
              <strong>Status:</strong> Wachtlijst
            </p>
          </div>
          <p style="color: #64748b; font-size: 14px; margin-top: 24px;">
            Bekijk en beheer deze inschrijving in de Ribba app.
          </p>
        </div>
        `,
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Er ging iets mis. Probeer het opnieuw.' },
      { status: 500 },
    );
  }
}
