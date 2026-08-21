'use client';

import { useState, useEffect, FormEvent } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import type { Factor } from '@supabase/supabase-js';
import RibbaLogo from '../components/RibbaLogo';
import {
  classifyResetUrl,
  heeftHerstelLink,
  herstelHoortBij,
  isHerstelSessie,
  leesSessieId,
  HERSTEL_VLAG,
  RESET_LINK_ONBRUIKBAAR,
} from '../../lib/reset-link';

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

// sessionStorage kan gooien (privacymodus, iframe zonder toestemming). De vlag
// is comfort — hij laat het wachtwoordscherm een herlaad overleven — dus een
// blokkade mag de reset niet tegenhouden.
function leesVlag(): string | null {
  try {
    return window.sessionStorage.getItem(HERSTEL_VLAG);
  } catch {
    return null;
  }
}

function zetVlag(sessieId: string | null) {
  try {
    if (sessieId) window.sessionStorage.setItem(HERSTEL_VLAG, sessieId);
    else window.sessionStorage.removeItem(HERSTEL_VLAG);
  } catch {
    // niets aan te doen; zie leesVlag
  }
}

/**
 * Supabase-fouten zijn Engels en intern ("AAL2 session is required to update
 * email or password when MFA is enabled") — dat hoort niemand op een
 * inlogscherm te lezen. De echte tekst gaat naar de console voor debugging.
 */
function nederlandseFout(bericht: string): string {
  const b = bericht.toLowerCase();
  if (b.includes('aal2')) {
    return 'Voer eerst de code uit je authenticator-app in.';
  }
  if (b.includes('different from the old') || b.includes('should be different')) {
    return 'Kies een wachtwoord dat je nog niet eerder gebruikte.';
  }
  if (b.includes('jwt') || b.includes('session') || b.includes('expired')) {
    return RESET_LINK_ONBRUIKBAAR;
  }
  return 'Er ging iets mis. Probeer het opnieuw.';
}

type Mode = 'loading' | 'request' | 'tweefactor' | 'set-password' | 'success';

