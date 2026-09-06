import { Metadata } from 'next';
import SchoolRegistrationForm from '@/components/SchoolRegistrationForm';
import RibbaLogo from '../components/RibbaLogo';
import { registratieIntro } from '@/lib/signup-funnel';

export const metadata: Metadata = {
  title: 'Start met Ribba – Maak een account aan',
  description: 'Maak een account aan voor je rijschool en begin direct met Ribba.',
};

export default function RegistrerenPage() {
  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-brand">
          <RibbaLogo height={36} />
        </div>

        <h1>Start met Ribba</h1>
        <p className="registration-description">{registratieIntro}</p>

        <SchoolRegistrationForm />

        <div className="divider" />

        <p className="footer-text">
          Vragen? Neem contact op met{' '}
          <a href="mailto:team@ribba.nl">team@ribba.nl</a>
        </p>
      </section>
    </main>
  );
}
