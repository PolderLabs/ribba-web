import { Metadata } from 'next';
import RibbaLogo from '@/app/components/RibbaLogo';
import PartnerEnroll from '@/components/partner/PartnerEnroll';
import { rewardText, milestoneText } from '@/components/partner/labels';
import type { ReferralProgramPublic } from '@/lib/referral-types';

type Props = {
  params: Promise<{ slug: string }>;
};

// Publieke programma-info via de anon-RPC (geen Stripe-/config-velden).
async function getProgram(slug: string): Promise<ReferralProgramPublic> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return { found: false };

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/referral_program_public`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_slug: slug }),
    next: { revalidate: 60 },
  });
  if (!res.ok) return { found: false };
  return (await res.json()) as ReferralProgramPublic;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const program = await getProgram(slug);
  if (!program.found) {
    return { title: 'Link niet gevonden – Ribba' };
  }
  return {
    title: `Word referral-partner van ${program.school_name} – Ribba`,
    description: `Deel je persoonlijke link en verdien een beloning voor elke leerling die je aanbrengt bij ${program.school_name}.`,
  };
}

export default async function PartnerJoinPage({ params }: Props) {
  const { slug } = await params;
  const program = await getProgram(slug);

  if (!program.found) {
    return (
      <main className="registration-page">
        <section className="registration-card" style={{ textAlign: 'center' }}>
          <div className="registration-brand" style={{ justifyContent: 'center' }}>
            <RibbaLogo height={36} />
          </div>
          <p className="pill pill-red">Niet gevonden</p>
          <h1>Programma niet gevonden</h1>
          <p className="registration-description">
            Deze uitnodigingslink bestaat niet (meer) of het referral-programma is
            gepauzeerd. Controleer de link of neem contact op via{' '}
            <a href="mailto:team@ribba.app" className="text-link">team@ribba.app</a>.
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

        <p className="registration-pill">Referral-programma</p>

        <h1>Verdien een beloning via {program.school_name}</h1>
        <p className="registration-description">
          Ken jij iemand die rijles zoekt? Deel jouw persoonlijke link en verdien
          een beloning voor elke leerling die zich via jou inschrijft bij{' '}
          <strong>{program.school_name}</strong>:
        </p>

        <ul className="registration-description" style={{ paddingLeft: 20 }}>
          {program.rewards.map((r) => (
            <li key={r.milestone}>
              <strong>{rewardText(r)}</strong> zodra je aanmelding de milestone
              &lsquo;{milestoneText(r.milestone)}&rsquo; haalt
            </li>
          ))}
        </ul>

        <PartnerEnroll slug={slug} schoolName={program.school_name} />

        <div className="divider" />

        <p className="footer-text">
          Vragen? Neem contact op met{' '}
          <a href="mailto:team@ribba.app">team@ribba.app</a>
        </p>
      </section>
    </main>
  );
}
