'use client';

// Web-chat gateway (issue ribba.app#42): vangt de link uit de outreach-/
// reply-mail op, gate't op e-mailverificatie (Supabase OTP) en plaatst de
// geverifieerde gebruiker in de geanonimiseerde 1-op-1 chat.
//
// Alle chat-semantiek loopt via de gedeelde SECURITY DEFINER RPC's uit de
// marketplace-migratie (get_chat_context / claim_inquiry /
// claim_inquiry_recipient) — exact hetzelfde contract als de ribbaPro-app,
// zodat web en app nooit uit elkaar kunnen lopen.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import RibbaLogo from '@/app/components/RibbaLogo';
import OtpGate from './OtpGate';
import ChatThread from './ChatThread';
import type { ChatContext } from '@/lib/marketplace-types';

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

// SQLSTATE 28000 = e-mail-mismatch / niet ingelogd in de claim-RPC's.
function isEmailMismatch(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '28000' || (error?.message ?? '').includes('komt niet overeen');
}

export default function ChatGateway({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>('resolving');
  const [info, setInfo] = useState<ChatContext | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mismatchEmail, setMismatchEmail] = useState<string | null>(null);
  const claimInFlight = useRef(false);

  const claim = useCallback(async (context: ChatContext): Promise<void> => {
    if (claimInFlight.current) return;
    claimInFlight.current = true;
    setPhase('claiming');
    const supabase = getSupabase();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setPhase('otp');
        return;
      }

      if (context.role === 'rijschool') {
        const { data, error } = await supabase.rpc('claim_inquiry_recipient', {
          p_recipient_id: context.recipient_id,
        });
        if (error) {
          if (isEmailMismatch(error)) {
            setMismatchEmail(session.user.email ?? null);
            setPhase('otp');
          } else {
            setErrorMsg('Er ging iets mis bij het openen van de chat.');
            setPhase('error');
          }
          return;
        }
        setConversationId(data?.conversation_id ?? null);
        setPhase(data?.conversation_id ? 'chat' : 'error');
        return;
      }

      // role === 'leerling'
      const { error } = await supabase.rpc('claim_inquiry', {
        p_inquiry_id: context.inquiry_id,
      });
      if (error) {
        if (isEmailMismatch(error)) {
          setMismatchEmail(session.user.email ?? null);
          setPhase('otp');
        } else {
          setErrorMsg('Er ging iets mis bij het openen van de chat.');
          setPhase('error');
        }
        return;
      }
      if (context.conversation_id) {
        setConversationId(context.conversation_id);
        setPhase('chat');
      } else {
        // Rijschool heeft de chat nog nooit geopend — kan alleen via een
        // verouderde link (reply-mails bestaan pas ná een rijschool-bericht).
        setPhase('waiting');
      }
    } catch {
      setErrorMsg('Kon geen verbinding maken. Probeer het opnieuw.');
      setPhase('error');
    } finally {
      claimInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('get_chat_context', { p_token: token });

      if (error || !data?.found) {
        setPhase('invalid');
        return;
      }
      const context = data as ChatContext;
      setInfo(context);

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await claim(context);
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
            e-mailadres waarop je deze uitnodiging ontving
            {info.expected_email_masked ? ` (${info.expected_email_masked})` : ''}.
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
            onVerified={() => { void claim(info); }}
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