export default function ResetPage() {
  const [mode, setMode] = useState<Mode>('loading');
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState('');
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    // De resetlink kan in drie vormen binnenkomen:
    //
    //   1. ?code=<uuid>        PKCE — de huidige vorm
    //   2. #access_token=...   implicit — oudere links, blijft ondersteund
    //   3. #error=...          Supabase weigerde de token
    //
    // De URL wordt hier SYNCHROON gelezen, vóór enige await. Dat is geen
    // stijlkwestie: `detectSessionInUrl` staat in @supabase/ssr 0.9.0 vast aan
    // (createBrowserClient.js:40, ná de spread van jouw opties), dus de client
    // wisselt de code vaak al in — en wist hem uit de balk — voordat deze
    // effect-body draait. Wie de URL ná de await leest, ziet dan niets meer en
    // kan een sessie niet meer aan déze link toeschrijven.
    //
    // Tot 20 aug 2026 werd dat opgevangen met "is er een sessie, dan is de
    // link al verzilverd". Dat gold ook voor een gewone inlogsessie van een
    // ánder account, waardoor de pagina het wachtwoordveld voor het verkeerde
    // account aanbood. Zie lib/reset-link.ts voor het volledige verhaal.
    const supabase = getSupabase();
    const search = window.location.search;
    const hash = window.location.hash;
    const metLink = heeftHerstelLink(search, hash);
    const vlag = leesVlag();

    const schoon = () => window.history.replaceState({}, '', '/reset');

    const naarFout = (text: string) => {
      schoon();
      zetVlag(null);
      setMode('request');
      setMessage({ type: 'error', text });
    };

    /**
     * De link is verzilverd. Voordat we een wachtwoordveld tonen: bij wie
     * hoort deze sessie, en heeft dat account tweefactor?
     *
     * Die tweefactor is geen extra hindernis maar een noodzaak — GoTrue
     * weigert `updateUser({ password })` zolang de sessie geen aal2 is, en
     * terecht: anders zou een resetmail de tweede factor omzeilen.
     */
    const naarWachtwoord = async () => {
      schoon();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        naarFout(RESET_LINK_ONBRUIKBAAR);
        return;
      }
      setAccount(user.email ?? '');

      // De vlag draagt de session_id, niet de user-id: hij mag alleen déze
      // sessie een herlaad laten overleven, en niet meeliften naar een latere
      // gewone login van dezelfde persoon in deze tab.
      const { data: nu } = await supabase.auth.getSession();
      zetVlag(leesSessieId(nu.session?.access_token));

      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        // Expliciet op `verified` filteren. listFactors zeeft in deze versie
        // zelf al op status (auth-js, GoTrueClient.js:2688), maar dat is een
        // interne keuze van de library: een halfafgemaakte enrolment mag hier
        // nooit als tweede factor gelden.
        const totp = factors?.totp?.find((f: Factor) => f.status === 'verified');
        if (!totp) {
          naarFout('Dit account heeft tweefactor aan, maar er is geen werkende app gekoppeld. Neem contact op met team@ribba.app.');
          return;
        }
        setFactorId(totp.id);
        setMode('tweefactor');
        return;
      }

      setMode('set-password');
    };

    (async () => {
      const { data: bestaand } = await supabase.auth.getSession();
      const actie = classifyResetUrl({
        search: window.location.search,
        hash,
        metLink,
        hasSession: Boolean(bestaand.session),
        herstelSessie: isHerstelSessie(bestaand.session?.access_token),
        herstelInGang: herstelHoortBij(vlag, leesSessieId(bestaand.session?.access_token)),
      });

      switch (actie.kind) {
        case 'set-password':
          await naarWachtwoord();
          return;

        case 'exchange-code': {
          const { error } = await supabase.auth.exchangeCodeForSession(actie.code);
          if (error) naarFout(RESET_LINK_ONBRUIKBAAR);
          else await naarWachtwoord();
          return;
        }

        case 'set-session': {
          const { error } = await supabase.auth.setSession({
            access_token: actie.accessToken,
            refresh_token: actie.refreshToken,
          });
          if (error) naarFout(RESET_LINK_ONBRUIKBAAR);
          else await naarWachtwoord();
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
        console.error('resetPasswordForEmail', error);
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

  async function handleTweefactor(e: FormEvent) {
    e.preventDefault();
    setMessage(null);

    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId });
      if (challengeError || !challenge) {
        console.error('mfa.challenge', challengeError);
        setMessage({ type: 'error', text: 'Kon de verificatie niet starten. Probeer het opnieuw.' });
        return;
      }

      const { error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (error) {
        setMessage({ type: 'error', text: 'Deze code klopt niet. Probeer de volgende code uit je app.' });
        return;
      }

      // Een geslaagde verificatie levert nieuwe tokens op. Of de session_id
      // daarbij gelijk blijft is niet vastgelegd in de API-documentatie, dus
      // zetten we de vlag opnieuw op wat er nu daadwerkelijk staat — anders
      // zou een herlaad na de codestap onnodig terugvallen op het
      // e-mailformulier.
      const { data: nu } = await supabase.auth.getSession();
      zetVlag(leesSessieId(nu.session?.access_token));

      setCode('');
      setMode('set-password');
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
        console.error('updateUser', error);
        setMessage({ type: 'error', text: nederlandseFout(error.message ?? '') });
      } else {
        setPassword('');
        setConfirmPassword('');
        zetVlag(null);
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

  const pill =
    mode === 'request' ? 'Wachtwoord vergeten'
      : mode === 'tweefactor' ? 'Verificatie'
        : 'Nieuw wachtwoord';

  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-brand">
          <RibbaLogo height={36} />
        </div>

        <p className="registration-pill">{pill}</p>

        {mode === 'request' && (
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
        )}

        {mode === 'tweefactor' && (
          <>
            <h1>Bevestig met je code</h1>
            <p className="registration-description">
              Dit account heeft tweefactor ingesteld. Vul de zescijferige code uit je
              authenticator-app in om je wachtwoord te mogen wijzigen.
            </p>

            {/* Welk account: zonder dit is niet te zien dát je het verkeerde
                account voor je hebt — precies wat op 20 aug 2026 misging. */}
            {account && (
              <p className="registration-description">
                Je wijzigt het wachtwoord van <strong>{account}</strong>.
              </p>
            )}

            <form onSubmit={handleTweefactor}>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                <div className="form-group">
                  <label htmlFor="code">Code uit je app</label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
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
                    Controleren...
                  </>
                ) : (
                  'Code controleren'
                )}
              </button>
            </form>
          </>
        )}

        {mode === 'set-password' && (
          <>
            <h1>Nieuw wachtwoord instellen</h1>
            <p className="registration-description">
              Kies een nieuw wachtwoord voor je Ribba account. Minimaal 8 tekens.
            </p>

            {account && (
              <p className="registration-description">
                Je wijzigt het wachtwoord van <strong>{account}</strong>.
              </p>
            )}

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
