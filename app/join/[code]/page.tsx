import { Metadata } from 'next';

type Props = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return {
    title: 'Je bent uitgenodigd – Ribba',
    description: 'Download de Ribba app en gebruik je uitnodigingscode om je aan te melden.',
    openGraph: {
      title: 'Je bent uitgenodigd voor Ribba',
      description: 'Download de Ribba app en meld je aan bij jouw rijschool.',
    },
  };
}

export default async function JoinPage({ params }: Props) {
  const { code } = await params;
  const upperCode = code.toUpperCase();

  // Deep link naar de app (universal link / custom scheme)
  const appDeepLink = `ribba://join/${upperCode}`;
  const appStoreUrl = 'https://apps.apple.com/app/ribba/id6744055023';
  const playStoreUrl = 'https://play.google.com/store/apps/details?id=com.ribba.app';

  return (
    <main className="page-wrapper">
      <div className="card">
        {/* Logo */}
        <div className="logo">Ribba</div>

        {/* Pill */}
        <p className="pill pill-green">Uitnodiging</p>

        {/* Title */}
        <h1>Je bent uitgenodigd!</h1>
        <p className="subtitle">
          Je rijschool heeft je uitgenodigd voor de Ribba app. Download de app en gebruik
          onderstaande code om je aan te melden.
        </p>

        {/* Code */}
        <div className="code-box">{upperCode}</div>

        {/* Open in app button (werkt als app al geïnstalleerd is) */}
        <a href={appDeepLink} className="btn-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
          Open in de Ribba app
        </a>

        <div className="divider" />

        {/* App nog niet? Download eerst */}
        <p style={{ fontSize: 13, color: '#78716C', marginBottom: 8 }}>
          App nog niet geïnstalleerd? Download hem hier:
        </p>

        <div className="store-badges">
          <a href={appStoreUrl} className="store-badge" target="_blank" rel="noopener noreferrer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
            App Store
          </a>
          <a href={playStoreUrl} className="store-badge" target="_blank" rel="noopener noreferrer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 20.5v-17c0-.83.94-1.3 1.6-.8l14 8.5c.6.36.6 1.24 0 1.6l-14 8.5c-.66.5-1.6.03-1.6-.8z"/>
            </svg>
            Google Play
          </a>
        </div>

        <div className="divider" />

        {/* Hoe werkt het */}
        <div style={{ textAlign: 'left', fontSize: 13, color: '#78716C', lineHeight: 1.8 }}>
          <p style={{ fontWeight: 700, color: '#1C1917', marginBottom: 6 }}>Hoe werkt het?</p>
          <p>1. Download de Ribba app via App Store of Google Play</p>
          <p>2. Open de app en kies &ldquo;Aanmelden met uitnodiging&rdquo;</p>
          <p>3. Voer de code <strong style={{ color: '#2563EB' }}>{upperCode}</strong> in</p>
          <p>4. Maak je account aan en je bent klaar! 🎉</p>
        </div>
      </div>
    </main>
  );
}
