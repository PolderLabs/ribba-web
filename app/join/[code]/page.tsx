import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import RibbaLogo from '../../components/RibbaLogo';

type Props = {
  params: Promise<{ code: string }>;
};

type InviteLink = {
  id: string;
  code: string;
  drivingschool_id: string;
  instructor_id: string | null;
  is_multi_use: boolean;
  used: boolean;
  expires_at: string | null;
  drivingschools: { registration_slug: string; name: string } | null;
};

async function supabaseGet<T>(path: string): Promise<T | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Uitnodiging – Ribba',
    description: 'Je bent uitgenodigd voor de Ribba app.',
  };
}

export default async function JoinPage({ params }: Props) {
  const { code } = await params;

  // 1. Check if it's a registration_slug for a driving school
  const schools = await supabaseGet<{ registration_slug: string; registration_enabled: boolean }[]>(
    `drivingschools?registration_slug=eq.${encodeURIComponent(code)}&select=registration_slug,registration_enabled&limit=1`,
  );

  if (schools && schools.length > 0 && schools[0].registration_enabled) {
    redirect(`/${schools[0].registration_slug}`);
  }

  // 2. Check if it's an invitation_links.code
  const invites = await supabaseGet<InviteLink[]>(
    `invitation_links?code=eq.${encodeURIComponent(code.toUpperCase())}&select=id,code,drivingschool_id,instructor_id,is_multi_use,used,expires_at,drivingschools(registration_slug,name)&limit=1`,
  );

  const invite = invites?.[0] ?? null;

  // No matching invite found
  if (!invite) {
    return <ExpiredPage />;
  }

  // Check if expired
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return <ExpiredPage />;
  }

  // Check if single-use and already used
  if (!invite.is_multi_use && invite.used) {
    return <ExpiredPage />;
  }

  // Multi-use school invite → redirect to registration form
  if (invite.is_multi_use && invite.drivingschools?.registration_slug) {
    redirect(`/${invite.drivingschools.registration_slug}`);
  }

  // Personal invite → show "Open in app" page (without showing the code)
  const schoolName = invite.drivingschools?.name ?? 'je rijschool';
  const appDeepLink = `ribba://join/${invite.code}`;
  const appStoreUrl = 'https://apps.apple.com/app/ribba/id6744055023';
  const playStoreUrl = 'https://play.google.com/store/apps/details?id=com.ribba.app';

  return (
    <main className="page-wrapper">
      <div className="card">
        <div className="logo">
          <RibbaLogo height={36} />
        </div>

        <p className="pill pill-green">Uitnodiging</p>

        <h1>Je bent uitgenodigd!</h1>
        <p className="subtitle">
          <strong>{schoolName}</strong> heeft je uitgenodigd voor de Ribba app.
          Open de link hieronder om je aan te melden.
        </p>

        <a href={appDeepLink} className="btn-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          Open in de Ribba app
        </a>

        <div className="divider" />

        <p className="footer-text" style={{ marginBottom: 8 }}>
          App nog niet? Download hem hier:
        </p>

        <div className="store-badges">
          <a href={appStoreUrl} className="store-badge" target="_blank" rel="noopener noreferrer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
            App Store
          </a>
          <a href={playStoreUrl} className="store-badge" target="_blank" rel="noopener noreferrer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 20.5v-17c0-.83.94-1.3 1.6-.8l14 8.5c.6.36.6 1.24 0 1.6l-14 8.5c-.66.5-1.6.03-1.6-.8z" />
            </svg>
            Google Play
          </a>
        </div>
      </div>
    </main>
  );
}

function ExpiredPage() {
  return (
    <main className="page-wrapper">
      <div className="card">
        <div className="logo">
          <RibbaLogo height={36} />
        </div>

        <p className="pill pill-amber">Verlopen</p>

        <h1>Link verlopen</h1>
        <p className="subtitle">
          Deze uitnodigingslink is verlopen of niet meer geldig.
          Neem contact op met je rijschool voor een nieuwe uitnodiging.
        </p>

        <div className="divider" />

        <p className="footer-text">
          Vragen? Neem contact op met{' '}
          <a href="mailto:hallo@ribba.app">hallo@ribba.app</a>
        </p>
      </div>
    </main>
  );
}
