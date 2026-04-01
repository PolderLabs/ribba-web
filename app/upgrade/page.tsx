'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import RibbaLogo from '../components/RibbaLogo';

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
  const schoolId = searchParams.get('school_id');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [isTrial, setIsTrial] = useState(false);
  const [planLoading, setPlanLoading] = useState(true);

  // Fetch current plan
  useEffect(() => {
    if (!schoolId) {
      setPlanLoading(false);
      return;
    }
    fetch(`/api/current-plan?school_id=${schoolId}`)
      .then((res) => res.json())
      .then((data) => {
        setCurrentPlan(data.plan);
        setIsTrial(data.isTrial || false);
      })
      .catch(() => {})
      .finally(() => setPlanLoading(false));
  }, [schoolId]);

  const handleCheckout = async (plan: 'basic' | 'premium') => {
    if (!schoolId) {
      setError('Geen rijschool gekoppeld. Open deze pagina vanuit de Ribba app.');
      return;
    }

    setLoading(plan);
    setError(null);

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
