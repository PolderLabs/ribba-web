'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../components/RibbaLogo';
import { StoreBadges } from '../components/StoreBadges';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabase() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

export default function WelkomPage() {
  const [mode, setMode] = useState<'loading' | 'verified' | 'invalid'>('loading');

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      window.history.replaceState({}, '', '/welkom');

      const supabase = getSupabase();
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
              setMode('verified');
              // Sign out — they should log in via the app, not stay logged in on web
              supabase.auth.signOut();
            }
          });
      } else {
        setMode('invalid');
      }
    } else if (hash && hash.includes('error=')) {
      window.history.replaceState({}, '', '/welkom');
      setMode('invalid');
    } else {
      // No hash — likely opened directly. Show generic welcome.
      setMode('verified');
    }
  }, []);

  if (mode === 'loading') {
    return (
      <main className="page-wrapper">
        <div className="card">
          <div className="logo">
            <RibbaLogo height={36} />
          </div>
          <p className="subtitle">Bevestigen...</p>
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
            De bevestigingslink is verlopen of al gebruikt. Probeer in te loggen in de Ribba app —
            als dat niet lukt, neem contact met ons op.
          </p>

          <div className="divider" />
          <p className="footer-text">
            Vragen? Neem contact op met <a href="mailto:team@ribba.app">team@ribba.app</a>
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

        <p className="registration-pill">Bevestigd! 🎉</p>

        <h1>Je account is klaar</h1>
        <p className="registration-description">
          Je e-mailadres is bevestigd. Download de Ribba app en log in met je e-mailadres en
          wachtwoord. Je hebt 30 dagen Premium gratis.
        </p>

        <div style={{ margin: '24px 0' }}>
          <StoreBadges />
        </div>

        <div className="divider" />
        <p className="footer-text">
          Vragen? Neem contact op met <a href="mailto:team@ribba.app">team@ribba.app</a>
        </p>
      </section>
    </main>
  );
}
