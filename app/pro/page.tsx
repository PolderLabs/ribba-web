import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import RibbaLogo from '../components/RibbaLogo';
import { APP_STORE_URL } from '@/lib/app-links';

export const metadata: Metadata = {
  title: 'Ribba – Rijschool Planner',
  description:
    'Nooit meer planningsstress. Beheer leerlingen, lessen, facturatie en CBR — alles in één app voor iOS en Android.',
};

const BASIC_FEATURES = [
  'Tot 30 actieve leerlingen',
  '1 instructeur',
  'Alle koppelingen (CBR, Moneybird, Mollie)',
  'Facturatie & lespakketten',
  'Leerling-app',
  'Help Center & WhatsApp support',
];

const PREMIUM_FEATURES = [
  'Onbeperkte leerlingen',
  'Tot 5 instructeurs',
  'Alle koppelingen (CBR, Moneybird, Mollie)',
  'Facturatie & lespakketten',
  'Leerling-app',
  'Prioriteit support',
];

function CheckIcon({ color = '#16A34A' }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
      <path
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        fill={color}
      />
    </svg>
  );
}

export default function ProPage() {
  return (
    <div style={{ background: '#FAFAF9', minHeight: '100vh' }}>

      {/* ── Nav ──────────────────────────────────────────────── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid #F5F5F4',
        padding: '0 1.5rem',
      }}>
        <div style={{
          maxWidth: 1100, margin: '0 auto',
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', height: 60,
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <RibbaLogo height={32} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link href="/upgrade" style={{
              fontSize: 14, fontWeight: 600, color: '#57534E',
              textDecoration: 'none', padding: '8px 16px',
            }}>
              Al klant?
            </Link>
            <Link href="/registreren" style={{
              fontSize: 14, fontWeight: 700, color: '#fff',
              textDecoration: 'none', background: '#2563EB',
              padding: '9px 20px', borderRadius: 10,
            }}>
              Gratis proberen
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section style={{
        background: 'linear-gradient(150deg, #1E40AF 0%, #2563EB 45%, #6D28D9 100%)',
        padding: '6rem 1.5rem 0',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Decorative blobs */}
        <div style={{
          position: 'absolute', top: -80, right: '10%',
          width: 400, height: 400,
          background: 'radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)',
          borderRadius: '50%', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: 0, left: '5%',
          width: 300, height: 300,
          background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)',
          borderRadius: '50%', pointerEvents: 'none',
        }} />

        <div style={{
          maxWidth: 1100, margin: '0 auto',
          display: 'flex', alignItems: 'flex-end',
          gap: 60, position: 'relative',
        }}>
          {/* Text */}
          <div style={{ flex: 1, paddingBottom: '5rem', minWidth: 280 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 100, padding: '5px 14px', marginBottom: 28,
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: 0.5 }}>
                RIJSCHOOL SOFTWARE VOOR iOS &amp; ANDROID
              </span>
            </div>
            <h1 style={{
              fontSize: 'clamp(30px, 4.5vw, 52px)',
              fontWeight: 900, color: '#fff',
              lineHeight: 1.1, letterSpacing: '-1px',
              marginBottom: 20,
            }}>
              Nooit meer<br />planningsstress
            </h1>
            <p style={{
              fontSize: 18, color: 'rgba(255,255,255,0.82)',
              lineHeight: 1.65, marginBottom: 36, maxWidth: 440,
            }}>
              Ribba – Rijschool Planner geeft je dag- en weekoverzicht, leerlingbeheer, automatische facturatie en CBR-koppeling — allemaal in één app.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link href="/registreren" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: '#fff', color: '#2563EB',
                fontSize: 16, fontWeight: 700,
                padding: '15px 30px', borderRadius: 14,
                textDecoration: 'none',
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              }}>
                Eerste maand gratis
              </Link>
              <a href={APP_STORE_URL}
                target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: 'rgba(255,255,255,0.12)',
                  border: '1.5px solid rgba(255,255,255,0.3)',
                  color: '#fff', fontSize: 14, fontWeight: 600,
                  padding: '15px 24px', borderRadius: 14,
                  textDecoration: 'none',
                }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
                Download voor iOS
              </a>
            </div>
          </div>

          {/* Screenshots */}
          <div style={{
            display: 'flex', gap: 20, alignItems: 'flex-end', flexShrink: 0,
            marginBottom: -2,
          }}>
            <Image
              src="/screenshots/store-02-home.jpeg"
              alt="Ribba – overzicht rijschool"
              width={230} height={498}
              style={{ borderRadius: 24, filter: 'drop-shadow(0 32px 64px rgba(0,0,0,0.35))', display: 'block' }}
              priority
            />
            <Image
              src="/screenshots/store-01-agenda-week.jpeg"
              alt="Ribba – weekagenda"
              width={230} height={498}
              style={{ borderRadius: 24, filter: 'drop-shadow(0 32px 64px rgba(0,0,0,0.35))', marginBottom: 40, display: 'block' }}
              priority
            />
          </div>
        </div>
      </section>

      {/* ── Trust bar ────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #F5F5F4', padding: '1.25rem 1.5rem' }}>
        <div style={{
          maxWidth: 1100, margin: '0 auto',
          display: 'flex', gap: 40, flexWrap: 'wrap',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {[
            { num: 'Eerste maand', label: 'gratis' },
            { num: 'iCloud & Google', label: 'agenda-synchronisatie' },
            { num: 'CBR TOP', label: 'officiële koppeling' },
            { num: 'Mollie iDEAL', label: 'leerlingbetalingen' },
          ].map((item) => (
            <div key={item.label} style={{ textAlign: 'center', padding: '0 8px' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#2563EB' }}>{item.num}</div>
              <div style={{ fontSize: 12, color: '#78716C', marginTop: 2 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '0 1.5rem' }}>

        {/* ── Features: screenshot showcase ───────────────────── */}
        <section style={{ padding: '5rem 0' }}>
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <span className="pill pill-green">Alles in één app</span>
            <h2 style={{ fontSize: 34, fontWeight: 900, color: '#1C1917', marginTop: 14, letterSpacing: '-0.5px' }}>
              Gemaakt voor rijinstructeurs
            </h2>
          </div>

          {/* Row 1: Agenda */}
          <div style={{
            display: 'flex', gap: 60, alignItems: 'center',
            marginBottom: '5rem', flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
              <Image
                src="/screenshots/store-01-agenda-week.jpeg"
                alt="Nooit meer planningsstress"
                width={220} height={476}
                style={{ borderRadius: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.12)', display: 'block' }}
              />
              <Image
                src="/screenshots/store-03-agenda-dag.jpeg"
                alt="Je dag in één overzicht"
                width={220} height={476}
                style={{ borderRadius: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.12)', marginTop: 48, display: 'block' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <span className="pill pill-green">Agenda</span>
              <h3 style={{ fontSize: 28, fontWeight: 800, color: '#1C1917', marginTop: 14, lineHeight: 1.25 }}>
                Nooit meer planningsstress
              </h3>
              <p style={{ color: '#57534E', lineHeight: 1.7, fontSize: 16, marginTop: 12, marginBottom: 24 }}>
                Zie direct je dag- en weekplanning. Plan een nieuwe les in een paar tikken. Ribba synchroniseert ook met je persoonlijke agenda, zodat je nooit meer dubbel boekt.
              </p>
              {[
                'Week- en dagweergave in één oogopslag',
                'Agenda-synchronisatie met iCloud & Google',
                'Automatisch blokkeren bij privé-afspraken',
                'iCal-abonnement voor partner of gezin',
              ].map((f) => (
                <div key={f} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                  <CheckIcon color="#16A34A" />
                  <span style={{ fontSize: 15, color: '#1C1917', lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: '#F5F5F4', marginBottom: '5rem' }} />

          {/* Row 2: Leerlingen */}
          <div style={{
            display: 'flex', gap: 60, alignItems: 'center',
            marginBottom: '5rem', flexWrap: 'wrap-reverse',
          }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <span className="pill">Leerlingen</span>
              <h3 style={{ fontSize: 28, fontWeight: 800, color: '#1C1917', marginTop: 14, lineHeight: 1.25 }}>
                Vind leerlingen en handel direct
              </h3>
              <p style={{ color: '#57534E', lineHeight: 1.7, fontSize: 16, marginTop: 12, marginBottom: 24 }}>
                Bel, WhatsApp of mail direct vanuit de app. Bekijk voortgang, lespakket en betalingen per leerling. Plan een nieuwe les zonder de app te verlaten.
              </p>
              {[
                'Direct bellen, WhatsApp of mailen',
                'Voortgang en rijkaart per leerling',
                'Lespakket & facturering in één scherm',
                'Wachtlijstbeheer',
              ].map((f) => (
                <div key={f} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                  <CheckIcon color="#2563EB" />
                  <span style={{ fontSize: 15, color: '#1C1917', lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
              <Image
                src="/screenshots/store-04-leerlingen.jpeg"
                alt="Vind leerlingen en handel direct"
                width={220} height={476}
                style={{ borderRadius: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.12)', display: 'block' }}
              />
              <Image
                src="/screenshots/store-05-leerling-detail.jpeg"
                alt="Plan en contact in één actie"
                width={220} height={476}
                style={{ borderRadius: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.12)', marginTop: 48, display: 'block' }}
              />
            </div>
          </div>

          <div style={{ height: 1, background: '#F5F5F4', marginBottom: '5rem' }} />

          {/* Row 3: Facturatie */}
          <div style={{
            display: 'flex', gap: 60, alignItems: 'center',
            flexWrap: 'wrap',
          }}>
            <div style={{ flexShrink: 0 }}>
              <Image
                src="/screenshots/store-06-facturen.jpeg"
                alt="Factureer zonder gedoe"
                width={220} height={476}
                style={{ borderRadius: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.12)', display: 'block' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <span className="pill pill-amber">Facturatie</span>
              <h3 style={{ fontSize: 28, fontWeight: 800, color: '#1C1917', marginTop: 14, lineHeight: 1.25 }}>
                Factureer zonder gedoe
              </h3>
              <p style={{ color: '#57534E', lineHeight: 1.7, fontSize: 16, marginTop: 12, marginBottom: 24 }}>
                Termijnfacturen worden automatisch aangemaakt op basis van lespakketten. Koppel Moneybird voor je boekhouding en laat leerlingen direct betalen via iDEAL.
              </p>
              {[
                'Automatische termijnfacturen',
                'Moneybird boekhoudkoppeling',
                'iDEAL-betalingen via Mollie',
                'Openstaand en betaald in één overzicht',
              ].map((f) => (
                <div key={f} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                  <CheckIcon color="#D97706" />
                  <span style={{ fontSize: 15, color: '#1C1917', lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pricing ──────────────────────────────────────────── */}
        <section style={{ padding: '2rem 0 5rem' }}>
          <div style={{
            background: 'linear-gradient(135deg, #EFF6FF 0%, #F0FDF4 100%)',
            borderRadius: 24, padding: '3rem 2rem', marginBottom: '3rem',
          }}>
            <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
              <span className="pill">Abonnementen</span>
              <h2 style={{ fontSize: 34, fontWeight: 900, color: '#1C1917', marginTop: 14, letterSpacing: '-0.5px' }}>
                Eerlijk en transparant
              </h2>
              <p style={{ color: '#57534E', marginTop: 10, fontSize: 16 }}>
                Eerste maand gratis — geen creditcard vereist.
              </p>
            </div>

            <div className="plans-grid" style={{ maxWidth: 780, margin: '0 auto' }}>
              {/* Basic */}
              <div className="plan-card">
                <div className="plan-header">
                  <span className="pill" style={{ marginBottom: 16 }}>Basic</span>
                  <div className="plan-price">
                    <span style={{ fontSize: 14, color: '#78716C', marginRight: 1, alignSelf: 'flex-start', paddingTop: 10 }}>€</span>
                    <span className="plan-amount">25</span>
                    <span className="plan-period">/mnd</span>
                  </div>
                  <p className="plan-desc">Voor zelfstandige instructeurs</p>
                </div>
                <div className="plan-features">
                  {BASIC_FEATURES.map((f) => (
                    <div key={f} className="plan-feature-row">
                      <CheckIcon color="#16A34A" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <Link href="/registreren" className="btn-trial" style={{ textDecoration: 'none', display: 'flex' }}>
                  Probeer gratis
                </Link>
                <p className="plan-trial-note">Eerste maand gratis · daarna €25/mnd · annuleer altijd</p>
              </div>

              {/* Premium */}
              <div className="plan-card plan-card-premium">
                <div className="plan-popular">⭐ Meest gekozen</div>
                <div className="plan-header">
                  <span className="pill pill-premium" style={{ marginBottom: 16 }}>Premium</span>
                  <div className="plan-price">
                    <span style={{ fontSize: 14, color: '#78716C', marginRight: 1, alignSelf: 'flex-start', paddingTop: 10 }}>€</span>
                    <span className="plan-amount">45</span>
                    <span className="plan-period">/mnd</span>
                  </div>
                  <p className="plan-desc">Voor groeiende rijscholen</p>
                </div>
                <div className="plan-features">
                  {PREMIUM_FEATURES.map((f) => (
                    <div key={f} className="plan-feature-row">
                      <CheckIcon color="#2563EB" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <Link href="/registreren" className="btn-primary" style={{ textDecoration: 'none', display: 'flex' }}>
                  Probeer gratis
                </Link>
                <p className="plan-trial-note">Eerste maand gratis · daarna €45/mnd · annuleer altijd</p>
              </div>
            </div>

            {/* Manage existing */}
            <div style={{
              maxWidth: 780, margin: '20px auto 0',
              background: '#fff', borderRadius: 16,
              padding: '18px 24px', border: '1px solid #E7E5E4',
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontWeight: 700, color: '#1C1917', fontSize: 15 }}>Al klant?</div>
                <div style={{ color: '#57534E', fontSize: 13.5, marginTop: 2 }}>
                  Bekijk of wijzig je lopende abonnement.
                </div>
              </div>
              <Link href="/upgrade" className="btn-secondary" style={{
                textDecoration: 'none', width: 'auto', marginTop: 0,
              }}>
                Beheer abonnement →
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section style={{
        background: 'linear-gradient(150deg, #1E40AF 0%, #2563EB 50%, #6D28D9 100%)',
        padding: '5rem 1.5rem', textAlign: 'center',
      }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <h2 style={{ fontSize: 36, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px', marginBottom: 14 }}>
            Klaar om te starten?
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 17, lineHeight: 1.6, marginBottom: 32 }}>
            Download Ribba – Rijschool Planner. Eerste maand gratis, geen creditcard, geen verplichtingen.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/registreren" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#fff', color: '#2563EB',
              fontSize: 16, fontWeight: 700,
              padding: '15px 32px', borderRadius: 14,
              textDecoration: 'none',
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            }}>
              Gratis registreren
            </Link>
            <a href={APP_STORE_URL}
              target="_blank" rel="noopener noreferrer"
              className="store-badge"
              style={{ borderRadius: 14, marginTop: 0, fontSize: 15 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              App Store
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid #F5F5F4', padding: '2rem 1.5rem',
        textAlign: 'center', background: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          <RibbaLogo height={28} />
        </div>
        <p className="footer-text">
          Vragen?{' '}
          <a href="mailto:hallo@ribba.app" style={{ color: '#2563EB', fontWeight: 600, textDecoration: 'none' }}>
            hallo@ribba.app
          </a>
        </p>
        <p className="footer-text" style={{ marginTop: 8 }}>
          <Link href="/voorwaarden" style={{ color: '#A8A29E', textDecoration: 'none' }}>Algemene voorwaarden</Link>
          {' · '}
          <Link href="/privacy" style={{ color: '#A8A29E', textDecoration: 'none' }}>Privacybeleid</Link>
        </p>
      </footer>
    </div>
  );
}
