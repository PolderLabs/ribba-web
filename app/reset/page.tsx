'use client';

import { useState, useEffect, FormEvent } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../components/RibbaLogo';
import { classifyResetUrl, RESET_LINK_ONBRUIKBAAR } from '../../lib/reset-link';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Eén client per pagina. Bij PKCE bewaart de client een code_verifier in
// storage; met meerdere instanties is niet gegarandeerd dat dezelfde verifier
// wordt gelezen bij het inwisselen van de code.
let _supabase: ReturnType<typeof createBrowserClient> | null = null;
function getSupabase() {
  if (!_supabase) _supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return _supabase;
}

export default function ResetPage() {
  const [mode, setMode] = useState<'loading' | 'request' | 'set-password' | 'success'>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    // De resetlink kan in drie vormen binnenkomen. Tot 31 jul 2026 keek deze
    // pagina alléén naar de hash-vormen, waardoor de PKCE-vorm — die
    // createBrowserClient uit @supabase/ssr STANDAARD gebruikt — altijd
    // doorviel naar het e-mailformulier. De gebruiker klikte dan op een
    // geldige link en kreeg het scherm "vul je e-mailadres in", klikte
    // nogmaals (token is eenmalig, dus nu écht ongeldig), en liep daarna
    // tegen de rate limit aan. Dat is in de auth-logs terug te zien als
    // 303 login → 403 "One-time token not found" → 429.
    //
    //   1. ?code=<uuid>        PKCE — de huidige vorm
    //   2. #access_token=...   implicit — oudere links, blijft ondersteund
    //   3. #error=...          Supabase weigerde de token
    //
    // Volgorde is bewust: eerst een bestaande sessie (de client kan de code
    // al automatisch hebben ingewisseld), dan de expliciete vormen.
    const supabase = getSupabase();
    const hash = window.location.hash;

    const schoon = () => window.history.replaceState({}, '', '/reset');

    const naarWachtwoord = () => {
      schoon();
      setMode('set-password');
    };

    const naarFout = (text: string) => {
      schoon();
      setMode('request');
      setMessage({ type: 'error', text });
    };

    (async () => {
      const { data: bestaand } = await supabase.auth.getSession();
      const actie = classifyResetUrl({
        search: window.location.search,
        hash,
        hasSession: Boolean(bestaand.session),
      });

      switch (actie.kind) {
        case 'set-password':
          naarWachtwoord();
          return;

        case 'exchange-code': {
          const { error } = await supabase.auth.exchangeCodeForSession(actie.code);
          if (error) naarFout(RESET_LINK_ONBRUIKBAAR);
          else naarWachtwoord();
          return;
        }

        case 'set-session': {
          const { error } = await supabase.auth.setSession({
            access_token: actie.accessToken,
            refresh_token: actie.refreshToken,
          });
          if (error) naarFout(RESET_LINK_ONBRUIKBAAR);
          else naarWachtwoord();
          return;
        }

        case 'error':
          naarFout(RESET_LINK_ONBRUIKBAAR);
          return;

        default:
          setMode('request');
      }
    })();
  }, []);

  async function handleRequestReset(e: FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (!email.trim()) {
      setMessage({ type: 'error', text: 'Vul je e-mailadres in.' });
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset`,
      });

      if (error) {
        setMessage({ type: 'error', text: 'Er ging iets mis. Probeer het opnieuw.' });
      } else {
        setMessage({
          type: 'success',
          text: 'Als dit e-mailadres bij ons bekend is, ontvang je een reset link.',
        });
      }
    } catch {
      setMessage({ type: 'error', text: 'Er ging iets mis. Probeer het opnieuw.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPassword(e: FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (password.length < 8) {
      setMessage({ type: 'error', text: 'Wachtwoord moet minimaal 8 tekens zijn.' });
      return;
    }

    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Wachtwoorden komen niet overeen.' });
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setMessage({ type: 'error', text: error.message || 'Er ging iets mis.' });
      } else {
        setPassword('');
        setConfirmPassword('');
        setMode('success');
        // Try to open the app after a short delay
        setTimeout(() => {
          window.location.href = 'ribba://';
        }, 1500);
      }
    } catch {
      setMessage({ type: 'error', text: 'Er ging iets mis. Probeer het opnieuw.' });
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'loading') {
    return (
      <main className="page-wrapper">
        <div className="card">
          <div className="logo">
            <RibbaLogo height={36} />
          </div>
          <p className="subtitle">Laden...</p>
        </div>
      </main>
    );
  }

  if (mode === 'success') {
    return (
      <main className="registration-page">
        <section className="registration-card">
          <div className="registration-brand">
            <RibbaLogo height={36} />
          </div>

          <p className="registration-pill">Gelukt!</p>

          <h1>Wachtwoord gewijzigd</h1>
          <p className="registration-description">
            Je wachtwoord is succesvol ingesteld. Je kunt nu inloggen in de Ribba app.
          </p>

          <a href="ribba://" className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: '1rem' }}>
            Open Ribba app
          </a>

          <div className="divider" />
          <p className="footer-text">
            Vragen? Neem contact op met{' '}
            <a href="mailto:team@ribba.app">team@ribba.app</a>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-brand">
          <RibbaLogo height={36} />
        </div>

        <p className="registration-pill">
          {mode === 'request' ? 'Wachtwoord vergeten' : 'Nieuw wachtwoord'}
        </p>

        {mode === 'request' ? (
          <>
            <h1>Wachtwoord herstellen</h1>
            <p className="registration-description">
              Vul je e-mailadres in en we sturen je een link om je wachtwoord te herstellen.
            </p>

            <form onSubmit={handleRequestReset}>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                <div className="form-group">
                  <label htmlFor="email">E-mailadres</label>
                  <input
                    id="email"
                    type="email"
                    placeholder="jan@voorbeeld.nl"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              {message && (
                <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'}`}>
                  {message.text}
                </div>
              )}

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner" />
                    Versturen...
                  </>
                ) : (
                  'Verstuur reset link'
                )}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1>Nieuw wachtwoord instellen</h1>
            <p className="registration-description">
              Kies een nieuw wachtwoord voor je Ribba account. Minimaal 8 tekens.
            </p>

            <form onSubmit={handleSetPassword}>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                <div className="form-group">
                  <label htmlFor="password">Nieuw wachtwoord</label>
                  <input
                    id="password"
                    type="password"
                    placeholder="Minimaal 8 tekens"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="confirm-password">Wachtwoord bevestigen</label>
                  <input
                    id="confirm-password"
                    type="password"
                    placeholder="Herhaal je wachtwoord"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </div>

              {message && (
                <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'}`}>
                  {message.text}
                </div>
              )}

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner" />
                    Opslaan...
                  </>
                ) : (
                  'Wachtwoord wijzigen'
                )}
              </button>
            </form>
          </>
        )}

        <div className="divider" />

        <p className="footer-text">
          Vragen? Neem contact op met{' '}
          <a href="mailto:team@ribba.app">team@ribba.app</a>
        </p>
      </section>
    </main>
  );
}
