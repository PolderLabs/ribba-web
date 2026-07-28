'use client';

// Mijn Ribba — permanent klantportaal van Ribba (S4-ontwerp). Bewust
// minimaal: Ribba authenticeert, en "Abonnement & facturatie" opent per
// bezoek een VERSE Stripe Customer Portal-sessie via de Supabase edge
// function stripe-portal-session (B5: alle Stripe-secrets blijven in de
// projectbrede Supabase-set; hier alleen de user-JWT). Stripe blijft één
// onderdeel achter deze pagina; support en licenties blijven bij Ribba.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../components/RibbaLogo';
import { createPortalGate, openStripePortal } from '@/lib/stripe-upgrade';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabaseBrowser() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

export default function MijnRibbaPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fase 2a: het portaal geeft toegang tot betaalmethode en facturatie en is
  // daarmee eigenaar-only. Default true zodat er tijdens het laden niets
  // knippert; de edge function is en blijft de poort (403 voor niet-eigenaren).
  const [canManageSubscription, setCanManageSubscription] = useState(true);
  // Synchrone request-level dubbelklikblokkade (correctieronde 21 jul):
  // portalBusy/disabled is UI-bescherming, maar twee click-events kunnen
  // dezelfde render-state zien; deze ref-gate niet.
  const portalGateRef = useRef(createPortalGate());

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.replace('/login');
        return;
      }
      setUserEmail(data.session.user.email ?? null);
      try {
        const meRes = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.school_id) setSchoolId(me.school_id);
          if (me.school_name) setSchoolName(me.school_name);
          if (me.school_id) {
            // Bevoegdheid komt uit dezelfde bron als /upgrade gebruikt.
            // Ontbreekt het veld (oudere API-versie), dan schermen we niets
            // af — de server weigert alsnog.
            const planRes = await fetch(`/api/current-plan?school_id=${me.school_id}`, {
              headers: { Authorization: `Bearer ${data.session.access_token}` },
            });
            if (planRes.ok) {
              const body = await planRes.json();
              setCanManageSubscription(body.canManageSubscription !== false);
            }
          }
        }
      } catch {
        // foutafhandeling hieronder via ontbrekende schoolId
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  const openPortal = async () => {
    if (!schoolId) return;
    // Lock vóór getSession/fetch; een tweede aanroep stopt hier synchroon.
    if (!portalGateRef.current.begin()) return;
    setPortalBusy(true);
    setError(null);

    try {
      // Refresh-veilige token-fetch (zelfde patroon als /upgrade).
      const supabase = getSupabaseBrowser();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.replace('/login');
        return;
      }

      const result = await openStripePortal({
        supabaseUrl,
        accessToken: token,
        schoolId,
      });
      if (!result.ok) {
        setError(result.error);
        setPortalBusy(false);
        return;
      }
      // Succes: portalBusy blijft staan tot de navigatie de pagina verlaat;
      // de gate komt in finally vrij, dus een bewuste nieuwe sessie kan.
      window.location.href = result.url;
    } finally {
      portalGateRef.current.end();
    }
  };

  return (
    <main className="page-wrapper">
      <div className="card">
        <div className="logo"><RibbaLogo height={36} /></div>
        <h1>Mijn Ribba</h1>

        {loading ? (
          <p className="subtitle">Laden…</p>
        ) : (
          <>
            <p className="subtitle">
              {schoolName ? <strong>{schoolName}</strong> : 'Je rijschool'}
              {userEmail ? <> · ingelogd als {userEmail}</> : null}
            </p>

            {error && <div className="checkout-error">{error}</div>}

            {canManageSubscription ? (
              <>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={openPortal}
                  disabled={!schoolId || portalBusy}
                >
                  {portalBusy ? 'Bezig…' : 'Abonnement & facturatie beheren'}
                </button>
                <p className="footer-text" style={{ marginTop: 12 }}>
                  Facturen downloaden, betaalmethode wijzigen of opzeggen — veilig via Stripe.
                </p>
              </>
            ) : (
              /* Fase 2a: beheerders zien wél hun abonnement, maar wijzigen het
                 niet. Zonder deze uitleg zou de pagina er simpelweg leeg
                 uitzien. Geen omweg naar checkout of naar Ribba: de eigenaar
                 beheert het abonnement. */
              <div className="checkout-error" style={{ background: '#FEF3C7', borderColor: '#FDE68A', color: '#78350F' }}>
                <strong style={{ display: 'block', marginBottom: 4 }}>
                  Alleen de eigenaar beheert het abonnement
                </strong>
                Je ziet hier wat je rijschool afneemt, maar je kunt het abonnement,
                de betaalmethode en de facturatie niet wijzigen. Vraag de eigenaar
                van de rijschool om dit te doen.
              </div>
            )}

            <div className="divider" />

            <p className="footer-text">
              Abonnement kiezen of wijzigen? <a href="/upgrade">Bekijk de plannen</a>.<br />
              Vragen? <a href="mailto:hallo@ribba.app">hallo@ribba.app</a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
