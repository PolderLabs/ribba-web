// Waar Stripe de rijschool naartoe stuurt na een geslaagde Checkout.
//
// DEZE PAGINA WEET NIETS EN CLAIMT NIETS. Zij verschijnt omdat de browser
// terugkwam van Stripe — niet omdat de inschrijving is afgerond. Dat laatste
// gebeurt in de webhook, asynchroon, en bij SEPA soms pas seconden later.
//
// Daarom staat er geen "je account is aangemaakt" en geen inlogknop: dat zou
// een belofte zijn die deze pagina niet kan waarmaken. Wat er wél staat is het
// enige dat zeker is — de machtiging is gegeven, en de set-wachtwoordmail komt
// eraan. Zie ook het besluit "alleen Stripe activeert een account" (§9.8 van
// het mandaat-ontwerp): nooit de redirect of de browser.
//
// De Google Ads-conversie hoort hier, en niet bij het verzenden van het
// formulier: pas hier is er een machtiging. Op het formulier zou hij iedereen
// meetellen die de betaalpagina zag en wegklikte.

import type { Metadata } from 'next';
import RibbaLogo from '../../components/RibbaLogo';
import { SignupConversie } from './SignupConversie';

export const metadata: Metadata = {
  title: 'Inschrijving ontvangen – Ribba',
  description: 'We ronden je Ribba-account af. Je ontvangt een e-mail om een wachtwoord te kiezen.',
  // Een bedanktpagina hoort niet in de zoekresultaten: hij is alleen zinvol
  // direct na een checkout, en zonder die context misleidend.
  robots: { index: false, follow: false },
};

export default function InschrijvingOntvangenPage() {
  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-brand">
          <RibbaLogo height={36} />
        </div>

        <h1>Je inschrijving is ontvangen</h1>

        <p className="registration-description">
          Bedankt — je machtiging is doorgegeven aan onze betaalprovider. We
          ronden je Ribba-account nu af.
        </p>

        <div
          style={{
            background: '#F5F5F4',
            border: '1px solid #E7E5E4',
            borderRadius: 12,
            padding: '16px 18px',
            margin: '20px 0',
            textAlign: 'left',
          }}
        >
          <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 15 }}>Wat er nu gebeurt</p>
          <p style={{ margin: 0, fontSize: 14, color: '#57534E', lineHeight: 1.7 }}>
            Je ontvangt binnen enkele minuten een e-mail waarmee je zelf een
            wachtwoord kiest. Daarna log je in de Ribba-app in met je
            e-mailadres.
          </p>
        </div>

        <p style={{ fontSize: 14, color: '#78716C', lineHeight: 1.6 }}>
          Geen e-mail ontvangen? Kijk eerst in je spam. Blijft hij weg, mail dan{' '}
          <a href="mailto:team@ribba.nl">team@ribba.nl</a> — we zoeken het voor
          je uit.
        </p>

        <div className="divider" />

        <p className="footer-text">
          Vragen? Neem contact op met <a href="mailto:team@ribba.nl">team@ribba.nl</a>
        </p>
      </section>

      <SignupConversie />
    </main>
  );
}
