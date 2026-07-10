// Reply-notificatie e-mails voor de web-chat (issue ribba.app#44).
// Draait elke 5 minuten (vercel.json). Per conversatie-kant: is er een nieuw
// counterpart-bericht sinds de laatste notificatie én is dat ≥2 min oud
// (settle-delay tegen mail-per-toetsaanslag) én is de laatste mail ≥15 min
// geleden → één gebundelde mail. Ontvangers met actieve push (app) of met
// opt-out krijgen géén mail; een nog niet geclaimde leerling juist altijd —
// dat is de funnel-stap die de leerling de chat in brengt.
//
// Auth: Vercel Cron stuurt automatisch `Authorization: Bearer ${CRON_SECRET}`.

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, getCbrRijscholen } from '@/lib/marketplace-db';
import { sendReplyNotificationMail, anonymizedFirstName } from '@/lib/marketplace-emails';
import type { ChatRole, MessageRow } from '@/lib/marketplace-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SETTLE_DELAY_MS = 2 * 60 * 1000;      // bericht moet ≥2 min oud zijn
const MIN_MAIL_GAP_MS = 15 * 60 * 1000;     // max 1 mail per kant per 15 min

interface ConversationJoin {
  id: string;
  leerling_user_id: string | null;
  rijschool_user_id: string;
  rijschool_id: number;
  last_message_at: string | null;
  leerling_last_notified_at: string | null;
  rijschool_last_notified_at: string | null;
  inquiry_recipients: {
    id: string;
    notified_email: string | null;
    rijschool_chat_token: string;
    leerling_chat_token: string;
    leerling_email_optout_at: string | null;
    rijschool_email_optout_at: string | null;
    inquiries: {
      leerling_email: string;
      leerling_name: string;
    };
  };
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceClient();
  const now = Date.now();
  const settleCutoff = new Date(now - SETTLE_DELAY_MS).toISOString();

  // Kandidaten: conversaties met recente activiteit (ruime window; de echte
  // filtering per kant gebeurt hieronder in JS — PostgREST kan geen twee
  // kolommen met elkaar vergelijken).
  const { data: candidates, error } = await supabase
    .from('conversations')
    .select(`
      id, leerling_user_id, rijschool_user_id, rijschool_id,
      last_message_at, leerling_last_notified_at, rijschool_last_notified_at,
      inquiry_recipients (
        id, notified_email, rijschool_chat_token, leerling_chat_token,
        leerling_email_optout_at, rijschool_email_optout_at,
        inquiries ( leerling_email, leerling_name )
      )
    `)
    .not('last_message_at', 'is', null)
    .lte('last_message_at', settleCutoff)
    .gte('last_message_at', new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error('chat-notifications: conversations query failed', error);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }

  const conversations = (candidates ?? []) as unknown as ConversationJoin[];

  // E-mailvoorkeuren + push-status in bulk. Push-status komt uit de bestaande
  // multi-device `push_tokens`-tabel die de app onderhoudt (SSoT) — wie daar
  // een device heeft, krijgt push via ribbaPro#144 en dus géén e-mail.
  const userIds = [
    ...new Set(
      conversations.flatMap((c) => [c.leerling_user_id, c.rijschool_user_id]).filter((id): id is string => !!id),
    ),
  ];
  const emailPrefs = new Map<string, boolean>();
  const usersWithPush = new Set<string>();
  if (userIds.length > 0) {
    const { data: profileRows } = await supabase
      .from('marketplace_profiles')
      .select('user_id, email_notifications')
      .in('user_id', userIds);
    for (const p of profileRows ?? []) {
      emailPrefs.set(p.user_id, p.email_notifications);
    }

    const { data: pushRows, error: pushError } = await supabase
      .from('push_tokens')
      .select('user_id')
      .in('user_id', userIds);
    if (pushError) {
      // Tabel(naam) niet beschikbaar → conservatief: niemand als push-gedekt
      // beschouwen (liever een dubbele notificatie dan geen enkele).
      console.warn('chat-notifications: push_tokens lookup failed', pushError.message);
    }
    for (const p of pushRows ?? []) {
      usersWithPush.add(p.user_id);
    }
  }

