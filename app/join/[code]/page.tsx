import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import RibbaLogo from '../../components/RibbaLogo';
import { StoreBadges } from '../../components/StoreBadges';

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;

  // Probeer de naam van de rijschool op te halen voor een persoonlijke preview
  let schoolName: string | null = null;

  // 1. Match op registration_slug
  const schools = await supabaseGet<{ name: string }[]>(
    `drivingschools?registration_slug=eq.${encodeURIComponent(code)}&select=name&limit=1`,
  );
  if (schools && schools.length > 0) {
    schoolName = schools[0].name;
  } else {
    // 2. Match op invitation_links.code
    const invites = await supabaseGet<{ drivingschools: { name: string } | null }[]>(
      `invitation_links?code=eq.${encodeURIComponent(code.toUpperCase())}&select=drivingschools(name)&limit=1`,
    );
    if (invites && invites[0]?.drivingschools?.name) {
      schoolName = invites[0].drivingschools.name;
    }
  }

  const title = schoolName
    ? `Je bent uitgenodigd door ${schoolName}`
    : 'Je bent uitgenodigd voor Ribba';
  const description = schoolName
    ? `Schrijf je in als leerling bij ${schoolName} via de Ribba app — plan lessen, volg je voortgang en bekijk je facturen.`
    : 'Plan rijlessen, volg je voortgang en bekijk je facturen — allemaal via de Ribba app.';

  const ogImage = 'https://link.ribba.app/og-image.png';

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://link.ribba.app/join/${code}`,
      siteName: 'Ribba',
      type: 'website',
      images: [
        {
          url: ogImage,
          width: 512,
          height: 512,
          alt: 'Ribba',
        },
      ],
      locale: 'nl_NL',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
    icons: {
      icon: ogImage,
    },
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

        <StoreBadges />
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
