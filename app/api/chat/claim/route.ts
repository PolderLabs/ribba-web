// Claim-stap van de web-chat gateway (issue ribba.app#42): koppelt een zojuist
// via OTP geverifieerde Supabase-user aan zijn kant van de inquiry en maakt
// (voor de rijschool) de conversatie aan. Het geverifieerde e-mailadres MOET
// matchen met het adres waar we de link naartoe stuurden — dit is tegelijk de
// identiteitskoppeling voor account-continuïteit web → app (ribbaPro#139).

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getServiceClient, lookupRecipientByToken } from '@/lib/marketplace-db';
import type { ChatRole } from '@/lib/marketplace-types';

async function ensureUserProfile(
  userId: string,
  role: ChatRole,
  fullName: string | null,
  rijschoolId: number | null,
): Promise<void> {
  const supabase = getServiceClient();
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('user_id, role')
    .eq('user_id', userId)
    .maybeSingle();

  // Bestaand profiel NOOIT overschrijven: de auth-pool is gedeeld met de
  // native apps en een bestaande rol (bijv. via de app aangemaakt) is leidend.
  if (existing) return;

  const { error } = await supabase.from('user_profiles').insert({
    user_id: userId,
    role,
    full_name: fullName,
    rijschool_id: role === 'rijschool' ? rijschoolId : null,
  });
  if (error && error.code !== '23505') {
    throw new Error(`user_profiles insert failed: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`chat-claim:${ip}`, { maxRequests: 20, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Te veel verzoeken.' }, { status: 429 });
  }

  const authHeader = request.headers.get('authorization');
  const jwt = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!jwt) {
    return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });
  }

  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ongeldige request body.' }, { status: 400 });
  }
  const token = typeof body.token === 'string' ? body.token.trim() : '';

  try {
    const supabase = getServiceClient();

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    const user = userData?.user;
    if (userError || !user?.email) {
      return NextResponse.json({ error: 'Sessie ongeldig. Log opnieuw in.' }, { status: 401 });
    }

    const lookup = await lookupRecipientByToken(token);
    if (!lookup) {
      return NextResponse.json({ error: 'Ongeldige of verlopen link.' }, { status: 404 });
    }
    const { recipient, role } = lookup;

    const { data: inquiry } = await supabase
      .from('inquiries')
      .select('id, leerling_user_id, leerling_email, leerling_name')
      .eq('id', recipient.inquiry_id)
      .single();
    if (!inquiry) {
      return NextResponse.json({ error: 'Aanvraag niet gevonden.' }, { status: 404 });
    }

    const expectedEmail = role === 'rijschool' ? recipient.notified_email : inquiry.leerling_email;
    if (!expectedEmail || user.email.toLowerCase() !== expectedEmail.toLowerCase()) {
      return NextResponse.json(
        { error: 'Dit e-mailadres hoort niet bij deze chat.' },
        { status: 403 },
      );
    }

    if (role === 'rijschool') {
      await ensureUserProfile(user.id, 'rijschool', null, recipient.rijschool_id);

      const recipientUpdate: Record<string, unknown> = { rijschool_user_id: user.id };
      if (recipient.status === 'pending' || recipient.status === 'app_notified') {
        recipientUpdate.status = 'opened';
      }
      const { error: updateError } = await supabase
        .from('inquiry_recipients')
        .update(recipientUpdate)
        .eq('id', recipient.id);
      if (updateError) {
        throw new Error(`inquiry_recipients update failed: ${updateError.message}`);
      }

      // Conversatie lazy aanmaken bij eerste claim (schema-afwijking D2).
      let { data: conversation } = await supabase
        .from('conversations')
        .select('id')
        .eq('inquiry_recipient_id', recipient.id)
        .maybeSingle();

      if (!conversation) {
        const { data: created, error: convError } = await supabase
          .from('conversations')
          .insert({
            inquiry_recipient_id: recipient.id,
            rijschool_user_id: user.id,
            rijschool_id: recipient.rijschool_id,
            leerling_user_id: inquiry.leerling_user_id,
          })
          .select('id')
          .single();
        if (convError) {
          // 23505 = race met een parallelle claim; dan bestaat hij inmiddels.
          if (convError.code !== '23505') {
            throw new Error(`conversations insert failed: ${convError.message}`);
          }
          const { data: raced } = await supabase
            .from('conversations')
            .select('id')
            .eq('inquiry_recipient_id', recipient.id)
            .maybeSingle();
          conversation = raced;
        } else {
          conversation = created;
        }
      }

      return NextResponse.json({
        conversation_id: conversation?.id ?? null,
        role,
        status: recipientUpdate.status ?? recipient.status,
      });
    }

    // role === 'leerling'
    await ensureUserProfile(user.id, 'leerling', inquiry.leerling_name, null);

    if (!inquiry.leerling_user_id) {
      const { error: linkError } = await supabase
        .from('inquiries')
        .update({ leerling_user_id: user.id })
        .eq('id', inquiry.id)
        .is('leerling_user_id', null);
      if (linkError) {
        throw new Error(`inquiries link failed: ${linkError.message}`);
      }
    } else if (inquiry.leerling_user_id !== user.id) {
      // Zelfde e-mailadres kan niet bij twee verschillende auth-users horen,
      // maar wees defensief.
      return NextResponse.json({ error: 'Deze aanvraag hoort bij een ander account.' }, { status: 403 });
    }

    // Backfill: álle conversaties van deze inquiry (ook die van andere
    // rijscholen) aan dit leerling-account hangen, zodat web en app dezelfde
    // gesprekken tonen (account-continuïteit, Epic #35).
    const { data: recipientIds } = await supabase
      .from('inquiry_recipients')
      .select('id')
      .eq('inquiry_id', inquiry.id);
    if (recipientIds && recipientIds.length > 0) {
      const { error: backfillError } = await supabase
        .from('conversations')
        .update({ leerling_user_id: user.id })
        .in('inquiry_recipient_id', recipientIds.map((r) => r.id))
        .is('leerling_user_id', null);
      if (backfillError) {
        throw new Error(`conversations backfill failed: ${backfillError.message}`);
      }
    }

    const { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('inquiry_recipient_id', recipient.id)
      .maybeSingle();

    // Geen conversatie = rijschool heeft nog nooit geclaimd; de UI toont dan
    // een wachtstand (kan alleen via een verouderde link gebeuren — reply-
    // mails bestaan pas nádat de rijschool een bericht stuurde).
    return NextResponse.json({
      conversation_id: conversation?.id ?? null,
      role,
      status: recipient.status,
    });
  } catch (error) {
    console.error('chat/claim error:', error);
    return NextResponse.json({ error: 'Er ging iets mis.' }, { status: 500 });
  }
}
