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
    // De hash lezen kan alleen ná het monteren: `window.location.hash` bestaat
    // niet tijdens het serverrenderen. De beginwaarde lui berekenen met
    // `useState(() => …)` kan hier daarom níet — Next.js rendert deze
    // clientcomponent ook op de server, en die zou 'loading' opleveren waar de
    // client meteen 'verified' toont. Dat is een hydratiemismatch.
    //
    // Daarom eerst uitrekenen wat de uitkomst is, en dan hooguit één keer
    // schrijven. De asynchrone tak schrijft later, wanneer Supabase antwoordt.
    const hash = window.location.hash;
    const heeftToken = Boolean(hash && hash.includes('access_token'));
    const heeftFout = Boolean(hash && hash.includes('error='));

    if (heeftToken || heeftFout) {
      // De tokens uit de balk halen vóór er iets op het scherm verschijnt.
      window.history.replaceState({}, '', '/welkom');
    }

    if (heeftToken) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (accessToken && refreshToken) {
        getSupabase()
          .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          .then(({ error }) => {
            if (error) {
              setMode('invalid');
              return;
            }
            setMode('verified');
            // Uitloggen: ze horen in de app in te loggen, niet op het web te
            // blijven hangen.
            getSupabase().auth.signOut();
          });
        return;
      }
    }

    // Eén synchrone schrijfactie, en alleen deze. Geen hash betekent dat iemand
    // de pagina rechtstreeks opende; dan tonen we het gewone welkomstscherm.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- zie de kop van dit effect: de uitkomst hangt af van window.location.hash en is pas ná het monteren bekend.
    setMode(heeftToken || heeftFout ? 'invalid' : 'verified');
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
