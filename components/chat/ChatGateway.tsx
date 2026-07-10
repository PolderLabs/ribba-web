'use client';

// Web-chat gateway (issue ribba.app#42): vangt de link uit de outreach-/
// reply-mail op, gate't op e-mailverificatie (Supabase OTP) en plaatst de
// geverifieerde gebruiker in de geanonimiseerde 1-op-1 chat.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import RibbaLogo from '@/app/components/RibbaLogo';
import OtpGate from './OtpGate';
import ChatThread from './ChatThread';
import type { ChatRole, InquiryRecipientStatus } from '@/lib/marketplace-types';

export interface ResolveInfo {
  role: ChatRole;
  status: InquiryRecipientStatus;
  claimed: boolean;
  conversation_id: string | null;
  expected_email_masked: string;
  counterpart_name: string;
  inquiry_preview: {
    voornaam: string;
    rijbewijs_categorie: string;
    schakeling: string | null;
    gewenste_startdatum: string | null;
    bericht: string | null;
    created_at: string;
  };
  contact: { name: string; email: string; phone: string | null } | null;
}

type Phase =
  | 'resolving'
  | 'invalid'
  | 'otp'
  | 'claiming'
  | 'waiting'   // leerling geclaimd, maar rijschool heeft de chat nog niet geopend
  | 'chat'
  | 'error';

let browserClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return browserClient;
}

export default function ChatGateway({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>('resolving');
  const [info, setInfo] = useState<ResolveInfo | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mismatchEmail, setMismatchEmail] = useState<string | null>(null);
  const claimInFlight = useRef(false);

  const claim = useCallback(async (session: Session): Promise<void> => {
    if (claimInFlight.current) return;
    claimInFlight.current = true;
    setPhase('claiming');
    try {
      const res = await fetch('/api/chat/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 403) {
        // Ingelogd met een ander adres dan waar de mail heen ging.
        setMismatchEmail(session.user.email ?? null);
        setPhase('otp');
        return;
      }
      if (!res.ok) {
        setErrorMsg(data.error ?? 'Er ging iets mis.');
        setPhase('error');
        return;
      }
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
        setPhase('chat');
      } else {
        setPhase('waiting');
      }
    } catch {
      setErrorMsg('Kon geen verbinding maken. Probeer het opnieuw.');
      setPhase('error');
    } finally {
      claimInFlight.current = false;
    }
  }, [token]);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/chat/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => null);

      if (!res || !res.ok) {
        setPhase('invalid');
        return;
      }
      const data: ResolveInfo = await res.json();
      setInfo(data);

      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await claim(session);
      } else {
        setPhase('otp');
      }
    })();
  }, [token, claim]);

  async function handleSwitchAccount() {
    await getSupabase().auth.signOut();
    setMismatchEmail(null);
  }

  if (phase === 'resolving' || phase === 'claiming') {
    return (
      <div className="chat-page">
        <div className="chat-center-card">
          <div className="spinner" />
          <p className="chat-muted">{phase === 'resolving' ? 'Chat laden…' : 'Chat openen…'}</p>
        </div>
      </div>
    );
  }

  if (phase === 'invalid' || phase === 'error' || !info) {
    return (
      <div className="chat-page">
        <div className="chat-center-card">
          <RibbaLogo />
          <h1>Deze link werkt niet</h1>
          <p className="chat-muted">
            {errorMsg ?? 'De chat-link is ongeldig of verlopen. Gebruik de meest recente link uit je e-mail, of mail ons op '}
            {!errorMsg && <a href="mailto:hallo@ribba.app">hallo@ribba.app</a>}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'otp') {
    return (
      <div className="chat-page">
        <div className="chat-center-card">
          <RibbaLogo />
          <h1>Verifieer je e-mailadres</h1>
          <p className="chat-muted">
            Om de chat met <strong>{info.counterpart_name}</strong> te openen, verifieer je het
            e-mailadres waarop je deze uitnodiging ontving ({info.expected_email_masked}).
          </p>
          {mismatchEmail && (
            <div className="alert-error" role="alert">
              Je bent ingelogd als {mismatchEmail}, maar deze chat hoort bij een ander adres.{' '}
              <button type="button" className="chat-link-button" onClick={handleSwitchAccount}>
                Log uit en verifieer het juiste adres
              </button>
            </div>
          )}
          <OtpGate
            supabase={getSupabase()}
            onVerified={(session) => { void claim(session); }}
          />
        </div>
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <div className="chat-page">
        <div className="chat-center-card">
          <RibbaLogo />
          <h1>Nog geen reactie</h1>
          <p className="chat-muted">
            Je aanvraag is verstuurd naar <strong>{info.counterpart_name}</strong>, maar de rijschool
            heeft de chat nog niet geopend. Zodra er een reactie is, krijg je een e-mail.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ChatThread
      supabase={getSupabase()}
      conversationId={conversationId!}
      role={info.role}
      counterpartName={info.counterpart_name}
      status={info.status}
      inquiryPreview={info.inquiry_preview}
      contact={info.contact}
    />
  );
}
