'use client';

// Mijn Ribba — permanent klantportaal van Ribba (S4-ontwerp). Bewust
// minimaal: Ribba authenticeert, en "Abonnement & facturatie" opent per
// bezoek een VERSE Stripe Customer Portal-sessie via /api/portal. Stripe
// blijft één onderdeel achter deze pagina; support en licenties blijven
// bij Ribba.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../components/RibbaLogo';

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

    try {
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ school_id: schoolId }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setError(body.error || 'De beheerpagina kon niet worden geopend. Probeer het opnieuw.');
        setPortalBusy(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError('Kan geen verbinding maken. Probeer het opnieuw.');
      setPortalBusy(false);
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
