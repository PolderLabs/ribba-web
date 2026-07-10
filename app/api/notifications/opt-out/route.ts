// Opt-out voor reply-notificatie e-mails (issue ribba.app#44). De chat-token
// uit de mail identificeert de kant (leerling/rijschool). Zet de optout-stempel
// op de inquiry_recipient en — als die kant al een account heeft —
// email_notifications=false op het profiel.

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getServiceClient, lookupRecipientByToken } from '@/lib/marketplace-db';

export const dynamic = 'force-dynamic';

function page(title: string, body: string): NextResponse {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — Ribba</title>
<style>body{font-family:Inter,-apple-system,sans-serif;background:#F5F5F4;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.card{background:#fff;border-radius:20px;padding:40px 28px;max-width:440px;text-align:center;box-shadow:0 1px 3px rgba(15,23,42,.06)}
h1{font-size:22px;color:#1C1917;margin:0 0 12px}p{color:#57534E;font-size:15px;line-height:1.6;margin:0}</style>
</head><body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`opt-out:${ip}`, { maxRequests: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken.' }, { status: 429 });
  }

  const token = request.nextUrl.searchParams.get('token')?.trim() ?? '';

  try {
    const lookup = await lookupRecipientByToken(token);
    if (!lookup) {
      return page('Link ongeldig', 'Deze afmeldlink is ongeldig of verlopen.');
    }
    const { recipient, role } = lookup;
    const supabase = getServiceClient();

    const { error: stampError } = await supabase
      .from('inquiry_recipients')
      .update(
        role === 'leerling'
          ? { leerling_email_optout_at: new Date().toISOString() }
          : { rijschool_email_optout_at: new Date().toISOString() },
      )
      .eq('id', recipient.id);
    if (stampError) {
      throw new Error(`opt-out stamp failed: ${stampError.message}`);
    }

    // Kant al geclaimd → ook de profielvoorkeur uitzetten (geldt dan voor
    // alle conversaties van dit account).
    let sideUserId: string | null = null;
    if (role === 'rijschool') {
      sideUserId = recipient.rijschool_user_id;
    } else {
      const { data: inquiry } = await supabase
        .from('inquiries')
        .select('leerling_user_id')
        .eq('id', recipient.inquiry_id)
        .single();
      sideUserId = inquiry?.leerling_user_id ?? null;
    }
    if (sideUserId) {
      await supabase
        .from('marketplace_profiles')
        .update({ email_notifications: false })
        .eq('user_id', sideUserId);
    }

    return page(
      'Afgemeld',
      'Je ontvangt geen e-mails meer over nieuwe chatberichten. Je kunt de chat altijd blijven openen via de eerdere links of de Ribba app.',
    );
  } catch (error) {
    console.error('opt-out error:', error);
    return page('Er ging iets mis', 'Probeer het later opnieuw of mail hallo@ribba.app.');
  }
}
