'use client';

// Geanonimiseerde 1-op-1 chat in WhatsApp-stijl (issue ribba.app#42):
// bubbles links/rechts, timestamps, read-states. Realtime via Supabase
// Realtime op de gedeelde messages-tabel; RLS bepaalt toegang, dus het
// access token moet via realtime.setAuth() meegegeven worden (ook opnieuw
// bij token-refresh, anders valt de subscription stil).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { AppStoreBadge, GooglePlayBadge } from '@/app/components/StoreBadges';
import MessageComposer from './MessageComposer';
import type { ChatContextData, ChatRole, InquiryRecipientStatus, MessageRow } from '@/lib/marketplace-types';

interface ChatThreadProps {
  supabase: SupabaseClient;
  conversationId: string;
  role: ChatRole;
  counterpartName: string;
  status: InquiryRecipientStatus;
  inquiryPreview: ChatContextData['inquiry_preview'];
  contact: ChatContextData['contact'];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function ChatThread({
  supabase,
  conversationId,
  role,
  counterpartName,
  status,
  inquiryPreview,
  contact,
}: ChatThreadProps) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const counterpartRole: ChatRole = role === 'leerling' ? 'rijschool' : 'leerling';

  // read_at kan alleen via de gedeelde RPC gezet worden (geen client-UPDATE
  // op messages) — zelfde pad als de ribbaPro-app straks gebruikt.
  const markRead = useCallback(async () => {
    await supabase.rpc('mark_messages_read', { p_conversation_id: conversationId });
  }, [supabase, conversationId]);

  // Alleen als gelezen markeren wanneer de tab echt zichtbaar is. Een
  // achtergrond-tab telt niet als "actief kijken" — anders zou de
  // reply-notificatie-mail (cron mailt alleen ongelezen berichten) nooit
  // afgaan voor iemand die de chat op de achtergrond heeft openstaan.
  const markReadIfVisible = useCallback(() => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      void markRead();
    }
  }, [markRead]);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    let initialLoadDone = false;

    // Initial load pas ná (poging tot) subscriben, zodat berichten die tussen
    // fetch en subscribe binnenkomen niet verloren gaan; het id-dedupe in de
    // INSERT-handler vangt de overlap af.
    const loadMessages = async () => {
      if (initialLoadDone || cancelled) return;
      initialLoadDone = true;
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (cancelled) return;
      if (error) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      setMessages((prev) => {
        const loaded = (data as MessageRow[]) ?? [];
        const extra = prev.filter((m) => !loaded.some((l) => l.id === m.id));
        return [...loaded, ...extra];
      });
      setLoading(false);
      markReadIfVisible();
    };

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      userIdRef.current = session.user.id;
      supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`chat-${conversationId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const msg = payload.new as MessageRow;
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            // Alleen als de tab zichtbaar is; anders blijft het bericht
            // ongelezen en pikt de cron het op voor de e-mailnotificatie.
            if (msg.sender_role === counterpartRole) markReadIfVisible();
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const msg = payload.new as MessageRow;
            setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
          },
        )
        .subscribe((status) => {
          // Ook bij een falend kanaal de historie tonen (chat zonder
          // realtime is bruikbaarder dan een eeuwige spinner).
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            void loadMessages();
          }
        });
    })();

    // Realtime-token vernieuwen wanneer de sessie ververst.
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });

    // Terug naar de tab → inhalen wat tijdens onzichtbaarheid binnenkwam.
    const onVisible = () => markReadIfVisible();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      authSub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [supabase, conversationId, counterpartRole, markRead, markReadIfVisible]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend(body: string): Promise<boolean> {
    const userId = userIdRef.current;
    if (!userId) return false;
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_user_id: userId,
        sender_role: role,
        body,
      })
      .select('*')
      .single();
    if (error || !data) return false;
    const msg = data as MessageRow;
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    return true;
  }

  return (
    <div className="chat-page">
      <div className="chat-shell">
        <header className="chat-header">
          <div className="chat-header-info">
            <h1>{counterpartName}</h1>
            {contact ? (
              <p className="chat-contact">
                {contact.email}{contact.phone ? ` · ${contact.phone}` : ''}
              </p>
            ) : (
              <p className="chat-anon-note">
                Geanonimiseerd via Ribba{role === 'rijschool' ? ' — contactgegevens zichtbaar na accepteren in de app' : ''}
              </p>
            )}
          </div>
          <span className={`pill ${status === 'accepted' ? 'pill-green' : 'pill-amber'}`}>
            {status === 'accepted' ? 'Geaccepteerd' : 'Aanvraag'}
          </span>
        </header>

        <div className="chat-app-banner">
          <span>Volg dit gesprek met push-meldingen in de Ribba app</span>
          <div className="chat-app-badges">
            <AppStoreBadge />
            <GooglePlayBadge />
          </div>
        </div>

        <div className="chat-thread">
          <div className="chat-inquiry-card">
            <p className="chat-inquiry-title">
              Aanvraag van {inquiryPreview.voornaam} · rijbewijs {inquiryPreview.rijbewijs_categorie}
              {inquiryPreview.schakeling ? ` · ${inquiryPreview.schakeling}` : ''}
            </p>
            {inquiryPreview.gewenste_startdatum && (
              <p className="chat-inquiry-detail">Gewenste start: {formatDay(inquiryPreview.gewenste_startdatum)}</p>
            )}
            {inquiryPreview.opleidingsvoorkeur && (
              <p className="chat-inquiry-detail">Soort opleiding: {inquiryPreview.opleidingsvoorkeur}</p>
            )}
            {inquiryPreview.bericht && (
              <p className="chat-inquiry-message">“{inquiryPreview.bericht}”</p>
            )}
          </div>

          {loading && <div className="spinner" />}
          {loadError && (
            <div className="alert-error" role="alert">Berichten laden mislukt. Ververs de pagina.</div>
          )}

          {messages.map((msg, i) => {
            const own = msg.sender_role === role;
            const day = formatDay(msg.created_at);
            const showDay = i === 0 || day !== formatDay(messages[i - 1].created_at);
            return (
              <div key={msg.id}>
                {showDay && <div className="chat-day-divider">{day}</div>}
                <div className={`chat-bubble-row ${own ? 'own' : ''}`}>
                  <div className={`chat-bubble ${own ? 'chat-bubble-own' : ''}`}>
                    <p>{msg.body}</p>
                    <span className="chat-bubble-meta">
                      {formatTime(msg.created_at)}
                      {own && (
                        <span className={`chat-ticks ${msg.read_at ? 'read' : ''}`} aria-label={msg.read_at ? 'Gelezen' : 'Verzonden'}>
                          {msg.read_at ? '✓✓' : '✓'}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <MessageComposer onSend={handleSend} />
      </div>
    </div>
  );
}
