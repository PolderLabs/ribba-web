'use client';

// E-mailverificatie-gate: OTP via Supabase Auth. De gebruiker vult het adres
// in waarop hij de chat-link ontving; de échte match-check gebeurt server-side
// in de claim-RPC's (het masked adres hier is alleen een hint).

import { FormEvent, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

interface OtpGateProps {
  supabase: SupabaseClient;
  onVerified: (session: Session) => void;
  // Label van de verifieer-knop; default past bij de web-chat, andere
  // contexten (partner-portal) geven hun eigen label mee.
  verifyLabel?: string;
}

export default function OtpGate({ supabase, onVerified, verifyLabel = 'Verifieer en open chat' }: OtpGateProps) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function sendCode(): Promise<boolean> {
    setError(null);
    setBusy(true);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (otpError) {
      setError('Code versturen mislukt. Controleer je e-mailadres en probeer het opnieuw.');
      return false;
    }
    return true;
  }

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    if (await sendCode()) {
      setResent(false);
      setStep('code');
    }
  }

  async function handleResend() {
    if (await sendCode()) {
      setCode('');
      setResent(true);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (verifyError || !data.session) {
      setError('Ongeldige of verlopen code. Probeer het opnieuw.');
      return;
    }
    onVerified(data.session);
  }

  if (step === 'email') {
    return (
      <form onSubmit={handleSendCode} className="chat-otp-form">
        <div className="form-group">
          <label htmlFor="otp-email">E-mailadres</label>
          <input
            id="otp-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jij@voorbeeld.nl"
            autoComplete="email"
            required
          />
        </div>
        {error && <div className="alert-error" role="alert">{error}</div>}
        <button type="submit" className="btn-primary" disabled={busy || !email.trim()}>
          {busy ? 'Versturen…' : 'Stuur verificatiecode'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleVerify} className="chat-otp-form">
      <p className="chat-muted">
        We hebben een 6-cijferige code gestuurd naar <strong>{email.trim().toLowerCase()}</strong>.
      </p>
      {resent && <div className="alert-info" role="status">Nieuwe code verstuurd.</div>}
      <div className="form-group">
        <label htmlFor="otp-code">Verificatiecode</label>
        <input
          id="otp-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          required
        />
      </div>
      {error && <div className="alert-error" role="alert">{error}</div>}
      <button type="submit" className="btn-primary" disabled={busy || code.length !== 6}>
        {busy ? 'Controleren…' : verifyLabel}
      </button>
      <button
        type="button"
        className="chat-link-button"
        disabled={busy}
        onClick={() => { void handleResend(); }}
      >
        Verificatiecode opnieuw versturen
      </button>
      <button
        type="button"
        className="chat-link-button"
        disabled={busy}
        onClick={() => { setStep('email'); setCode(''); setError(null); setResent(false); }}
      >
        Ander e-mailadres gebruiken
      </button>
    </form>
  );
}
