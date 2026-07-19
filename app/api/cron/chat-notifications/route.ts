// Reply-notificatie e-mails voor de web-chat (issue ribba.app#44).
// Draait elke minuut. Getriggerd door Supabase pg_cron (job
// 'chat-notifications-5min'), NIET door Vercel Cron — het Vercel-plan staat
// geen sub-dagelijkse crons toe (3e cron + */1 wordt geweigerd, deploy faalt).
// pg_net doet elke minuut een GET met `Authorization: Bearer <CRON_SECRET>`
// (secret in Supabase Vault). Per conversatie-kant: is er een nieuw
// counterpart-bericht sinds de laatste notificatie én is dat ≥45s oud
// (settle-delay tegen mail-per-toetsaanslag) én is de laatste mail ≥15 min
// geleden → één gebundelde mail. Netto latency ~1 min. Ontvangers met actieve
// push (app) of met opt-out krijgen géén mail; een nog niet geclaimde leerling
// juist altijd — dat is de funnel-stap die de leerling de chat in brengt.
//
// Auth: dezelfde CRON_SECRET-bearer-check als de Vercel-crons.

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, getCbrRijscholen } from '@/lib/marketplace-db';
import { sendReplyNotificationMail, sendRijschoolOutreachMail, anonymizedFirstName } from '@/lib/marketplace-emails';
import type { ChatRole, MessageRow } from '@/lib/marketplace-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SETTLE_DELAY_MS = 45 * 1000;          // bericht moet ≥45s oud zijn (anti mid-burst)
const MIN_MAIL_GAP_MS = 15 * 60 * 1000;     // max 1 mail per kant per 15 min
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // rolling chat-token levensduur

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
    inquiry_id: string;
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
  const windowStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Retry-sweep: recipients die na een mislukte initiële outreach op 'pending'
  // bleven, opnieuw mailen (max 24u oud). Zonder dit hoort de rijschool nooit
  // van de aanvraag — er is geen conversation, dus de notificatie-loop hieronder
  // ziet ze niet.
  const retry = await retryPendingOutreach(supabase, now);

  // Kandidaten via RPC: alleen conversaties waar minstens één kant achterloopt
  // op zijn laatste notificatie (kolom-vergelijking die PostgREST niet kan),
  // zodat de cap niet vol loopt met al-genotificeerde conversaties.
  const { data: idRows, error: idError } = await supabase.rpc('list_notifiable_conversation_ids', {
    p_window_start: windowStart,
    p_settle_cutoff: settleCutoff,
    p_limit: 200,
  });
  if (idError) {
    console.error('chat-notifications: notifiable-ids rpc failed', idError);
    return NextResponse.json({ error: 'query failed', retry }, { status: 500 });
  }
  const notifiableIds = (idRows ?? []).map((r: { conversation_id: string }) => r.conversation_id);

  if (notifiableIds.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, failed: 0, candidates: 0, retry });
  }

  const { data: candidates, error } = await supabase
    .from('conversations')
    .select(`
      id, leerling_user_id, rijschool_user_id, rijschool_id,
      last_message_at, leerling_last_notified_at, rijschool_last_notified_at,
      inquiry_recipients (
        id, inquiry_id, notified_email, rijschool_chat_token, leerling_chat_token,
        leerling_email_optout_at, rijschool_email_optout_at,
        inquiries ( leerling_email, leerling_name )
      )
    `)
    .in('id', notifiableIds);

  if (error) {
    console.error('chat-notifications: conversations query failed', error);
    return NextResponse.json({ error: 'query failed', retry }, { status: 500 });
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
      .eq('is_active', true)
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

        // Goedkope filters éérst — de messages-query alleen voor kanten die
        // überhaupt gemaild mogen worden.
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

        const senderName = side === 'leerling'
          ? (schoolById.get(conv.rijschool_id)?.name ?? 'de rijschool')
          : anonymizedFirstName(recipientRow.inquiries.leerling_name);

        // Stamp de throttle VÓÓR de send: als de stamp faalt sturen we niet
        // (anders zou een gelukte send + gefaalde stamp elke 5 min dezelfde
        // mail opnieuw versturen — een duplicate-storm). Bij een gefaalde send
        // draaien we de stamp terug zodat de volgende run het opnieuw probeert.
        const stampCol = side === 'leerling' ? 'leerling_last_notified_at' : 'rijschool_last_notified_at';
        const { error: stampErr } = await supabase
          .from('conversations')
          .update({ [stampCol]: new Date().toISOString() })
          .eq('id', conv.id);
        if (stampErr) {
          console.error('chat-notifications: throttle-stamp failed, send overgeslagen', conv.id, side, stampErr);
          failed++;
          continue;
        }

        const ok = await sendReplyNotificationMail({
          to,
          senderName,
          messageCount: unreadMessages.length,
          preview: unreadMessages[0].body,
          chatToken: side === 'leerling' ? recipientRow.leerling_chat_token : recipientRow.rijschool_chat_token,
          appPath: side === 'leerling'
            ? `/i/${recipientRow.inquiry_id}`
            : `/r/${recipientRow.id}`,
        });

        if (ok) {
          // Rolling token-expiry: de zojuist gemailde link moet 30 dagen werken.
          await supabase
            .from('inquiry_recipients')
            .update({ chat_tokens_expire_at: new Date(now + TOKEN_TTL_MS).toISOString() })
            .eq('id', recipientRow.id);
          sent++;
        } else {
          // Send mislukt → stamp terugdraaien zodat de volgende run retryt.
          await supabase
            .from('conversations')
            .update({ [stampCol]: lastNotified })
            .eq('id', conv.id);
          failed++;
        }
      } catch (err) {
        console.error('chat-notifications: side failed', conv.id, side, err);
        failed++;
      }
    }
  }

  return NextResponse.json({ sent, skipped, failed, candidates: conversations.length, retry });
}

