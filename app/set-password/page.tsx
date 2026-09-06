'use client';

import { useState, useEffect, FormEvent } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../components/RibbaLogo';
import { StoreBadges } from '../components/StoreBadges';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabase() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

export default function SetPasswordPage() {
  const [mode, setMode] = useState<'loading' | 'invalid' | 'set-password' | 'success'>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      // Clean URL immediately
      window.history.replaceState({}, '', '/set-password');

      const supabase = getSupabase();
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          setMode('set-password');
        } else {
          const params = new URLSearchParams(hash.substring(1));
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (accessToken && refreshToken) {
            supabase.auth
              .setSession({ access_token: accessToken, refresh_token: refreshToken })
              .then(({ error }) => {
                if (error) {
                  setMode('invalid');
                } else {
                  setMode('set-password');
                }
              });
          } else {
            setMode('invalid');
          }
        }
      });
    } else if (hash && hash.includes('error=')) {
      window.history.replaceState({}, '', '/set-password');
      setMode('invalid');
    } else {
      // No hash — check if there's already a session (e.g. user navigated back)
      const supabase = getSupabase();
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          setMode('set-password');
        } else {
          setMode('invalid');
        }
      });
    }
  }, []);

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

  if (mode === 'invalid') {
    return (
      <main className="registration-page">
        <section className="registration-card">
          <div className="registration-brand">
            <RibbaLogo height={36} />
          </div>

          <p className="registration-pill">Link ongeldig</p>

          <h1>Deze link werkt niet meer</h1>
          <p className="registration-description">
            De link in je e-mail is verlopen of al gebruikt. Vraag je rijschool om een nieuwe uitnodiging te
            sturen.
          </p>

          <div className="divider" />
          <p className="footer-text">
            Vragen? Neem contact op met <a href="mailto:team@ribba.nl">team@ribba.nl</a>
          </p>
        </section>
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

          <p className="registration-pill">Klaar! 🎉</p>

          <h1>Je account is klaar</h1>
          <p className="registration-description">
            Je wachtwoord is ingesteld. Download de Ribba app en log in met je e-mailadres en je nieuwe
            wachtwoord.
          </p>

          <div style={{ margin: '24px 0' }}>
            <StoreBadges />
          </div>

          <div className="divider" />
          <p className="footer-text">
            Vragen? Neem contact op met <a href="mailto:team@ribba.nl">team@ribba.nl</a>
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

        <p className="registration-pill">Welkom bij Ribba</p>

        <h1>Stel je wachtwoord in</h1>
        <p className="registration-description">
          Kies een wachtwoord voor je Ribba account. Daarna kun je inloggen in de app. Minimaal 8 tekens.
        </p>

        <form onSubmit={handleSetPassword}>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="form-group">
              <label htmlFor="password">Wachtwoord</label>
              <input
                id="password"
                type="password"
                placeholder="Minimaal 8 tekens"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
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
                autoComplete="new-password"
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
              'Wachtwoord instellen'
            )}
          </button>
        </form>

        <div className="divider" />

        <p className="footer-text">
          Vragen? Neem contact op met <a href="mailto:team@ribba.nl">team@ribba.nl</a>
        </p>
      </section>
    </main>
  );
}
