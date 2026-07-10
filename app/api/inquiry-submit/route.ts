// Inquiry-intake vanaf de vergelijkingssite (ribba.app, statisch — POST
// cross-origin hierheen). Maakt 1 inquiries-rij + N inquiry_recipients aan en
// stuurt outreach-mails naar de geselecteerde rijscholen (na de response,
// via after()). Issue ribba.app#33.

import { NextRequest, NextResponse, after } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { isValidEmail, isValidInternationalPhone } from '@/utils/validation';
import { corsHeaders, corsPreflight } from '@/lib/cors';
import { getServiceClient, getCbrRijscholen } from '@/lib/marketplace-db';
import { sendRijschoolOutreachMail } from '@/lib/marketplace-emails';

export const maxDuration = 60;

const RIJBEWIJS_CATEGORIEEN = ['B', 'AM', 'A', 'BE', 'C', 'CE', 'D', 'DE', 'T'];
const SCHAKELINGEN = ['handgeschakeld', 'automaat', 'beide'];
const MAX_RECIPIENTS = 10;

export async function OPTIONS(request: NextRequest) {
  return corsPreflight(request.headers.get('origin'));
}

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('origin'));

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`inquiry:${ip}`, { maxRequests: 5, windowMs: 3_600_000 })) {
    return NextResponse.json(
      { error: 'Te veel aanvragen. Probeer het over een uur opnieuw.' },
      { status: 429, headers },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ongeldige request body.' }, { status: 400, headers });
  }

  // Honeypot: verborgen veld dat de ContactForm meestuurt. Gevuld → bot.
  // Antwoord identiek aan een echte submit zodat bots niets leren.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    const fakeCount = Array.isArray(body.rijschool_ids)
      ? Math.min(body.rijschool_ids.length, MAX_RECIPIENTS)
      : 1;
    return NextResponse.json(
      { inquiry_id: crypto.randomUUID(), recipients_count: fakeCount },
      { status: 201, headers },
    );
  }

  const leerlingName = typeof body.leerling_name === 'string' ? body.leerling_name.trim() : '';
  const leerlingEmail = typeof body.leerling_email === 'string' ? body.leerling_email.trim().toLowerCase() : '';
  const leerlingPhone = typeof body.leerling_phone === 'string' && body.leerling_phone.trim() !== ''
    ? body.leerling_phone.trim()
    : null;
  const categorie = body.rijbewijs_categorie;
  const schakeling = body.schakeling ?? null;
  const startdatum = typeof body.gewenste_startdatum === 'string' && body.gewenste_startdatum !== ''
    ? body.gewenste_startdatum
    : null;
  const opleidingsvoorkeur = typeof body.opleidingsvoorkeur === 'string' && body.opleidingsvoorkeur.trim() !== ''
    ? body.opleidingsvoorkeur.trim().slice(0, 500)
    : null;
  const bericht = typeof body.bericht === 'string' && body.bericht.trim() !== ''
    ? body.bericht.trim().slice(0, 2000)
    : null;
  const sourcePage = typeof body.source_page === 'string' ? body.source_page.slice(0, 500) : null;

  if (!leerlingName || leerlingName.length > 120) {
    return NextResponse.json({ error: 'Naam is verplicht.' }, { status: 400, headers });
  }
  if (!isValidEmail(leerlingEmail)) {
    return NextResponse.json({ error: 'Ongeldig e-mailadres.' }, { status: 400, headers });
  }
  if (leerlingPhone && !isValidInternationalPhone(leerlingPhone)) {
    return NextResponse.json({ error: 'Ongeldig telefoonnummer.' }, { status: 400, headers });
  }
  if (typeof categorie !== 'string' || !RIJBEWIJS_CATEGORIEEN.includes(categorie)) {
    return NextResponse.json({ error: 'Ongeldige rijbewijscategorie.' }, { status: 400, headers });
  }
  if (schakeling !== null && (typeof schakeling !== 'string' || !SCHAKELINGEN.includes(schakeling))) {
    return NextResponse.json({ error: 'Ongeldige schakeling.' }, { status: 400, headers });
  }
  if (startdatum !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(startdatum) || isNaN(Date.parse(startdatum)))) {
    return NextResponse.json({ error: 'Ongeldige startdatum.' }, { status: 400, headers });
  }
  if (body.toestemming !== true) {
    return NextResponse.json(
      { error: 'Akkoord met het doorsturen van je aanvraag is verplicht.' },
      { status: 400, headers },
    );
  }

  const rawIds = Array.isArray(body.rijschool_ids) ? body.rijschool_ids : null;
  if (!rawIds || rawIds.length === 0) {
    return NextResponse.json({ error: 'Selecteer minimaal één rijschool.' }, { status: 400, headers });
  }
  const rijschoolIds = [...new Set(rawIds)].filter(
    (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0,
  );
  if (rijschoolIds.length === 0 || rijschoolIds.length !== rawIds.length || rijschoolIds.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `Ongeldige rijschool-selectie (1 t/m ${MAX_RECIPIENTS} rijscholen).` },
      { status: 400, headers },
    );
  }

  try {
    const schools = await getCbrRijscholen(rijschoolIds);
    if (schools.length !== rijschoolIds.length) {
      return NextResponse.json({ error: 'Eén of meer rijscholen zijn onbekend.' }, { status: 400, headers });
    }

    const supabase = getServiceClient();

    const { data: inquiry, error: inquiryError } = await supabase
      .from('inquiries')
      .insert({
        leerling_name: leerlingName,
        leerling_email: leerlingEmail,
        leerling_phone: leerlingPhone,
        rijbewijs_categorie: categorie,
        schakeling,
        gewenste_startdatum: startdatum,
        opleidingsvoorkeur,
        bericht,
        source_page: sourcePage,
      })
      .select('id')
      .single();

    if (inquiryError || !inquiry) {
      console.error('inquiry-submit: inquiry insert failed', inquiryError);
      return NextResponse.json(
        { error: 'Er ging iets mis bij het opslaan. Probeer het opnieuw.' },
        { status: 500, headers },
      );
    }

    const { data: recipients, error: recipientsError } = await supabase
      .from('inquiry_recipients')
      .insert(rijschoolIds.map((rijschoolId) => ({
        inquiry_id: inquiry.id,
        rijschool_id: rijschoolId,
      })))
      .select('id, rijschool_id, rijschool_chat_token');

    if (recipientsError || !recipients || recipients.length === 0) {
      console.error('inquiry-submit: recipients insert failed', recipientsError);
      // Compenserende delete — PostgREST kent geen cross-statement transacties.
      await supabase.from('inquiries').delete().eq('id', inquiry.id);
      return NextResponse.json(
        { error: 'Er ging iets mis bij het opslaan. Probeer het opnieuw.' },
        { status: 500, headers },
      );
    }

    // Outreach ná de response: de leerling hoeft niet op 10 Resend-calls te
    // wachten. Eén mislukte mail laat de recipient op 'pending' staan
    // (zichtbaar in de data; retry is een follow-up van de notificatie-cron).
    after(async () => {
      const schoolById = new Map(schools.map((s) => [s.id, s]));
      for (const recipient of recipients) {
        const school = schoolById.get(recipient.rijschool_id);
        if (!school?.email) {
          console.warn('inquiry-submit: rijschool zonder e-mailadres, outreach overgeslagen', recipient.rijschool_id);
          continue;
        }
        try {
          const sent = await sendRijschoolOutreachMail({
            to: school.email,
            rijschoolName: school.name,
            leerlingFullName: leerlingName,
            rijbewijsCategorie: categorie,
            schakeling: typeof schakeling === 'string' ? schakeling : null,
            gewensteStartdatum: startdatum,
            bericht,
            chatToken: recipient.rijschool_chat_token,
          });
          if (sent) {
            await supabase
              .from('inquiry_recipients')
              .update({
                status: 'app_notified',
                notification_email_sent_at: new Date().toISOString(),
                notified_email: school.email,
              })
              .eq('id', recipient.id);
          }
        } catch (err) {
          console.error('inquiry-submit: outreach failed', recipient.id, err);
        }
      }
    });

    return NextResponse.json(
      { inquiry_id: inquiry.id, recipients_count: recipients.length },
      { status: 201, headers },
    );
  } catch (error) {
    console.error('inquiry-submit error:', error);
    return NextResponse.json(
      { error: 'Er ging iets mis. Probeer het opnieuw.' },
      { status: 500, headers },
    );
  }
}
