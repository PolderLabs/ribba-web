import type { Metadata } from "next";
import Link from "next/link";
import RibbaLogo from "../components/RibbaLogo";

export const metadata: Metadata = {
  title: "Privacyverklaring | Ribba",
  description:
    "Privacyverklaring van Ribba rijschoolsoftware. Lees hoe wij omgaan met persoonsgegevens conform de AVG/GDPR.",
};

const styles = {
  container: {
    maxWidth: 800,
    margin: "0 auto",
    padding: "40px 24px 80px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#1a1a1a",
    lineHeight: 1.7,
  } as React.CSSProperties,
  logo: {
    display: "inline-block",
    fontSize: 24,
    fontWeight: 700,
    color: "#2563EB",
    textDecoration: "none",
    marginBottom: 48,
  } as React.CSSProperties,
  h1: {
    fontSize: 32,
    fontWeight: 700,
    color: "#111",
    marginBottom: 8,
  } as React.CSSProperties,
  updated: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 40,
  } as React.CSSProperties,
  h2: {
    fontSize: 22,
    fontWeight: 600,
    color: "#111",
    marginTop: 40,
    marginBottom: 16,
    paddingBottom: 8,
    borderBottom: "1px solid #e5e7eb",
  } as React.CSSProperties,
  h3: {
    fontSize: 17,
    fontWeight: 600,
    color: "#374151",
    marginTop: 24,
    marginBottom: 8,
  } as React.CSSProperties,
  p: {
    fontSize: 15,
    marginBottom: 12,
    color: "#374151",
  } as React.CSSProperties,
  ul: {
    paddingLeft: 24,
    marginBottom: 12,
  } as React.CSSProperties,
  li: {
    fontSize: 15,
    color: "#374151",
    marginBottom: 6,
  } as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    marginBottom: 16,
    marginTop: 12,
  } as React.CSSProperties,
  th: {
    textAlign: "left" as const,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    color: "#374151",
    backgroundColor: "#f3f4f6",
    borderBottom: "2px solid #e5e7eb",
  } as React.CSSProperties,
  td: {
    padding: "10px 16px",
    fontSize: 14,
    color: "#374151",
    borderBottom: "1px solid #e5e7eb",
  } as React.CSSProperties,
};

