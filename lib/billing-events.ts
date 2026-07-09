// billing-events.ts — dunne observability-wrapper voor de append-only
// billing_events tabel. Fase 2.2: alléén loggen. Geen gedragswijzigingen,
// geen retries, geen exceptions naar de caller.
//
// Contract: elke call is fire-and-forget uit gedragsperspectief — als de
// insert faalt, loggen we naar console maar de aanroepende billing-flow
// gaat gewoon door. Dit is opzettelijk zodat een observability-uitval
// nooit een echte betaalflow kan breken.
//
// Kolommen komen uit de billing_events migratie in ribbaPro/Supabase:
//   id, school_id, event_type, email_type, recipient, resend_message_id,
//   source, payload (jsonb), created_at.

import { createClient } from '@supabase/supabase-js';

export interface BillingEventInput {
  school_id: string;
  event_type: string;
  source: string;
  email_type?: string | null;
  recipient?: string | null;
  resend_message_id?: string | null;
  payload?: Record<string, unknown> | null;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function logBillingEvent(evt: BillingEventInput): Promise<void> {
  try {
    const { error } = await getSupabase().from('billing_events').insert({
      school_id: evt.school_id,
      event_type: evt.event_type,
      source: evt.source,
      email_type: evt.email_type ?? null,
      recipient: evt.recipient ?? null,
      resend_message_id: evt.resend_message_id ?? null,
      payload: evt.payload ?? null,
    });
    if (error) {
      console.error('billing-events insert failed:', {
        event_type: evt.event_type,
        source: evt.source,
        school_id: evt.school_id,
        error,
      });
    }
  } catch (e) {
    console.error('billing-events unexpected error:', {
      event_type: evt.event_type,
      source: evt.source,
      school_id: evt.school_id,
      err: String(e).slice(0, 300),
    });
  }
}
