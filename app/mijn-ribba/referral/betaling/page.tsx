'use client';

// SEPA-machtiging voor het referral-programma van de rijschool. De Ribba-app
// (ribbaPro) deep-linkt eigenaren hierheen; na een geslaagde machtiging kan
// het programma met cash-rewards geactiveerd worden. Bestaat naast de
// Mollie-abonnements-incasso: dit mandaat financiert uitsluitend bevestigde
// referral-payouts (commissie + servicekosten).

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import RibbaLogo from '@/app/components/RibbaLogo';

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

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

function SetupForm({ onError }: { onError: (msg: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/mijn-ribba/referral/betaling?setup=return`,
      },
    });
    // Bij succes redirect Stripe; hier komen we alleen bij een fout.
    if (error) {
      onError(error.message ?? 'De machtiging kon niet worden afgerond.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <div className="form-submit">
        <button type="submit" className="btn-primary" disabled={busy || !stripe} style={{ marginTop: 20 }}>
          {busy ? 'Bezig…' : 'Machtiging afgeven'}
        </button>
      </div>
    </form>
  );
}

type PageState =
  | { phase: 'loading' }
  | { phase: 'unauthenticated' }
  // Bestaand abonnements-mandaat gevonden → één-klik-adoptie aanbieden
  | { phase: 'offer'; last4: string | null }
  | { phase: 'form'; clientSecret: string; schoolName: string }
  | { phase: 'waiting' } // terug van Stripe, wacht op webhook
  | { phase: 'active' }
  | { phase: 'error'; message: string };

const LOGIN_WITH_RETURN = `/login?returnTo=${encodeURIComponent('/mijn-ribba/referral/betaling')}`;

export default function ReferralBetalingPage() {
  const router = useRouter();
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  const sessionRef = useRef<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adoptBusy, setAdoptBusy] = useState(false);

  // Nieuwe-machtiging-flow: SetupIntent ophalen en het Payment Element tonen.
  const startNewMandateFlow = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    setState({ phase: 'loading' });
    const res = await fetch('/api/referral/school/setup-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.client_secret) {
      setState({ phase: 'error', message: data?.error ?? 'Er ging iets mis.' });
      return;
    }
    setState({ phase: 'form', clientSecret: data.client_secret, schoolName: data.school_name });
  }, []);

  // Eén-klik-adoptie van het bestaande abonnements-mandaat.
  const adoptMandate = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    setAdoptBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/referral/school/adopt-mandate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.sepa_mandate_status !== 'active') {
        throw new Error(data?.error ?? 'Bevestigen mislukt. Probeer het opnieuw.');
      }
      setState({ phase: 'active' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Onbekende fout');
    } finally {
      setAdoptBusy(false);
    }
  }, []);

  const pollStatus = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    // Poll tot de webhook de mandaatstatus op 'active' heeft gezet (max ~30s).
    for (let i = 0; i < 10; i++) {
      const res = await fetch('/api/referral/school/setup-status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json().catch(() => null);
      if (data?.sepa_mandate_status === 'active') {
        setState({ phase: 'active' });
        return;
      }
      if (data?.sepa_mandate_status === 'failed') {
        setState({ phase: 'error', message: 'De machtiging is niet gelukt. Probeer het opnieuw.' });
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    setState({ phase: 'waiting' });
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await getSupabase().auth.getSession();
      sessionRef.current = session;
      if (!session) {
        // Direct naar login mét bewaarde bestemming (issue #44) — de
        // app-deep-link strandt anders na inloggen op de abonnement-pagina.
        setState({ phase: 'unauthenticated' });
        router.replace(LOGIN_WITH_RETURN);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      if (params.get('setup') === 'return') {
        const redirectStatus = params.get('redirect_status');
        window.history.replaceState(null, '', '/mijn-ribba/referral/betaling');
        if (redirectStatus === 'succeeded' || redirectStatus === 'processing') {
          setState({ phase: 'waiting' });
          void pollStatus();
          return;
        }
        setError('De machtiging is niet afgerond. Probeer het opnieuw.');
      }

      // Al actief? Dan geen formulier meer tonen. Zo niet: is er een bestaand
      // abonnements-mandaat om te adopteren, bied dan de één-klik-route aan.
      const optionsRes = await fetch('/api/referral/school/mandate-options', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const options = await optionsRes.json().catch(() => null);
      if (options?.sepa_mandate_status === 'active') {
        setState({ phase: 'active' });
        return;
      }
      if (options?.existing_mandate) {
        setState({ phase: 'offer', last4: options.existing_mandate.last4 ?? null });
        return;
      }

      await startNewMandateFlow();
    })();
  }, [pollStatus, startNewMandateFlow, router]);

  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-brand">
          <RibbaLogo height={36} />
        </div>

        <p className="registration-pill">Referral-programma</p>
        <h1>SEPA-machtiging voor uitbetalingen</h1>

        {state.phase === 'loading' && <p className="registration-description">Laden…</p>}

        {state.phase === 'unauthenticated' && (
          <p className="registration-description">
            Log eerst in op je Ribba-account om de machtiging af te geven.{' '}
            <Link href={LOGIN_WITH_RETURN} className="text-link">Naar inloggen</Link>
          </p>
        )}

        {state.phase === 'error' && (
          <div className="alert alert-error">{state.message}</div>
        )}

        {state.phase === 'active' && (
          <div className="alert alert-success">
            <strong>Machtiging actief ✓</strong>
            <br />
            Je kunt het referral-programma nu activeren in de Ribba-app. Bevestigde
            uitbetalingen (commissie + servicekosten) worden voortaan automatisch
            via SEPA geïncasseerd.
          </div>
        )}

        {state.phase === 'offer' && (
          <>
            <p className="registration-description">
              Je betaalt je Ribba-abonnement al via automatische SEPA-incasso
              {state.last4 ? (
                <> (rekening eindigend op <strong>{state.last4}</strong>)</>
              ) : null}
              . Je kunt diezelfde machtiging óók gebruiken voor
              referral-uitbetalingen — dan hoef je geen tweede machtiging af te
              geven.
            </p>
            <p className="registration-description">
              Met je bevestiging incasseert Ribba voortaan de door jou{' '}
              <strong>bevestigde</strong> referral-uitbetalingen (commissie +
              servicekosten; het bedrag verschilt per uitbetaling) van deze
              rekening. Je bevestigt elke uitbetaling zelf in de Ribba-app;
              zonder jouw bevestiging wordt er nooit geïncasseerd.
            </p>
            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
            <button
              type="button"
              className="btn-primary"
              disabled={adoptBusy}
              onClick={() => { void adoptMandate(); }}
            >
              {adoptBusy ? 'Bezig…' : 'Gebruik mijn bestaande incassomachtiging'}
            </button>
            <button
              type="button"
              className="chat-link-button"
              disabled={adoptBusy}
              onClick={() => { void startNewMandateFlow(); }}
            >
              Liever een aparte machtiging afgeven voor referrals
            </button>
          </>
        )}

        {state.phase === 'waiting' && (
          <div className="alert alert-info">
            De machtiging wordt verwerkt… Dit kan een minuut duren. Je kunt deze
            pagina later opnieuw openen om de status te controleren.
          </div>
        )}

        {state.phase === 'form' && (
          <>
            <p className="registration-description">
              Met deze eenmalige machtiging incasseert Ribba automatisch de door
              jou <strong>bevestigde</strong> referral-uitbetalingen (commissie +
              servicekosten) van <strong>{state.schoolName}</strong>. Je bevestigt
              elke uitbetaling zelf in de Ribba-app; zonder jouw bevestiging wordt
              er nooit geïncasseerd.
            </p>
            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
            {stripePromise ? (
              <Elements
                stripe={stripePromise}
                options={{ clientSecret: state.clientSecret, locale: 'nl' }}
              >
                <SetupForm onError={setError} />
              </Elements>
            ) : (
              <div className="alert alert-error">Stripe is niet geconfigureerd.</div>
            )}
          </>
        )}

        <div className="divider" />
        <p className="footer-text">
          Vragen? Neem contact op met <a href="mailto:team@ribba.app">team@ribba.app</a>
        </p>
      </section>
    </main>
  );
}
