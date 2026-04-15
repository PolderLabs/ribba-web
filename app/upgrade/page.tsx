'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../components/RibbaLogo';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabaseBrowser() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

const basicFeatures = [
  'Tot 30 actieve leerlingen',
  '1 instructeur',
  'Alle koppelingen (CBR, Moneybird, Mollie)',
  'Facturatie & pakketten',
  'Leerling-app',
  'Help Center & WhatsApp Support',
];

const premiumFeatures = [
  'Onbeperkte leerlingen',
  'Tot 5 instructeurs',
  'Alle koppelingen (CBR, Moneybird, Mollie)',
  'Facturatie & pakketten',
  'Leerling-app',
  'Prioriteit support',
];

function CheckIcon({ color = '#16A34A' }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fill={color} />
    </svg>
  );
}

function UpgradeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const schoolIdFromUrl = searchParams.get('school_id');
  const [schoolId, setSchoolId] = useState<string | null>(schoolIdFromUrl);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [isTrial, setIsTrial] = useState(false);
  const [cancelledAt, setCancelledAt] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState(false);

  // Auth + resolve school_id (from URL or via Supabase session)
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.replace('/login');
        return;
      }
      const token = data.session.access_token;
      setAccessToken(token);

      // Resolve school_id: URL > /api/me lookup
      let resolvedSchoolId = schoolIdFromUrl;
      if (!resolvedSchoolId) {
        try {
          const meRes = await fetch('/api/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!meRes.ok) {
            setError('Geen rijschool gekoppeld aan dit account.');
            setPlanLoading(false);
            return;
          }
          const me = await meRes.json();
          resolvedSchoolId = me.school_id;
          setSchoolId(resolvedSchoolId);
        } catch {
          setError('Kan geen verbinding maken met de server.');
          setPlanLoading(false);
          return;
        }
      }

      if (!resolvedSchoolId) {
        setPlanLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/current-plan?school_id=${resolvedSchoolId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return;
        }
        const body = await res.json();
        setCurrentPlan(body.plan);
        setIsTrial(body.isTrial || false);
        setCancelledAt(body.cancelledAt || null);
        setPeriodEnd(body.periodEnd || null);
      } catch {
        // ignore
      } finally {
        setPlanLoading(false);
      }
    });
  }, [schoolIdFromUrl, router]);

  const handleCheckout = async (plan: 'basic' | 'premium') => {
    if (!schoolId) {
      setError('Geen rijschool gekoppeld. Open deze pagina vanuit de Ribba app.');
      return;
    }
    if (!accessToken) {
      router.replace('/login');
      return;
    }

    setLoading(plan);
    setError(null);

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ school_id: schoolId, plan }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Er ging iets mis.');
        setLoading(null);
        return;
      }

      window.location.href = data.checkoutUrl;
    } catch {
      setError('Kan geen verbinding maken. Probeer het opnieuw.');
      setLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!schoolId || !accessToken) return;
    if (!confirm('Weet je zeker dat je je abonnement wilt opzeggen? Je houdt toegang tot het einde van de huidige betaalperiode.')) {
      return;
    }

    setCancelling(true);
    setError(null);

    try {
      const res = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ school_id: schoolId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Er ging iets mis bij het opzeggen.');
        setCancelling(false);
        return;
      }

      setCancelSuccess(true);
      setCancelledAt(new Date().toISOString());
    } catch {
      setError('Kan geen verbinding maken. Probeer het opnieuw.');
    } finally {
      setCancelling(false);
    }
  };

  const isCurrentPlan = (plan: string) => {
    if (isTrial) return false;
    return currentPlan === plan;
  };

  const canUpgradeTo = (plan: string) => {
    if (isTrial) return true;
    if (!currentPlan) return true;
    if (plan === 'premium' && currentPlan === 'basic') return true;
    return false;
  };

  // Header text based on plan
  const headerTitle = currentPlan && !isTrial ? 'Jouw abonnement' : 'Kies je plan';
  const headerSubtitle = currentPlan && !isTrial
    ? `Je hebt momenteel het ${currentPlan === 'premium' ? 'Premium' : 'Basic'} abonnement.`
    : 'Kies het plan dat bij je rijschool past.';

  return (
    <main className="upgrade-page">
      <div className="upgrade-container">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div className="logo"><RibbaLogo height={36} /></div>
          <h1 style={{ fontSize: 36, marginBottom: 8 }}>{headerTitle}</h1>
          <p className="subtitle">
            {planLoading ? 'Laden...' : headerSubtitle}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="checkout-error">
            {error}
          </div>
        )}

        {/* Plan Cards */}
        <div className="plans-grid">
          {/* Basic Plan */}
          <div className={`plan-card${isCurrentPlan('basic') ? ' plan-card-current' : ''}`}>
            {isCurrentPlan('basic') && <div className="plan-current-badge">Huidig</div>}
            <div className="plan-header">
              <span className="pill">Basic</span>
              <div className="plan-price">
                <span className="plan-amount">&euro;25</span>
                <span className="plan-period">/maand</span>
              </div>
              <p className="plan-desc">
                Alles wat je nodig hebt om je rijschool te draaien.
              </p>
            </div>

            <div className="plan-features">
              {basicFeatures.map((feat) => (
                <div key={feat} className="plan-feature-row">
                  <CheckIcon />
                  <span>{feat}</span>
                </div>
              ))}
            </div>

            {isCurrentPlan('basic') ? (
              <div className="btn-current">Huidig abonnement</div>
            ) : canUpgradeTo('basic') ? (
              <button
                className="btn-secondary"
                style={{ marginTop: 'auto' }}
                onClick={() => handleCheckout('basic')}
                disabled={loading !== null}
              >
                {loading === 'basic' ? 'Bezig...' : 'Kies Basic'}
              </button>
            ) : (
              <div style={{ marginTop: 'auto' }} />
            )}
          </div>

          {/* Premium Plan */}
          <div className={`plan-card plan-card-premium${isCurrentPlan('premium') ? ' plan-card-current-premium' : ''}`}>
            {isCurrentPlan('premium') ? (
              <div className="plan-current-badge plan-current-badge-premium">Huidig</div>
            ) : (
              <div className="plan-popular">Meest gekozen</div>
            )}
            <div className="plan-header">
              <span className="pill pill-premium">Premium</span>
              <div className="plan-price">
                <span className="plan-amount">&euro;45</span>
                <span className="plan-period">/maand</span>
              </div>
              <p className="plan-desc">
                Groei je rijschool met meer leerlingen en instructeurs.
              </p>
            </div>

            <div className="plan-features">
              {premiumFeatures.map((feat) => (
                <div key={feat} className="plan-feature-row">
                  <CheckIcon color="#2563EB" />
                  <span>{feat}</span>
                </div>
              ))}
            </div>

            {isCurrentPlan('premium') ? (
              <div className="btn-current btn-current-premium">Huidig abonnement</div>
            ) : canUpgradeTo('premium') ? (
              <button
                className="btn-primary"
                style={{ marginTop: 'auto' }}
                onClick={() => handleCheckout('premium')}
                disabled={loading !== null}
              >
                {loading === 'premium' ? 'Bezig...' : (currentPlan === 'basic' ? 'Upgrade naar Premium' : 'Kies Premium')}
              </button>
            ) : (
              <div style={{ marginTop: 'auto' }} />
            )}
          </div>
        </div>

        {/* Cancel subscription */}
        {currentPlan && !isTrial && !cancelledAt && !cancelSuccess && (
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <button
              onClick={handleCancel}
              disabled={cancelling}
              style={{
                background: 'none',
                border: 'none',
                color: '#DC2626',
                fontSize: 14,
                fontWeight: 500,
                cursor: cancelling ? 'not-allowed' : 'pointer',
                textDecoration: 'underline',
                opacity: cancelling ? 0.5 : 1,
              }}
            >
              {cancelling ? 'Bezig met opzeggen...' : 'Abonnement opzeggen'}
            </button>
          </div>
        )}

        {(cancelledAt || cancelSuccess) && (
          <div
            style={{
              marginTop: 32,
              padding: 16,
              background: '#FEF3C7',
              border: '1px solid #FCD34D',
              borderRadius: 12,
              textAlign: 'center',
              color: '#92400E',
              fontSize: 14,
            }}
          >
            Je abonnement is opgezegd.
            {periodEnd && (
              <> Je hebt toegang tot <strong>{new Date(periodEnd).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.</>
            )}
            {!periodEnd && ' Je hebt nog toegang tot het einde van de huidige betaalperiode.'}
          </div>
        )}

        {/* Bottom */}
        <div style={{ textAlign: 'center', marginTop: 48 }}>
          <p style={{ fontSize: 14, color: '#78716C', lineHeight: 1.8 }}>
            Annuleer wanneer je wilt. Geen verplichtingen.<br />
            Alle prijzen zijn exclusief BTW.
          </p>
          <div className="divider" />
          <p style={{ fontSize: 13, color: '#A8A29E' }}>
            Vragen?{' '}
            <a href="mailto:hallo@ribba.app" style={{ color: '#2563EB', fontWeight: 600 }}>
              hallo@ribba.app
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function UpgradePage() {
  return (
    <Suspense
      fallback={
        <main className="upgrade-page">
          <div className="upgrade-container" style={{ textAlign: 'center', paddingTop: 120 }}>
            <div className="logo"><RibbaLogo height={36} /></div>
            <p className="subtitle">Laden...</p>
          </div>
        </main>
      }
    >
      <UpgradeContent />
    </Suspense>
  );
}
