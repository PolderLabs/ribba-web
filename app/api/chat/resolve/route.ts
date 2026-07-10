// Token-resolutie voor de web-chat gateway (/chat/{token}, issue ribba.app#42).
// Geeft een geanonimiseerde preview terug: geen e-mail/telefoon van de
// leerling vóór accept, alleen een masked hint van het te verifiëren adres.

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getServiceClient, getCbrRijscholen, lookupRecipientByToken } from '@/lib/marketplace-db';
import { anonymizedFirstName } from '@/lib/marketplace-emails';

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 2))}@${domain}`;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`chat-resolve:${ip}`, { maxRequests: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken.' }, { status: 429 });
  }

  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ongeldige request body.' }, { status: 400 });
  }
  const token = typeof body.token === 'string' ? body.token.trim() : '';

  try {
    const lookup = await lookupRecipientByToken(token);
    if (!lookup) {
      return NextResponse.json({ error: 'Ongeldige of verlopen link.' }, { status: 404 });
    }
    const { recipient, role } = lookup;
    const supabase = getServiceClient();

    const { data: inquiry } = await supabase
      .from('inquiries')
      .select('id, leerling_user_id, leerling_email, leerling_phone, leerling_name, rijbewijs_categorie, schakeling, gewenste_startdatum, bericht, created_at')
      .eq('id', recipient.inquiry_id)
      .single();
    if (!inquiry) {
      return NextResponse.json({ error: 'Aanvraag niet gevonden.' }, { status: 404 });
    }

    const [school] = await getCbrRijscholen([recipient.rijschool_id]);

    const { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('inquiry_recipient_id', recipient.id)
      .maybeSingle();

    const expectedEmail = role === 'rijschool' ? recipient.notified_email : inquiry.leerling_email;
    if (!expectedEmail) {
      // Rijschool-token terwijl er nooit een outreach-mail is verstuurd:
      // hoort niet voor te komen (de link staat alleen in die mail).
      return NextResponse.json({ error: 'Deze link is nog niet actief.' }, { status: 409 });
    }

    const claimed = role === 'rijschool'
      ? recipient.rijschool_user_id !== null
      : inquiry.leerling_user_id !== null;

    return NextResponse.json({
      role,
      status: recipient.status,
      claimed,
      conversation_id: conversation?.id ?? null,
      expected_email_masked: maskEmail(expectedEmail),
      counterpart_name: role === 'rijschool'
        ? anonymizedFirstName(inquiry.leerling_name)
        : (school?.name ?? 'Rijschool'),
      inquiry_preview: {
        voornaam: anonymizedFirstName(inquiry.leerling_name),
        rijbewijs_categorie: inquiry.rijbewijs_categorie,
        schakeling: inquiry.schakeling,
        gewenste_startdatum: inquiry.gewenste_startdatum,
        bericht: inquiry.bericht,
        created_at: inquiry.created_at,
      },
      // Contact-reveal pas na accept (ribbaPro#140) en alleen voor de rijschool.
      contact: role === 'rijschool' && recipient.status === 'accepted'
        ? {
            name: inquiry.leerling_name,
            email: inquiry.leerling_email,
            phone: inquiry.leerling_phone,
          }
        : null,
    });
  } catch (error) {
    console.error('chat/resolve error:', error);
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
