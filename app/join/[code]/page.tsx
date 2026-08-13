import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import RibbaLogo from '../../components/RibbaLogo';
import { StoreBadges } from '../../components/StoreBadges';
import {
  bepaalJoinUitkomst,
  type InviteWeergave,
  type ResolveTreffer,
  type SchoolTreffer,
} from '../../../lib/join-resolver';

type Props = {
  params: Promise<{ code: string }>;
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

/**
 * Vraagt de database welke uitnodiging bij deze invoer hoort.
 *
 * Bewust met de anon-sleutel: `resolve_invite` is als publieke lookup gebouwd
 * (SECURITY DEFINER, `anon` heeft EXECUTE, retourneert alleen de canonieke
 * code plus één boolean). Hij kwam er toen migratie 20260802230000
 * `invitation_links` bij `anon` weghaalde, omdat de tabel opsombaar was
 * inclusief e-mailadressen. Die smalle poort gebruiken we hier dus zoals
 * bedoeld — de service-role-sleutel hoort niet bij een beslissing die ook
 * anoniem genomen mag worden.
 *
 * Accepteert zowel een uitnodigingscode (in welke schrijfwijze dan ook) als de
 * registratie-slug van een school, en geeft de code terug zoals die in de
 * database staat.
 */
async function resolveInvite(input: string): Promise<ResolveTreffer | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/resolve_invite`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_input: input.trim() }),
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;
  const rows = (await res.json()) as { code?: string }[] | null;
  const code = Array.isArray(rows) ? rows[0]?.code : undefined;
  return code ? { code } : null;
}

/**
 * Haalt op wat de pagina moet tónen. Nooit om te beslissen — dat deed
 * `resolve_invite` al — en daarom op de exacte, canonieke code. Geen
 * `toUpperCase()`, geen aanname over schrijfwijze: de code komt hier
 * rechtstreeks uit de database vandaan.
 */
async function fetchInviteWeergave(canoniekeCode: string): Promise<InviteWeergave | null> {
  const rows = await supabaseGet<InviteWeergave[]>(
    `invitation_links?code=eq.${encodeURIComponent(canoniekeCode)}&select=is_multi_use,drivingschools(registration_slug,name)&limit=1`,
  );
  return rows?.[0] ?? null;
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
    // 2. Via resolve_invite naar de canonieke code, en pas dán de naam ophalen.
    //    Dezelfde route als de pagina zelf loopt, zodat de preview nooit iets
    //    anders beweert dan wat de bezoeker vervolgens te zien krijgt.
    const resolved = await resolveInvite(code);
    const invite = resolved ? await fetchInviteWeergave(resolved.code) : null;
    if (invite?.drivingschools?.name) {
      schoolName = invite.drivingschools.name;
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

  // De drie reads. Geldigheid wordt niet hier bepaald maar door
  // resolve_invite; de rest is opmaak. Zie lib/join-resolver.ts.
  const schools = await supabaseGet<SchoolTreffer[]>(
    `drivingschools?registration_slug=eq.${encodeURIComponent(code)}&select=registration_slug,registration_enabled&limit=1`,
  );
  const school = schools?.[0] ?? null;

  let resolved: ResolveTreffer | null = null;
  let invite: InviteWeergave | null = null;
  if (!school) {
    resolved = await resolveInvite(code);
    invite = resolved ? await fetchInviteWeergave(resolved.code) : null;
  }

  const uitkomst = bepaalJoinUitkomst({ school, resolved, invite });

  if (uitkomst.soort === 'verlopen') {
    return <ExpiredPage />;
  }

  if (uitkomst.soort === 'redirect') {
    redirect(`/${uitkomst.slug}`);
  }

  // Personal invite → show "Open in app" page (without showing the code)
  const schoolName = uitkomst.schoolNaam;
  const appDeepLink = `ribba://join/${uitkomst.code}`;

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
          <a href="mailto:team@ribba.app">team@ribba.app</a>
        </p>
      </div>
    </main>
  );
}
