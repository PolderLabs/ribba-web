import { Metadata } from 'next';
import SchoolRegistrationForm from '@/components/SchoolRegistrationForm';

export const metadata: Metadata = {
  title: 'Start met Ribba – Maak een account aan',
  description: 'Maak een account aan voor je rijschool en begin direct met Ribba.',
};

export default function RegistrerenPage() {
  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-brand">
          <div className="logo-icon">R</div>
          <span>Ribba</span>
        </div>

        <h1>Start met Ribba</h1>
        <p className="registration-description">
          Maak een account aan voor je rijschool en begin direct.
        </p>

        <SchoolRegistrationForm />

        <div className="divider" />

        <p className="footer-text">
          Vragen? Neem contact op met{' '}
          <a href="mailto:hallo@ribba.app">hallo@ribba.app</a>
        </p>
      </section>
    </main>
  );
}
