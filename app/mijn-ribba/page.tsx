'use client';

// Mijn Ribba — permanent klantportaal van Ribba (S4-ontwerp). Bewust
// minimaal: Ribba authenticeert, en "Abonnement & facturatie" opent per
// bezoek een VERSE Stripe Customer Portal-sessie via de Supabase edge
// function stripe-portal-session (B5: alle Stripe-secrets blijven in de
// projectbrede Supabase-set; hier alleen de user-JWT). Stripe blijft één
// onderdeel achter deze pagina; support en licenties blijven bij Ribba.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../components/RibbaLogo';
import { openStripePortal } from '@/lib/stripe-upgrade';

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
        }
      } catch {
        // foutafhandeling hieronder via ontbrekende schoolId
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  const openPortal = async () => {
    if (!schoolId || portalBusy) return;
    setPortalBusy(true);
    setError(null);

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
    window.location.href = result.url;
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
