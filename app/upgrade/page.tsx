'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import RibbaLogo from '../components/RibbaLogo';
import { BASIC_MAX_STUDENTS, BASIC_MAX_INSTRUCTORS } from '@/lib/plan-limits';
import { getPlanPricing, formatCentsForDisplay } from '@/lib/plan-pricing';

const basicPricing = getPlanPricing('basic');
const premiumPricing = getPlanPricing('premium');

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
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [cancelledAt, setCancelledAt] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [activeStudents, setActiveStudents] = useState<number | null>(null);
  const [activeInstructors, setActiveInstructors] = useState<number | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);

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
      setUserEmail(data.session.user.email ?? null);

      // Resolve school_id + school_name via /api/me lookup
      // (ook als school_id uit URL komt — dan halen we alleen de naam op)
      let resolvedSchoolId: string | null = schoolIdFromUrl;
      try {
        const meRes = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.school_name) setSchoolName(me.school_name);
          if (!resolvedSchoolId && me.school_id) {
            resolvedSchoolId = me.school_id;
            setSchoolId(me.school_id);
          }
        } else if (!resolvedSchoolId) {
          setError('Geen rijschool gekoppeld aan dit account.');
          setPlanLoading(false);
          return;
        }
      } catch {
        if (!resolvedSchoolId) {
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
        const [planRes, usageRes] = await Promise.all([
          fetch(`/api/current-plan?school_id=${resolvedSchoolId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`/api/school-usage?school_id=${resolvedSchoolId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        if (planRes.status === 401 || planRes.status === 403) {
          router.replace('/login');
          return;
        }
        const body = await planRes.json();
        setCurrentPlan(body.plan);
        setIsTrial(body.isTrial || false);
        setTrialEndsAt(body.trialEndsAt || null);
        setCancelledAt(body.cancelledAt || null);
        setPeriodEnd(body.periodEnd || null);

        if (usageRes.ok) {
          const usage = await usageRes.json();
          setActiveStudents(usage.active_students ?? 0);
          setActiveInstructors(usage.active_instructors ?? 0);
        }
      } catch {
        // ignore
      } finally {
        setPlanLoading(false);
      }
    });
  }, [schoolIdFromUrl, router]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const supabase = getSupabaseBrowser();
      await supabase.auth.signOut();
    } catch {
      // ignore — we sturen toch door
    }
    router.replace('/login');
  };

  const handleCheckout = async (plan: 'basic' | 'premium') => {
    if (!schoolId) {
      setError('Geen rijschool gekoppeld. Open deze pagina vanuit de Ribba app.');
      return;
    }

    setLoading(plan);
    setError(null);

    // Refresh-veilige token-fetch: Supabase access-tokens vervallen na ~1u,
    // dus haal 'm vlak vóór de call op (de client refresht automatisch).
    const supabase = getSupabaseBrowser();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.replace('/login');
      return;
    }
    setAccessToken(token);

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
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

  const handleCancel = () => {
    if (!schoolId) return;
    setShowCancelModal(true);
  };

  const confirmCancel = async () => {
    if (!schoolId) return;
    setShowCancelModal(false);
    setCancelling(true);
    setError(null);

    // Refresh-veilige token-fetch (zie handleCheckout)
    const supabase = getSupabaseBrowser();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.replace('/login');
      return;
    }
    setAccessToken(token);

    try {
      const res = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
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

  // Basic-limietcheck: spiegelt /api/checkout (regel 86-125) zodat de gebruiker
  // niet eerst hoeft te klikken om een 400 te krijgen. Counts nog laden? → null;
  // dan niet pre-blokkeren maar server-side check vangt 't alsnog op.
  const basicBlockedReason: string | null = (() => {
    if (activeStudents !== null && activeStudents > BASIC_MAX_STUDENTS) {
      return `Te veel actieve leerlingen voor Basic (${activeStudents}/${BASIC_MAX_STUDENTS}). Kies Premium, of archiveer leerlingen tot ${BASIC_MAX_STUDENTS}.`;
    }
    if (activeInstructors !== null && activeInstructors > BASIC_MAX_INSTRUCTORS) {
      return `Te veel actieve instructeurs voor Basic (${activeInstructors}/${BASIC_MAX_INSTRUCTORS}). Kies Premium om met meerdere instructeurs te werken.`;
    }
    return null;
  })();

  // Header text based on plan
  const headerTitle = isTrial
    ? 'Kies je plan'
    : currentPlan
      ? 'Jouw abonnement'
      : 'Kies je plan';
  const headerSubtitle = isTrial
    ? 'Kies een plan voordat je proefperiode afloopt.'
    : currentPlan
      ? `Je hebt momenteel het ${currentPlan === 'premium' ? 'Premium' : 'Basic'} abonnement.`
      : 'Kies het plan dat bij je rijschool past.';

  const trialEndFormatted = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString('nl-NL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <main className="upgrade-page">
      <div className="upgrade-container">
        {/* Account-bar: toont wie ingelogd is + uitloggen */}
        {userEmail && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 12,
              fontSize: 13,
              color: '#57534E',
              marginBottom: 24,
              flexWrap: 'wrap',
            }}
          >
            <span>
              Ingelogd als{' '}
              <strong style={{ color: '#1C1917' }}>{userEmail}</strong>
              {schoolName && (
                <>
                  {' '}· <strong style={{ color: '#1C1917' }}>{schoolName}</strong>
                </>
              )}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              style={{
                background: 'none',
                border: 'none',
                color: '#2563EB',
                fontSize: 13,
                fontWeight: 600,
                cursor: signingOut ? 'not-allowed' : 'pointer',
                textDecoration: 'underline',
                padding: 0,
                opacity: signingOut ? 0.5 : 1,
              }}
            >
              {signingOut ? 'Uitloggen…' : 'Uitloggen'}
            </button>
          </div>
        )}

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div className="logo"><RibbaLogo height={36} /></div>
          <h1 style={{ fontSize: 36, marginBottom: 8 }}>{headerTitle}</h1>
          <p className="subtitle">
            {planLoading ? 'Even kijken of je bent ingelogd…' : headerSubtitle}
          </p>
        </div>

        {/* Tijdens auth-check / session lookup: alleen spinner — geen plan-kaarten,
            zodat we geen flash van content tonen voordat we redirecten naar /login. */}
        {planLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
          </div>
        )}

        {/* Trial-banner: tijdens proefperiode heeft de school feitelijk Premium-toegang */}
        {isTrial && !planLoading && (
          <div
            style={{
              maxWidth: 780,
              margin: '0 auto 32px',
              padding: '16px 20px',
              background: '#EFF6FF',
              border: '1px solid #BFDBFE',
              borderRadius: 14,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              color: '#1E3A8A',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#2563EB',
                color: '#fff',
                fontSize: 11,
                fontWeight: 800,
                padding: '4px 10px',
                borderRadius: 999,
                letterSpacing: 0.4,
                whiteSpace: 'nowrap',
                marginTop: 2,
              }}
            >
              PROEFPERIODE
            </span>
            <div>
              Je gebruikt nu <strong>Premium</strong> — alle functies vrij, onbeperkt leerlingen en instructeurs.
              {trialEndFormatted && (
                <>
                  {' '}
                  Je proefperiode loopt af op <strong>{trialEndFormatted}</strong>. Kies daarvoor een abonnement zodat je geen toegang verliest.
                </>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="checkout-error">
            {error}
          </div>
        )}

        {/* Plan Cards — alleen tonen nadat session-check + plan-fetch klaar zijn */}
        {!planLoading && (
        <>
        <div className="plans-grid">
          {/* Basic Plan */}
          <div className={`plan-card${isCurrentPlan('basic') ? ' plan-card-current' : ''}`}>
            {isCurrentPlan('basic') && <div className="plan-current-badge">Huidig</div>}
            <div className="plan-header">
              <span className="pill">Basic</span>
              <div className="plan-price">
                <span className="plan-amount">&euro;25</span>
                <span className="plan-period">/maand excl. btw</span>
              </div>
              <p style={{ fontSize: 13, color: '#78716C', margin: '4px 0 0' }}>
                Incasso: {formatCentsForDisplay(basicPricing.grossMonthlyCents)} per maand incl. 21% btw
              </p>
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
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  className="btn-secondary"
                  onClick={() => handleCheckout('basic')}
                  disabled={loading !== null || basicBlockedReason !== null}
                  title={basicBlockedReason ?? undefined}
                  style={basicBlockedReason ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                >
                  {loading === 'basic' ? 'Bezig...' : 'Kies Basic'}
                </button>
                {basicBlockedReason && (
                  <p style={{ fontSize: 12, color: '#B45309', margin: 0, lineHeight: 1.4 }}>
                    {basicBlockedReason}
                  </p>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 'auto' }} />
            )}
          </div>

          {/* Premium Plan */}
          <div className={`plan-card plan-card-premium${isCurrentPlan('premium') ? ' plan-card-current-premium' : ''}`}>
            {isCurrentPlan('premium') ? (
              <div className="plan-current-badge plan-current-badge-premium">Huidig</div>
            ) : isTrial ? (
              <div className="plan-popular">Nu actief tijdens proef</div>
            ) : (
              <div className="plan-popular">Meest gekozen</div>
            )}
            <div className="plan-header">
              <span className="pill pill-premium">Premium</span>
              <div className="plan-price">
                <span className="plan-amount">&euro;45</span>
                <span className="plan-period">/maand excl. btw</span>
              </div>
              <p style={{ fontSize: 13, color: '#78716C', margin: '4px 0 0' }}>
                Incasso: {formatCentsForDisplay(premiumPricing.grossMonthlyCents)} per maand incl. 21% btw
              </p>
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
        </>
        )}

        {/* Cancel subscription */}
        {!planLoading && currentPlan && !isTrial && !cancelledAt && !cancelSuccess && (
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
            Alle prijzen zijn exclusief 21% btw; de incasso via Mollie is inclusief btw.
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

      {/* Custom cancel-confirm modal — vervangt window.confirm() voor consistente UI */}
      {showCancelModal && (
        <CancelConfirmModal
          onCancel={() => setShowCancelModal(false)}
          onConfirm={confirmCancel}
        />
      )}
    </main>
  );
}

function CancelConfirmModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 20,
          padding: '28px 28px 24px',
          maxWidth: 440,
          width: '100%',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        }}
      >
        <h2
          id="cancel-modal-title"
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: '#1C1917',
            margin: '0 0 12px',
          }}
        >
          Abonnement opzeggen?
        </h2>
        <p style={{ fontSize: 15, color: '#57534E', lineHeight: 1.55, margin: '0 0 24px' }}>
          Je houdt toegang tot het einde van je huidige betaalperiode. Daarna
          stopt je abonnement en kun je opnieuw kiezen.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: '#F5F5F4',
              color: '#1C1917',
              border: 'none',
              padding: '12px 20px',
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            style={{
              background: '#DC2626',
              color: '#fff',
              border: 'none',
              padding: '12px 20px',
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Ja, opzeggen
          </button>
        </div>
      </div>
    </div>
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
