import { Metadata } from 'next';
import RegistrationForm from '@/components/RegistrationForm';
import ReferralCapture from '@/components/ReferralCapture';
import RibbaLogo from '../components/RibbaLogo';

type Props = {
  params: Promise<{ slug: string }>;
};

type School = {
  id: string;
  name: string;
  email: string;
  phone: string;
  registration_slug: string;
  registration_enabled: boolean;
};

async function getSchool(slug: string): Promise<School | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return null;

  const res = await fetch(
    `${supabaseUrl}/rest/v1/drivingschools?registration_slug=eq.${encodeURIComponent(slug)}&select=id,name,email,phone,registration_slug,registration_enabled&limit=1`,
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
    description: `Meld je aan als leerling bij ${school.name} via Ribba.`,
  };
}

export default async function SchoolPage({ params }: Props) {
  const { slug } = await params;
  const school = await getSchool(slug);

  if (!school || !school.registration_enabled) {
    return (
      <main className="registration-page">
        <section className="registration-card" style={{ textAlign: 'center' }}>
          <div className="registration-brand" style={{ justifyContent: 'center' }}>
            <RibbaLogo height={36} />
          </div>
          <p className="pill pill-red">Niet gevonden</p>
          <h1>Link niet gevonden</h1>
          <p className="registration-description">
            Deze inschrijflink bestaat niet (meer) of registratie is uitgeschakeld.
            Controleer de link of neem contact op via{' '}
            <a href="mailto:team@ribba.nl" className="text-link">
              team@ribba.nl
            </a>
            .
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-brand">
          <RibbaLogo height={36} />
        </div>

        <p className="registration-pill">Inschrijving</p>

        <h1>Inschrijven bij {school.name}</h1>
        <p className="registration-description">
          Vul het formulier hieronder in om je aan te melden als leerling bij{' '}
          <strong>{school.name}</strong>. Je ontvangt een bevestiging per e-mail.
        </p>

        <ReferralCapture />
        <RegistrationForm schoolId={school.id} schoolName={school.name} />

        <div className="divider" />

        <p className="footer-text">
          Vragen? Neem contact op met{' '}
          <a href="mailto:team@ribba.nl">team@ribba.nl</a>
        </p>
      </section>
    </main>
  );
}
