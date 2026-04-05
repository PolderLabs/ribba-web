import type { Metadata } from 'next';
import Link from 'next/link';
import RibbaLogo from '../components/RibbaLogo';

export const metadata: Metadata = {
  title: 'Ribba Rijschool Planner',
  description:
    'Ribba Rijschool Planner — slimme software voor rijscholen. Plan lessen, beheer leerlingen, factureer automatisch.',
};

const FEATURES = [
  {
    title: 'Slimme planning',
    desc: 'Overzichtelijke agenda met iCloud- en Google-synchronisatie.',
  },
  {
    title: 'Leerlingbeheer',
    desc: 'Volg voortgang, pakketten en lesgeschiedenis per leerling.',
  },
  {
    title: 'Automatische facturatie',
    desc: 'iDEAL-betalingen, Moneybird-koppeling en heldere facturen.',
  },
  {
    title: 'CBR-koppeling',
    desc: 'Examens direct vanuit de app inplannen en beheren.',
  },
];

export default function RijschoolPlannerPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #F8FAFC 0%, #EFF6FF 100%)',
      }}
    >
      {/* Nav */}
      <nav
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '24px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link href="/rijschool-planner" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <RibbaLogo height={32} />
        </Link>
        <Link
          href="/login"
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#1E40AF',
            textDecoration: 'none',
            padding: '10px 18px',
            borderRadius: 10,
            background: '#fff',
            border: '1px solid #DBEAFE',
          }}
        >
          Al klant? Inloggen
        </Link>
      </nav>

      {/* Hero */}
      <section
        style={{
          maxWidth: 900,
          margin: '0 auto',
          padding: '60px 24px 40px',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            display: 'inline-block',
            fontSize: 13,
            fontWeight: 700,
            color: '#2563EB',
            background: '#DBEAFE',
            padding: '6px 14px',
            borderRadius: 999,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            marginBottom: 24,
          }}
        >
          Rijschool software
        </p>
        <h1
          style={{
            fontSize: 48,
            fontWeight: 900,
            color: '#0F172A',
            lineHeight: 1.1,
            letterSpacing: '-1px',
            marginBottom: 20,
          }}
        >
          Ribba Rijschool Planner
        </h1>
        <p
          style={{
            fontSize: 18,
            color: '#475569',
            lineHeight: 1.6,
            maxWidth: 640,
            margin: '0 auto 32px',
          }}
        >
          Slimme software voor rijscholen. Plan lessen, beheer leerlingen en factureer
          automatisch — allemaal vanuit één app.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link
            href="/registreren"
            style={{
              background: '#2563EB',
              color: '#fff',
              fontSize: 16,
              fontWeight: 700,
              padding: '14px 28px',
              borderRadius: 12,
              textDecoration: 'none',
              boxShadow: '0 8px 24px rgba(37,99,235,0.25)',
            }}
          >
            Eerste maand gratis
          </Link>
          <Link
            href="/login"
            style={{
              background: '#fff',
              color: '#1E40AF',
              fontSize: 16,
              fontWeight: 600,
              padding: '14px 28px',
              borderRadius: 12,
              textDecoration: 'none',
              border: '1px solid #DBEAFE',
            }}
          >
            Inloggen
          </Link>
        </div>
      </section>

      {/* Features */}
      <section
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: '40px 24px 80px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 20,
        }}
      >
        {FEATURES.map((f) => (
          <div
            key={f.title}
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: 24,
              border: '1px solid #E2E8F0',
            }}
          >
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
              {f.title}
            </h3>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5 }}>{f.desc}</p>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: '24px 24px 48px',
          textAlign: 'center',
          fontSize: 13,
          color: '#64748B',
        }}
      >
        <p style={{ marginBottom: 8 }}>
          Vragen?{' '}
          <a href="mailto:hallo@ribba.app" style={{ color: '#2563EB', fontWeight: 600 }}>
            hallo@ribba.app
          </a>
        </p>
        <p>
          <Link href="/voorwaarden" style={{ color: '#64748B', marginRight: 12 }}>
            Voorwaarden
          </Link>
          <Link href="/privacy" style={{ color: '#64748B' }}>
            Privacy
          </Link>
        </p>
      </footer>
    </main>
  );
}
