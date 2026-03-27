import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const resendApiKey = process.env.RESEND_API_KEY;

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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
  let authUserId: string | null = null;
  const supabase = getSupabase();

  try {
    const body = await request.json();

    const {
      school_name,
      first_name,
      last_name,
      email,
      phone,
      address,
      postal_code,
      city,
      kvk_number,
      btw_number,
      iban,
      password,
    } = body;

    // Server-side validation
    if (!school_name || !first_name || !last_name || !email || !phone || !address || !postal_code || !city || !kvk_number || !iban || !password) {
      return NextResponse.json(
        { error: 'Alle verplichte velden moeten ingevuld zijn.' },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Wachtwoord moet minimaal 8 tekens zijn.' },
        { status: 400 },
      );
    }

    // Check if email already exists in auth.users
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const emailLower = email.trim().toLowerCase();
    const emailExists = existingUsers?.users?.some(
      (u) => u.email?.toLowerCase() === emailLower,
    );

    if (emailExists) {
      return NextResponse.json(
        { error: 'Dit e-mailadres is al in gebruik.' },
        { status: 409 },
      );
    }

    // 1. Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: emailLower,
      password,
      email_confirm: true,
      user_metadata: {
        role: 'instructor',
        first_name: first_name.trim(),
        last_name: last_name.trim(),
      },
    });

    if (authError || !authData.user) {
      console.error('Auth error:', authError);
      return NextResponse.json(
        { error: 'Kon account niet aanmaken. Probeer het opnieuw.' },
        { status: 500 },
      );
    }

    authUserId = authData.user.id;

    // 2. Generate unique registration slug
    let slug = generateSlug(school_name);
    const { data: existingSlugs } = await supabase
      .from('drivingschools')
      .select('registration_slug')
      .like('registration_slug', `${slug}%`);

    if (existingSlugs && existingSlugs.length > 0) {
      slug = `${slug}-${existingSlugs.length + 1}`;
    }

    // 3. Insert driving school
    const { data: school, error: schoolError } = await supabase
      .from('drivingschools')
      .insert({
        name: school_name.trim(),
        address: address.trim(),
        postal_code: postal_code.trim().toUpperCase(),
        city: city.trim(),
        phone: phone.trim(),
        email: emailLower,
        kvk_number: kvk_number.replace(/\s/g, '').trim(),
        btw_number: btw_number ? btw_number.replace(/\s/g, '').toUpperCase().trim() : null,
        iban: iban.replace(/\s/g, '').toUpperCase().trim(),
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

    // 5. Insert instructor license (90-day trial)
    const trialEndsAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
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

    // 6. Send welcome email
    await sendEmail(
      emailLower,
      'Welkom bij Ribba! 🎉',
      `
      <div style="font-family: Inter, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: #2563EB; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 24px;">
          <span style="color: #fff; font-weight: 900; font-size: 20px;">R</span>
        </div>
        <h1 style="font-size: 24px; font-weight: 800; color: #1e293b; margin-bottom: 16px;">Welkom bij Ribba!</h1>
        <p style="color: #64748b; line-height: 1.6; font-size: 15px;">
          Hoi ${first_name.trim()},<br><br>
          Gefeliciteerd! Je account voor <strong>${school_name.trim()}</strong> is aangemaakt.
          Je hebt <strong>3 maanden gratis</strong> toegang tot alle functies.
        </p>
        <div style="margin-top: 24px; padding: 16px; background: #eff6ff; border-radius: 12px;">
          <p style="font-size: 13px; color: #64748b; margin: 0;">
            <strong>Wat kun je met Premium?</strong><br>
            ✅ Onbeperkt leerlingen beheren<br>
            ✅ Facturatie & pakketten<br>
            ✅ CBR-koppeling<br>
            ✅ Boekhouding (Moneybird)<br>
            ✅ Leerling-inschrijfpagina
          </p>
        </div>
        <p style="color: #64748b; line-height: 1.6; font-size: 15px; margin-top: 24px;">
          Download de Ribba app en log in met je e-mailadres en wachtwoord:
        </p>
        <div style="margin-top: 16px;">
          <a href="https://apps.apple.com/app/ribba/id6741070498" style="display: inline-block; background: #1e293b; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; margin-right: 8px;">🍎 App Store</a>
          <a href="https://play.google.com/store/apps/details?id=app.ribba.pro" style="display: inline-block; background: #1e293b; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">▶️ Google Play</a>
        </div>
        <p style="color: #94a3b8; font-size: 13px; margin-top: 32px;">
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
