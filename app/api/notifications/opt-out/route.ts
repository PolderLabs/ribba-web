// Opt-out voor reply-notificatie e-mails (issue ribba.app#44). De chat-token
// uit de mail identificeert de kant (leerling/rijschool).
//
// GET valideert alleen en toont een bevestigingsknop; de daadwerkelijke
// mutatie zit in POST. Mail-scanners en link-prefetchers GET'en elke link in
// een mail — die mogen niemand ongevraagd afmelden.

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getServiceClient, lookupRecipientByToken } from '@/lib/marketplace-db';

export const dynamic = 'force-dynamic';

function page(title: string, body: string, extraHtml = ''): NextResponse {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — Ribba</title>
<style>body{font-family:Inter,-apple-system,sans-serif;background:#F5F5F4;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.card{background:#fff;border-radius:20px;padding:40px 28px;max-width:440px;text-align:center;box-shadow:0 1px 3px rgba(15,23,42,.06)}
h1{font-size:22px;color:#1C1917;margin:0 0 12px}p{color:#57534E;font-size:15px;line-height:1.6;margin:0}
button{background:#2563EB;color:#fff;font-weight:600;font-size:15px;padding:13px 26px;border-radius:12px;border:none;cursor:pointer;margin-top:24px}</style>
</head><body><div class="card"><h1>${title}</h1><p>${body}</p>${extraHtml}</div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

function rateLimited(request: NextRequest): boolean {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  return !rateLimit(`opt-out:${ip}`, { maxRequests: 10, windowMs: 60_000 });
}

// GET: token valideren + bevestiging vragen (géén mutatie).
export async function GET(request: NextRequest) {
  if (rateLimited(request)) {
    return NextResponse.json({ error: 'Te veel verzoeken.' }, { status: 429 });
  }

  const token = request.nextUrl.searchParams.get('token')?.trim() ?? '';

  try {
    const lookup = await lookupRecipientByToken(token);
    if (!lookup || new Date(lookup.recipient.chat_tokens_expire_at) < new Date()) {
      return page('Link ongeldig', 'Deze afmeldlink is ongeldig of verlopen.');
    }
    return page(
      'Afmelden voor chat-e-mails?',
      'Je ontvangt dan geen e-mails meer bij nieuwe chatberichten. De chat zelf blijft gewoon bereikbaar via de eerdere links of de Ribba app.',
      `<form method="POST" action="/api/notifications/opt-out?token=${encodeURIComponent(token)}"><button type="submit">Ja, meld mij af</button></form>`,
    );
  } catch (error) {
    console.error('opt-out error:', error);
    return page('Er ging iets mis', 'Probeer het later opnieuw of mail hallo@ribba.app.');
  }
}

// POST: expliciete bevestiging → optout-stempel + profielvoorkeur.
export async function POST(request: NextRequest) {
  if (rateLimited(request)) {
    return NextResponse.json({ error: 'Te veel verzoeken.' }, { status: 429 });
  }

  const token = request.nextUrl.searchParams.get('token')?.trim() ?? '';

  try {
    const lookup = await lookupRecipientByToken(token);
    if (!lookup || new Date(lookup.recipient.chat_tokens_expire_at) < new Date()) {
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
      const { error: prefError } = await supabase
        .from('marketplace_profiles')
        .update({ email_notifications: false })
        .eq('user_id', sideUserId);
      if (prefError) {
        // Stamp op inquiry_recipients staat al (idempotent); laat de gebruiker
        // opnieuw proberen zodat ook de account-brede voorkeur uit gaat.
        throw new Error(`profile opt-out failed: ${prefError.message}`);
      }
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
