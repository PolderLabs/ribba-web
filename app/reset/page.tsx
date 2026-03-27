'use client';

import { useState, useEffect, FormEvent } from 'react';
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabase() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

export default function ResetPage() {
  const [mode, setMode] = useState<'loading' | 'request' | 'set-password' | 'success'>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    // Check if there's an access_token in the URL hash (from Supabase reset email)
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      // Clean the URL immediately — remove the tokens from the address bar
      window.history.replaceState({}, '', '/reset');

      const supabase = getSupabase();
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          setMode('set-password');
        } else {
          // Try to exchange the token
          const params = new URLSearchParams(hash.substring(1));
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (accessToken && refreshToken) {
            supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
              if (error) {
                setMode('request');
                setMessage({ type: 'error', text: 'De reset link is verlopen. Vraag een nieuwe aan.' });
              } else {
                setMode('set-password');
              }
            });
          } else {
            setMode('request');
          }
        }
      });
    } else if (hash && hash.includes('error=')) {
      // Clean URL and show error
      window.history.replaceState({}, '', '/reset');
      setMode('request');
      setMessage({ type: 'error', text: 'De reset link is verlopen of ongeldig. Vraag een nieuwe aan.' });
    } else {
      setMode('request');
    }
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
            <div className="logo-icon">R</div>
            Ribba
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
            <div className="logo-icon">R</div>
            <span>Ribba</span>
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
            <a href="mailto:hallo@ribba.app">hallo@ribba.app</a>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-brand">
          <div className="logo-icon">R</div>
          <span>Ribba</span>
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
          <a href="mailto:hallo@ribba.app">hallo@ribba.app</a>
        </p>
      </section>
    </main>
  );
}
