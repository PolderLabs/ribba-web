import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const resendApiKey = process.env.RESEND_API_KEY;

function getSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey);
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
    } = body;

    // Basic server-side validation
    if (!first_name || !last_name || !email || !phone || !address || !postal_code || !city || !license_type || !date_of_birth || !drivingschool_id) {
      return NextResponse.json(
        { error: 'Alle velden zijn verplicht.' },
        { status: 400 },
      );
    }

    const supabase = getSupabase();

    // Check if email already registered for this school
    const { data: existing } = await supabase
      .from('students')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .eq('drivingschool_id', drivingschool_id)
      .limit(1);

    if (existing && existing.length > 0) {
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

    // Insert student with waitlist status
    const { error: insertError } = await supabase.from('students').insert({
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
    });

    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json(
        { error: 'Er ging iets mis bij het opslaan. Probeer het opnieuw.' },
        { status: 500 },
      );
    }

    // Send confirmation email to student
    await sendEmail(
      email.trim().toLowerCase(),
      `Bevestiging inschrijving bij ${school.name}`,
      `
      <div style="font-family: Inter, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: #0d9488; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 24px;">
          <span style="color: #fff; font-weight: 900; font-size: 20px;">R</span>
        </div>
        <h1 style="font-size: 24px; font-weight: 800; color: #1e293b; margin-bottom: 16px;">Inschrijving ontvangen</h1>
        <p style="color: #64748b; line-height: 1.6; font-size: 15px;">
          Hoi ${first_name},<br><br>
          Je inschrijving bij <strong>${school.name}</strong> is ontvangen. De rijschool neemt binnenkort contact met je op.
        </p>
        <div style="margin-top: 24px; padding: 16px; background: #f0fdfa; border-radius: 12px;">
          <p style="font-size: 13px; color: #64748b; margin: 0;">
            <strong>Naam:</strong> ${first_name} ${last_name}<br>
            <strong>E-mail:</strong> ${email}<br>
            <strong>Rijbewijs:</strong> ${license_type}
          </p>
        </div>
        <p style="color: #94a3b8; font-size: 13px; margin-top: 32px;">
          Dit is een automatisch bericht van Ribba.
        </p>
      </div>
      `,
    );

    // Send notification to driving school
    if (school.email) {
      await sendEmail(
        school.email,
        `Nieuwe inschrijving: ${first_name} ${last_name}`,
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
              <strong>Naam:</strong> ${first_name} ${last_name}<br>
              <strong>E-mail:</strong> ${email}<br>
              <strong>Telefoon:</strong> ${phone}<br>
              <strong>Adres:</strong> ${address}, ${postal_code} ${city}<br>
              <strong>Geboortedatum:</strong> ${date_of_birth}<br>
              <strong>Rijbewijs:</strong> ${license_type}<br>
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