  // Rijschoolnamen in bulk (afzendernaam voor leerling-mails).
  const schoolIds = [...new Set(conversations.map((c) => c.rijschool_id))];
  const schools = schoolIds.length > 0 ? await getCbrRijscholen(schoolIds) : [];
  const schoolById = new Map(schools.map((s) => [s.id, s]));

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const conv of conversations) {
    const recipientRow = conv.inquiry_recipients;
    if (!recipientRow?.inquiries) {
      skipped++;
      continue;
    }

    for (const side of ['leerling', 'rijschool'] as ChatRole[]) {
      try {
        const lastNotified = side === 'leerling' ? conv.leerling_last_notified_at : conv.rijschool_last_notified_at;

        // Throttle: max 1 mail per kant per MIN_MAIL_GAP_MS.
        if (lastNotified && now - new Date(lastNotified).getTime() < MIN_MAIL_GAP_MS) {
          skipped++;
          continue;
        }
        // Niets nieuws sinds de vorige notificatie.
        if (lastNotified && conv.last_message_at && new Date(conv.last_message_at) <= new Date(lastNotified)) {
          skipped++;
          continue;
        }

        const counterpartRole: ChatRole = side === 'leerling' ? 'rijschool' : 'leerling';
        let unreadQuery = supabase
          .from('messages')
          .select('body, created_at')
          .eq('conversation_id', conv.id)
          .eq('sender_role', counterpartRole)
          .is('read_at', null)
          .lte('created_at', settleCutoff)
          .order('created_at', { ascending: false });
        if (lastNotified) {
          unreadQuery = unreadQuery.gt('created_at', lastNotified);
        }
        const { data: unread } = await unreadQuery;
        const unreadMessages = (unread ?? []) as Pick<MessageRow, 'body' | 'created_at'>[];
        if (unreadMessages.length === 0) {
          skipped++;
          continue;
        }

        // Notify-regel per kant.
        const sideUserId = side === 'leerling' ? conv.leerling_user_id : conv.rijschool_user_id;
        const optedOut = side === 'leerling'
          ? recipientRow.leerling_email_optout_at !== null
          : recipientRow.rijschool_email_optout_at !== null;
        if (optedOut) {
          skipped++;
          continue;
        }
        if (sideUserId) {
          // Actieve push in de app → geen dubbele e-mail (ribbaPro#144 dekt push).
          if (usersWithPush.has(sideUserId)) {
            skipped++;
            continue;
          }
          if (emailPrefs.get(sideUserId) === false) {
            skipped++;
            continue;
          }
        }
        // Ongeclaimde leerling (geen user_id): altijd mailen — dit is de stap
        // die de leerling voor het eerst de web-chat in brengt.

        const to = side === 'leerling'
          ? recipientRow.inquiries.leerling_email
          : recipientRow.notified_email;
        if (!to) {
          skipped++;
          continue;
        }

        const senderName = side === 'leerling'
          ? (schoolById.get(conv.rijschool_id)?.name ?? 'de rijschool')
          : anonymizedFirstName(recipientRow.inquiries.leerling_name);

        const ok = await sendReplyNotificationMail({
          to,
          senderName,
          messageCount: unreadMessages.length,
          preview: unreadMessages[0].body,
          chatToken: side === 'leerling' ? recipientRow.leerling_chat_token : recipientRow.rijschool_chat_token,
        });

        if (ok) {
          await supabase
            .from('conversations')
            .update(
              side === 'leerling'
                ? { leerling_last_notified_at: new Date().toISOString() }
                : { rijschool_last_notified_at: new Date().toISOString() },
            )
            .eq('id', conv.id);
          sent++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error('chat-notifications: side failed', conv.id, side, err);
        failed++;
      }
    }
  }

  return NextResponse.json({ sent, skipped, failed, candidates: conversations.length });
}
