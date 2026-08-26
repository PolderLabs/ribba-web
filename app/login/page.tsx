'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../components/RibbaLogo';
import Link from 'next/link';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabase() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

// returnTo uit de query (issue #44): alleen same-origin relatieve paden —
// géén '//host', backslashes of schema's — anders open-redirect.
function safeReturnTo(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('returnTo');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes(':')) {
    return null;
  }
  return raw;
}

async function redirectAfterLogin(accessToken: string, router: ReturnType<typeof useRouter>) {
  // Bewaarde bestemming (bv. deep-link uit de app naar
  // /mijn-ribba/referral/betaling) wint; de doelpagina doet zijn eigen
  // auth-/rolchecks, dus de /api/me-check hier overslaan is veilig.
  const returnTo = safeReturnTo();
  if (returnTo) {
    router.replace(returnTo);
    return;
  }
  const res = await fetch('/api/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error('Geen rijschool gekoppeld aan dit account.');
  }
  const { school_id } = await res.json();
  router.replace(`/upgrade?school_id=${school_id}`);
}

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if already logged in
  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        redirectAfterLogin(data.session.access_token, router).catch((err) => {
          setError(err.message || 'Er ging iets mis.');
          setChecking(false);
        });
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Vul je e-mailadres en wachtwoord in.');
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInError || !data.session) {
        setError('E-mailadres of wachtwoord is onjuist.');
        setLoading(false);
        return;
      }

      await redirectAfterLogin(data.session.access_token, router);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis. Probeer het opnieuw.');
      setLoading(false);
    }
  }

  if (checking) {
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

  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-brand">
          <RibbaLogo height={36} />
        </div>

        <p className="registration-pill">Inloggen</p>

        <h1>Welkom terug</h1>
        <p className="registration-description">
          Log in om je abonnement te beheren.
        </p>

        <form onSubmit={handleLogin}>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="form-group">
              <label htmlFor="email">E-mailadres</label>
              <input
                id="email"
                type="email"
                placeholder="jan@voorbeeld.nl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Wachtwoord</label>
              <input
                id="password"
                type="password"
                placeholder="Je wachtwoord"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && (
            <div className="alert alert-error">{error}</div>
          )}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" />
                Inloggen...
              </>
            ) : (
              'Inloggen'
            )}
          </button>
        </form>

        <div className="divider" />

        <p className="footer-text" style={{ textAlign: 'center' }}>
          <Link href="/reset">Wachtwoord vergeten?</Link>
        </p>
        <p className="footer-text" style={{ textAlign: 'center', marginTop: 8 }}>
          Vragen? Neem contact op met{' '}
          <a href="mailto:team@ribba.app">team@ribba.app</a>
        </p>
      </section>
    </main>
  );
}
