'use client';

// Enrollment-flow op /partner/join/[slug]: e-mail-OTP-login (zelfde gate als
// de web-chat) en daarna POST /api/partner/enroll. Toont de persoonlijke
// referral-link met kopieerknop.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import OtpGate from '@/components/chat/OtpGate';

type Props = {
  slug: string;
  schoolName: string;
};

type EnrollResult = {
  code: string;
  referral_url: string;
  existing: boolean;
};

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

export default function PartnerEnroll({ slug, schoolName }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getSupabase().auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionChecked(true);
    });
  }, []);

  const enroll = useCallback(async (activeSession: Session) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/partner/enroll', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeSession.access_token}`,
        },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Er ging iets mis. Probeer het opnieuw.');
      }
      setResult(data as EnrollResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Onbekende fout');
    } finally {
      setBusy(false);
    }
  }, [slug]);

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.referral_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard geweigerd — de link staat toch al in beeld */
    }
  }

  if (!sessionChecked) {
    return null;
  }

  if (result) {
    return (
      <div style={{ marginTop: 24 }}>
        <div className="alert alert-success">
          <strong>{result.existing ? 'Je doet al mee!' : 'Je doet mee!'}</strong>
          <br />
          Deel deze persoonlijke link met vrienden of familie die rijles zoeken
          bij {schoolName}:
        </div>
        <div className="form-group" style={{ marginTop: 16 }}>
          <input type="text" readOnly value={result.referral_url} onFocus={(e) => e.target.select()} />
        </div>
        <button type="button" className="btn-primary" onClick={() => { void copyLink(); }}>
          {copied ? 'Gekopieerd ✓' : 'Kopieer link'}
        </button>
        <p className="footer-text" style={{ marginTop: 16 }}>
          Volg je aanmeldingen en commissie op{' '}
          <Link href="/partner" className="text-link">je partnerpagina</Link>.
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Meedoen</h2>
        <p className="registration-description">
          Log in met je e-mailadres om je persoonlijke referral-link te krijgen.
        </p>
        <OtpGate
          supabase={getSupabase()}
          onVerified={(s) => {
            setSession(s);
            void enroll(s);
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 24 }}>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={() => { void enroll(session); }}
      >
        {busy ? (
          <>
            <span className="spinner" />
            Bezig…
          </>
        ) : (
          'Genereer mijn referral-link'
        )}
      </button>
    </div>
  );
}
