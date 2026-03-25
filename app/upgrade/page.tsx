'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

const premiumFeatures = [
  { icon: '📊', title: 'Statistieken', desc: 'Uren, slagingspercentage, omzet & meer' },
  { icon: '🤖', title: 'Ribba AI Assistent', desc: 'Stel vragen en krijg direct antwoord' },
  { icon: '🛒', title: 'Webshop voor leerlingen', desc: 'Leerlingen bestellen pakketten & producten via de app' },
  { icon: '🧾', title: 'Termijnfacturering', desc: 'Automatisch facturen genereren bij pakkettoewijzing' },
  { icon: '💳', title: 'Mollie (iDEAL)', desc: 'Leerlingen betalen direct via iDEAL' },
  { icon: '📒', title: 'Moneybird boekhouding', desc: 'Facturen & contacten automatisch synchroniseren' },
  { icon: '🪪', title: 'CBR TOP koppeling', desc: 'Examens automatisch ophalen, slagingspercentage & resultaten bijhouden' },
  { icon: '👥', title: 'Meerdere instructeurs', desc: 'Voeg extra instructeurs toe aan je rijschool' },
];

const basicFeatures = [
  'Onbeperkt lessen plannen',
  'Leerlingbeheer (max 25)',
  'Voertuigbeheer',
  'Handmatige facturering',
  'Opleidingen & lestypes',
  'Help Center & WhatsApp Support',
];

const trialFeatures = [
  'Alle Premium-functies',
  'Onbeperkt leerlingen',
  'Geen creditcard nodig',
  'Na 30 dagen kies je je plan',
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
    : 'Start gratis of kies direct het plan dat bij je rijschool past.';

  return (
    <main className="upgrade-page">
      <div className="upgrade-container">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div className="logo">Ribba</div>
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
        <div className="plans-grid plans-grid-3">
          {/* Trial */}
          <div className={`plan-card plan-card-trial${isTrial ? ' plan-card-current' : ''}`}>
            {isTrial && <div className="plan-current-badge">Huidig</div>}
            <div className="plan-header">
              <span className="pill pill-green">Gratis</span>
              <div className="plan-price">
                <span className="plan-amount">&euro;0</span>
                <span className="plan-period">/30 dagen</span>
              </div>
              <p className="plan-desc">
                Probeer Ribba 30 dagen gratis met alle functies.
              </p>
            </div>

            <div className="plan-features">
              {trialFeatures.map((feat) => (
                <div key={feat} className="plan-feature-row">
                  <CheckIcon color="#16A34A" />
                  <span>{feat}</span>
                </div>
              ))}
            </div>

            {isTrial ? (
              <div className="btn-current">Huidig abonnement</div>
            ) : !currentPlan ? (
              <button
                className="btn-trial"
                style={{ marginTop: 'auto' }}
                onClick={() => handleCheckout('premium')}
                disabled={loading !== null}
              >
                {loading === 'premium' ? 'Bezig...' : 'Start gratis'}
              </button>
            ) : (
              <div style={{ marginTop: 'auto' }} />
            )}
          </div>

          {/* Basic Plan */}
          <div className={`plan-card${isCurrentPlan('basic') ? ' plan-card-current' : ''}`}>
            {isCurrentPlan('basic') && <div className="plan-current-badge">Huidig</div>}
            <div className="plan-header">
              <span className="pill">Basic</span>
              <div className="plan-price">
                <span className="plan-amount">&euro;29</span>
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
                <span className="plan-amount">&euro;59</span>
                <span className="plan-period">/maand</span>
              </div>
              <p className="plan-desc">
                Alles uit Basic, plus krachtige tools om te groeien.
              </p>
            </div>

            <div className="plan-features">
              <div className="plan-feature-row plan-feature-included">
                <CheckIcon color="#2563EB" />
                <span>Alles uit Basic</span>
              </div>
              <div className="plan-feature-row plan-feature-included">
                <CheckIcon color="#2563EB" />
                <span>Onbeperkt leerlingen</span>
              </div>

              <div className="plan-features-divider" />

              {premiumFeatures.map((feat) => (
                <div key={feat.title} className="plan-feature-row">
                  <span className="plan-feature-icon">{feat.icon}</span>
                  <div>
                    <span className="plan-feature-title">{feat.title}</span>
                    <span className="plan-feature-desc">{feat.desc}</span>
                  </div>
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
            <div className="logo">Ribba</div>
            <p className="subtitle">Laden...</p>
          </div>
        </main>
      }
    >
      <UpgradeContent />
    </Suspense>
  );
}
