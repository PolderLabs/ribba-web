import { Metadata } from 'next';
import { notFound } from 'next/navigation';

type Props = {
  params: Promise<{ slug: string }>;
};

type School = {
  id: string;
  name: string;
  registration_slug: string;
  registration_link: string;
  registration_enabled: boolean;
};

async function getSchool(slug: string): Promise<School | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return null;

  const res = await fetch(
    `${supabaseUrl}/rest/v1/drivingschools?registration_slug=eq.${encodeURIComponent(slug)}&select=id,name,registration_slug,registration_link,registration_enabled&limit=1`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 60 },
    },
  );

  if (!res.ok) return null;
  const data: School[] = await res.json();
  return data[0] ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const school = await getSchool(slug);

  if (!school) {
    return { title: 'Link niet gevonden – Ribba' };
  }

  return {
    title: `Inschrijven bij ${school.name} – Ribba`,
    description: `Meld je aan als leerling bij ${school.name} via de Ribba app.`,
  };
}

export default async function SchoolPage({ params }: Props) {
  const { slug } = await params;
  const school = await getSchool(slug);

  // Niet gevonden of uitgeschakeld
  if (!school || !school.registration_enabled) {
    return (
      <main className="registration-page">
        <section className="registration-card">
          <p className="registration-pill">Inschrijflink</p>
          <h1>Link niet gevonden</h1>
          <p className="registration-description">
            Deze inschrijflink bestaat niet (meer). Controleer de link of neem contact met
            Ribba op via{' '}
            <a href="mailto:hallo@ribba.app" style={{ color: '#2563EB', fontWeight: 600 }}>
              hallo@ribba.app
            </a>
            .
          </p>
        </section>
      </main>
    );
  }

  const appDeepLink = `ribba://school/${school.registration_slug}`;
  const appStoreUrl = 'https://apps.apple.com/app/ribba/id6744055023';
  const playStoreUrl = 'https://play.google.com/store/apps/details?id=com.ribba.app';

  return (
    <main className="page-wrapper">
      <div className="card">
        {/* Logo */}
        <div className="logo">Ribba</div>

        {/* Pill */}
        <p className="pill">Inschrijflink</p>

        {/* Title */}
        <h1>Inschrijven bij<br />{school.name}</h1>
        <p className="subtitle">
          Download de Ribba app en gebruik deze link om je automatisch aan te melden
          bij <strong>{school.name}</strong>.
        </p>

        {/* Open in app */}
        <a href={appDeepLink} className="btn-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
          Inschrijven via de app
        </a>

        <div className="divider" />

        <p style={{ fontSize: 13, color: '#78716C', marginBottom: 8 }}>
          App nog niet? Download hem hier:
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
      </div>
    </main>
  );
}
