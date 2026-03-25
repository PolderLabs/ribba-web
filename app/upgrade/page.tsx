import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Upgrade naar Premium – Ribba',
  description: 'Upgrade je rijschool naar Ribba Premium voor uitgebreide functionaliteit.',
};

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

export default function UpgradePage() {
  return (
    <main className="upgrade-page">
      <div className="upgrade-container">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div className="logo">Ribba</div>
          <h1 style={{ fontSize: 36, marginBottom: 8 }}>Kies je plan</h1>
          <p className="subtitle">
            Probeer Ribba 30 dagen gratis. Geen betaalgegevens nodig.
          </p>
        </div>

        {/* Trial Banner */}
        <div className="trial-banner">
          <div className="trial-icon">🎉</div>
          <div>
            <p className="trial-title">30 dagen gratis uitproberen</p>
            <p className="trial-desc">
              Start met een gratis proefperiode van 30 dagen met alle Premium-functies.
              Geen creditcard nodig. Na 30 dagen kies je het plan dat bij je past.
            </p>
          </div>
        </div>

        {/* Plan Cards */}
        <div className="plans-grid">
          {/* Basic Plan */}
          <div className="plan-card">
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
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fill="#16A34A"/>
                  </svg>
                  <span>{feat}</span>
                </div>
              ))}
            </div>

            <a href="mailto:hallo@ribba.app?subject=Ribba Basic aanvragen" className="btn-secondary" style={{ marginTop: 'auto' }}>
              Kies Basic
            </a>
          </div>

          {/* Premium Plan */}
          <div className="plan-card plan-card-premium">
            <div className="plan-popular">Meest gekozen</div>
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
              {/* Basic features included */}
              <div className="plan-feature-row plan-feature-included">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fill="#2563EB"/>
                </svg>
                <span>Alles uit Basic</span>
              </div>
              <div className="plan-feature-row plan-feature-included">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fill="#2563EB"/>
                </svg>
                <span>Onbeperkt leerlingen</span>
              </div>

              <div className="plan-features-divider" />

              {/* Premium-only features */}
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

            <a href="mailto:hallo@ribba.app?subject=Ribba Premium aanvragen" className="btn-primary" style={{ marginTop: 'auto' }}>
              Start gratis proefperiode
            </a>
            <p className="plan-trial-note">30 dagen gratis, daarna &euro;59/maand</p>
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