// Retry-sweep voor recipients die na een mislukte initiële outreach op 'pending'
// bleven (issue: outreach in inquiry-submit is fire-and-forget zonder retry).
// Bounded op de laatste 24u; no-email-scholen worden overgeslagen (die kunnen
// sowieso nooit reageren).
interface PendingRecipient {
  id: string;
  rijschool_id: number;
  rijschool_chat_token: string;
  inquiry_id: string;
  inquiries: {
    leerling_name: string;
    rijbewijs_categorie: string;
    schakeling: string | null;
    gewenste_startdatum: string | null;
    bericht: string | null;
  } | null;
}

async function retryPendingOutreach(
  supabase: ReturnType<typeof getServiceClient>,
  now: number,
): Promise<{ sent: number; failed: number }> {
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('inquiry_recipients')
    .select(`
      id, rijschool_id, rijschool_chat_token, inquiry_id,
      inquiries ( leerling_name, rijbewijs_categorie, schakeling, gewenste_startdatum, bericht )
    `)
    .eq('status', 'pending')
    .is('notification_email_sent_at', null)
    .gte('created_at', dayAgo)
    .limit(100);

  if (error || !data || data.length === 0) {
    if (error) console.error('chat-notifications: retry sweep query failed', error);
    return { sent: 0, failed: 0 };
  }

  const rows = data as unknown as PendingRecipient[];
  const schoolIds = [...new Set(rows.map((r) => r.rijschool_id))];
  const schools = await getCbrRijscholen(schoolIds);
  const schoolById = new Map(schools.map((s) => [s.id, s]));

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const school = schoolById.get(row.rijschool_id);
    // Geen e-mail → nooit contacteerbaar; niet blijven proberen (24u-bound stopt het).
    if (!school?.email || !row.inquiries) continue;
    try {
      const ok = await sendRijschoolOutreachMail({
        to: school.email,
        rijschoolName: school.name,
        leerlingFullName: row.inquiries.leerling_name,
        rijbewijsCategorie: row.inquiries.rijbewijs_categorie,
        schakeling: row.inquiries.schakeling,
        gewensteStartdatum: row.inquiries.gewenste_startdatum,
        bericht: row.inquiries.bericht,
        chatToken: row.rijschool_chat_token,
        recipientId: row.id,
      });
      if (ok) {
        await supabase
          .from('inquiry_recipients')
          .update({
            status: 'app_notified',
            notification_email_sent_at: new Date().toISOString(),
            notified_email: school.email,
          })
          .eq('id', row.id);
        sent++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error('chat-notifications: retry outreach failed', row.id, err);
      failed++;
    }
  }
  return { sent, failed };
}