export default function PrivacyPage() {
  return (
    <div style={styles.container}>
      <Link href="/" style={{ display: 'inline-flex', marginBottom: 48 }}>
        <RibbaLogo height={36} />
      </Link>

      <h1 style={styles.h1}>Privacyverklaring</h1>
      <p style={styles.updated}>Laatst bijgewerkt: maart 2026</p>

      <p style={styles.p}>
        Ribba hecht groot belang aan de bescherming
        van uw persoonsgegevens. In deze privacyverklaring leggen wij uit welke
        gegevens wij verzamelen, waarom wij dat doen en hoe wij daarmee omgaan,
        conform de Algemene Verordening Gegevensbescherming (AVG/GDPR).
      </p>

      {/* 1 */}
      <h2 style={styles.h2}>1. Wie zijn wij</h2>
      <p style={styles.p}>
        Ribba biedt SaaS-rijschoolsoftware aan voor planning,
        leerlingbeheer en facturatie.
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          <strong>Bedrijfsnaam:</strong> Ribba
        </li>
        <li style={styles.li}>
          <strong>KVK-nummer:</strong> 85826898
        </li>
        <li style={styles.li}>
          <strong>Contactpersoon:</strong> Önder Ates
        </li>
        <li style={styles.li}>
          <strong>Telefoon:</strong> 06-41774557
        </li>
        <li style={styles.li}>
          <strong>E-mail:</strong> info@ribba.app
        </li>
        <li style={styles.li}>
          <strong>Website:</strong> ribba.app
        </li>
      </ul>

      {/* 2 */}
      <h2 style={styles.h2}>2. Welke persoonsgegevens verwerken wij</h2>

      <h3 style={styles.h3}>2.1 Instructeurs (Gebruikers)</h3>
      <ul style={styles.ul}>
        <li style={styles.li}>Naam en contactgegevens (e-mail, telefoonnummer)</li>
        <li style={styles.li}>
          Bedrijfsgegevens (bedrijfsnaam, KVK-nummer, btw-nummer, IBAN)
        </li>
        <li style={styles.li}>Inloggegevens (e-mailadres en versleuteld wachtwoord)</li>
        <li style={styles.li}>Gebruiksgegevens van de Dienst</li>
      </ul>

      <h3 style={styles.h3}>2.2 Leerlingen</h3>
      <ul style={styles.ul}>
        <li style={styles.li}>Naam en contactgegevens (e-mail, telefoonnummer)</li>
        <li style={styles.li}>Adresgegevens</li>
        <li style={styles.li}>Geboortedatum</li>
        <li style={styles.li}>Rijbewijscategorie</li>
        <li style={styles.li}>Lesvoortgang en leshistorie</li>
      </ul>

      <h3 style={styles.h3}>2.3 Betalingsgegevens</h3>
      <ul style={styles.ul}>
        <li style={styles.li}>Factuurgegevens en betalingsstatus</li>
        <li style={styles.li}>
          Betalingen worden verwerkt via Mollie. Ribba slaat geen creditcard- of
          bankgegevens op. Deze worden uitsluitend door Mollie beheerd.
        </li>
      </ul>

      {/* 3 */}
      <h2 style={styles.h2}>3. Doeleinden van de verwerking</h2>
      <p style={styles.p}>
        Wij verwerken persoonsgegevens voor de volgende doeleinden:
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          <strong>Dienstverlening:</strong> het aanbieden en verbeteren van de
          rijschoolsoftware, inclusief planning, leerlingbeheer en facturatie.
        </li>
        <li style={styles.li}>
          <strong>Facturatie:</strong> het opstellen en verzenden van facturen
          en het verwerken van betalingen.
        </li>
        <li style={styles.li}>
          <strong>Communicatie:</strong> het beantwoorden van vragen, het
          versturen van serviceberichten en meldingen.
        </li>
        <li style={styles.li}>
          <strong>Wettelijke verplichtingen:</strong> het voldoen aan fiscale en
          administratieve bewaarplichten.
        </li>
      </ul>

      {/* 4 */}
      <h2 style={styles.h2}>4. Rechtsgrond</h2>
      <p style={styles.p}>
        De verwerking van persoonsgegevens is gebaseerd op de volgende
        rechtsgronden:
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          <strong>Uitvoering van de overeenkomst:</strong> de verwerking is
          noodzakelijk voor het leveren van de Dienst.
        </li>
        <li style={styles.li}>
          <strong>Gerechtvaardigd belang:</strong> het verbeteren van de Dienst
          en het voorkomen van fraude.
        </li>
        <li style={styles.li}>
          <strong>Wettelijke verplichting:</strong> het voldoen aan fiscale
          bewaarplichten en andere wettelijke verplichtingen.
        </li>
      </ul>

      {/* 5 */}
      <h2 style={styles.h2}>5. Bewaartermijnen</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Categorie</th>
            <th style={styles.th}>Bewaartermijn</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={styles.td}>Accountgegevens</td>
            <td style={styles.td}>
              Zolang het account actief is, plus maximaal 2 jaar na
              be&euml;indiging
            </td>
          </tr>
          <tr>
            <td style={styles.td}>Leerlinggegevens</td>
            <td style={styles.td}>
              Zolang het account actief is, plus maximaal 2 jaar na
              be&euml;indiging
            </td>
          </tr>
          <tr>
            <td style={styles.td}>
              Financi&euml;le gegevens (facturen, betalingen)
            </td>
            <td style={styles.td}>7 jaar (wettelijke fiscale bewaarplicht)</td>
          </tr>
        </tbody>
      </table>

      {/* 6 */}
      <h2 style={styles.h2}>6. Delen met derden</h2>
      <p style={styles.p}>
        Wij delen persoonsgegevens uitsluitend met de volgende partijen, en
        alleen voor zover noodzakelijk voor de dienstverlening:
      </p>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Partij</th>
            <th style={styles.th}>Doel</th>
            <th style={styles.th}>Locatie</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={styles.td}>Supabase</td>
            <td style={styles.td}>Hosting en database</td>
            <td style={styles.td}>EU (Frankfurt)</td>
          </tr>
          <tr>
            <td style={styles.td}>Mollie</td>
            <td style={styles.td}>Betalingsverwerking</td>
            <td style={styles.td}>Nederland</td>
          </tr>
          <tr>
            <td style={styles.td}>Moneybird</td>
            <td style={styles.td}>
              Boekhouding (alleen indien gekoppeld door Gebruiker)
            </td>
            <td style={styles.td}>Nederland</td>
          </tr>
          <tr>
            <td style={styles.td}>Resend</td>
            <td style={styles.td}>E-mailverzending</td>
            <td style={styles.td}>VS (EU-VS Data Privacy Framework)</td>
          </tr>
          <tr>
            <td style={styles.td}>CBR</td>
            <td style={styles.td}>
              Examenplanning (alleen indien gekoppeld door Gebruiker)
            </td>
            <td style={styles.td}>Nederland</td>
          </tr>
        </tbody>
      </table>
      <p style={styles.p}>
        Wij verkopen geen persoonsgegevens aan derden en delen geen gegevens
        voor marketingdoeleinden van derden.
      </p>

      {/* 7 */}
      <h2 style={styles.h2}>7. Beveiliging</h2>
      <p style={styles.p}>
        Wij nemen passende technische en organisatorische maatregelen om
        persoonsgegevens te beschermen tegen ongeautoriseerde toegang, verlies
        of misbruik:
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          Alle verbindingen zijn beveiligd met SSL/TLS-versleuteling.
        </li>
        <li style={styles.li}>
          Gegevenstoegang is beperkt via Row Level Security (RLS) op
          databaseniveau: elke Gebruiker heeft alleen toegang tot eigen
          gegevens.
        </li>
        <li style={styles.li}>
          Wachtwoorden worden versleuteld opgeslagen en zijn niet leesbaar voor
          medewerkers van Ribba.
        </li>
        <li style={styles.li}>
          Regelmatige back-ups van de database.
        </li>
      </ul>

      {/* 8 */}
      <h2 style={styles.h2}>8. Rechten van betrokkenen</h2>
      <p style={styles.p}>
        Op grond van de AVG heeft u de volgende rechten:
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          <strong>Recht op inzage:</strong> u kunt opvragen welke
          persoonsgegevens wij van u verwerken.
        </li>
        <li style={styles.li}>
          <strong>Recht op correctie:</strong> u kunt verzoeken om onjuiste
          gegevens te laten aanpassen.
        </li>
        <li style={styles.li}>
          <strong>Recht op verwijdering:</strong> u kunt verzoeken om uw
          gegevens te laten verwijderen, voor zover wettelijk toegestaan.
        </li>
        <li style={styles.li}>
          <strong>Recht op beperking:</strong> u kunt verzoeken om de verwerking
          van uw gegevens te beperken.
        </li>
        <li style={styles.li}>
          <strong>Recht op overdraagbaarheid:</strong> u kunt verzoeken om uw
          gegevens in een gangbaar formaat te ontvangen.
        </li>
        <li style={styles.li}>
          <strong>Recht van bezwaar:</strong> u kunt bezwaar maken tegen de
          verwerking van uw gegevens.
        </li>
      </ul>
      <p style={styles.p}>
        U kunt uw rechten uitoefenen door een e-mail te sturen naar{" "}
        <strong>support@ribba.app</strong>. Wij reageren binnen 30 dagen op uw
        verzoek.
      </p>

      {/* 9 */}
      <h2 style={styles.h2}>9. Cookies</h2>
      <p style={styles.p}>
        Ribba maakt uitsluitend gebruik van functionele cookies die noodzakelijk
        zijn voor de werking van de Dienst, zoals sessiecookies voor
        inlogbeheer.
      </p>
      <p style={styles.p}>
        Wij plaatsen geen tracking-, analytische of advertentiecookies. Er is
        daarom geen cookiebanner noodzakelijk.
      </p>

      {/* 10 */}
      <h2 style={styles.h2}>10. Wijzigingen</h2>
      <p style={styles.p}>
        Ribba behoudt zich het recht voor om deze privacyverklaring te
        wijzigen. Bij substantiële wijzigingen informeren wij Gebruikers via
        e-mail of een melding in de Dienst. De meest actuele versie is altijd
        beschikbaar op ribba.app/privacy.
      </p>

      {/* 11 */}
      <h2 style={styles.h2}>11. Klachten</h2>
      <p style={styles.p}>
        Indien u een klacht heeft over de verwerking van uw persoonsgegevens,
        neem dan eerst contact met ons op via support@ribba.app. Wij helpen u
        graag.
      </p>
      <p style={styles.p}>
        U heeft daarnaast het recht om een klacht in te dienen bij de Autoriteit
        Persoonsgegevens, de toezichthoudende autoriteit in Nederland.
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          <strong>Website:</strong> autoriteitpersoonsgegevens.nl
        </li>
      </ul>

      {/* 12 */}
      <h2 style={styles.h2}>12. Contact</h2>
      <p style={styles.p}>
        Voor vragen over deze privacyverklaring of over de verwerking van uw
        persoonsgegevens kunt u contact opnemen via:
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          <strong>E-mail:</strong> support@ribba.app
        </li>
        <li style={styles.li}>
          <strong>Website:</strong> ribba.app
        </li>
      </ul>
    </div>
  );
}
