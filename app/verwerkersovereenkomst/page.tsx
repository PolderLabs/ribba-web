import type { Metadata } from "next";
import Link from "next/link";
import RibbaLogo from "../components/RibbaLogo";

export const metadata: Metadata = {
  title: "Verwerkersovereenkomst | Ribba",
  description:
    "Verwerkersovereenkomst van Ribba rijschoolsoftware conform de AVG/GDPR. Voor rijscholen die Ribba gebruiken als verwerker van persoonsgegevens.",
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
  intro: {
    fontSize: 15,
    color: "#374151",
    marginBottom: 12,
    fontStyle: "italic" as const,
  } as React.CSSProperties,
};

export default function VerwerkersovereenkomstPage() {
  return (
    <div style={styles.container}>
      <Link href="/" style={{ display: 'inline-flex', marginBottom: 48 }}>
        <RibbaLogo height={36} />
      </Link>

      <h1 style={styles.h1}>Verwerkersovereenkomst</h1>
      <p style={styles.updated}>Laatst bijgewerkt: maart 2026</p>

      <p style={styles.intro}>
        Deze verwerkersovereenkomst (&quot;Overeenkomst&quot;) maakt onderdeel
        uit van de Algemene Voorwaarden van Ribba en is van toepassing op de
        verwerking van persoonsgegevens in het kader van de Dienst.
      </p>

      {/* Artikel 1 */}
      <h2 style={styles.h2}>Artikel 1 — Partijen</h2>
      <p style={styles.p}>
        1.1. <strong>Verwerkingsverantwoordelijke</strong> (&quot;de
        Rijschool&quot;): de Gebruiker die een account heeft bij Ribba en in het
        kader van zijn rijschoolactiviteiten persoonsgegevens van leerlingen en
        medewerkers verwerkt.
      </p>
      <p style={styles.p}>
        1.2. <strong>Verwerker</strong> (&quot;Ribba&quot;): Ribba, onderdeel
        van Ribba (KVK: 85826898), die in opdracht van de Verwerkingsverantwoordelijke
        persoonsgegevens verwerkt ten behoeve van de Dienst.
      </p>

      {/* Artikel 2 */}
      <h2 style={styles.h2}>Artikel 2 — Definities</h2>
      <p style={styles.p}>
        De begrippen in deze Overeenkomst hebben dezelfde betekenis als in de
        Algemene Verordening Gegevensbescherming (Verordening (EU) 2016/679,
        &quot;AVG&quot;), tenzij hieronder anders is bepaald.
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          <strong>Persoonsgegevens:</strong> alle informatie over een
          ge&iuml;dentificeerde of identificeerbare natuurlijke persoon.
        </li>
        <li style={styles.li}>
          <strong>Verwerking:</strong> elke bewerking of elk geheel van
          bewerkingen met betrekking tot persoonsgegevens, al dan niet
          geautomatiseerd.
        </li>
        <li style={styles.li}>
          <strong>Datalek:</strong> een inbreuk op de beveiliging die per
          ongeluk of op onrechtmatige wijze leidt tot vernietiging, verlies,
          wijziging of ongeoorloofde verstrekking van persoonsgegevens.
        </li>
      </ul>

      {/* Artikel 3 */}
      <h2 style={styles.h2}>Artikel 3 — Onderwerp en duur</h2>
      <p style={styles.p}>
        3.1. Deze Overeenkomst is van kracht zolang de Rijschool een actief
        Abonnement heeft op de Dienst van Ribba.
      </p>
      <p style={styles.p}>
        3.2. Bij be&euml;indiging van het Abonnement eindigt deze Overeenkomst
        van rechtswege, met inachtneming van de bepalingen over teruggave en
        verwijdering (Artikel 11).
      </p>

      {/* Artikel 4 */}
      <h2 style={styles.h2}>Artikel 4 — Aard en doel van de verwerking</h2>
      <p style={styles.p}>
        4.1. Ribba verwerkt persoonsgegevens uitsluitend in het kader van het
        leveren van de Dienst, te weten:
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          Rijschoolbeheer: het administreren van leerlingen en hun voortgang
        </li>
        <li style={styles.li}>
          Lesplanning: het inplannen en beheren van rijlessen
        </li>
        <li style={styles.li}>
          Facturatie: het opstellen, verzenden en bijhouden van facturen
        </li>
        <li style={styles.li}>
          Communicatie: het verzenden van berichten aan leerlingen namens de
          Rijschool
        </li>
        <li style={styles.li}>
          Boekhouding: het synchroniseren van gegevens met boekhoudpakketten
          (indien gekoppeld)
        </li>
        <li style={styles.li}>
          CBR-koppeling: het doorgeven van examengegevens aan het CBR (indien
          gekoppeld)
        </li>
      </ul>

      {/* Artikel 5 */}
      <h2 style={styles.h2}>Artikel 5 — Soorten persoonsgegevens</h2>
      <p style={styles.p}>
        De volgende categorie&euml;n persoonsgegevens worden verwerkt:
      </p>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Categorie</th>
            <th style={styles.th}>Gegevens</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={styles.td}>Identificatiegegevens</td>
            <td style={styles.td}>Naam, geboortedatum</td>
          </tr>
          <tr>
            <td style={styles.td}>Contactgegevens</td>
            <td style={styles.td}>E-mailadres, telefoonnummer, adres</td>
          </tr>
          <tr>
            <td style={styles.td}>Lesgegevens</td>
            <td style={styles.td}>
              Lesplanning, lesvoortgang, rijbewijscategorie, resultaten
            </td>
          </tr>
          <tr>
            <td style={styles.td}>Financi&euml;le gegevens</td>
            <td style={styles.td}>
              Facturen, betalingsstatus, pakketkeuze
            </td>
          </tr>
          <tr>
            <td style={styles.td}>Bedrijfsgegevens (instructeur)</td>
            <td style={styles.td}>
              Bedrijfsnaam, KVK-nummer, btw-nummer, IBAN
            </td>
          </tr>
        </tbody>
      </table>

      {/* Artikel 6 */}
      <h2 style={styles.h2}>
        Artikel 6 — Categorie&euml;n betrokkenen
      </h2>
      <p style={styles.p}>
        De persoonsgegevens die worden verwerkt hebben betrekking op de volgende
        categorie&euml;n betrokkenen:
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          <strong>Leerlingen:</strong> personen die rijlessen volgen bij de
          Rijschool
        </li>
        <li style={styles.li}>
          <strong>Instructeurs:</strong> medewerkers van de Rijschool die de
          Dienst gebruiken
        </li>
      </ul>

      {/* Artikel 7 */}
      <h2 style={styles.h2}>Artikel 7 — Verplichtingen van de Verwerker</h2>
      <p style={styles.p}>Ribba verbindt zich tot het volgende:</p>

      <h3 style={styles.h3}>7.1 Instructies</h3>
      <p style={styles.p}>
        Ribba verwerkt persoonsgegevens uitsluitend op basis van schriftelijke
        instructies van de Verwerkingsverantwoordelijke, waaronder de instructies
        in deze Overeenkomst, tenzij een wettelijke verplichting anders vereist.
      </p>

      <h3 style={styles.h3}>7.2 Vertrouwelijkheid</h3>
      <p style={styles.p}>
        Ribba waarborgt dat personen die toegang hebben tot persoonsgegevens
        gebonden zijn aan vertrouwelijkheid, hetzij op grond van een
        overeenkomst, hetzij op grond van een wettelijke verplichting.
      </p>

      <h3 style={styles.h3}>7.3 Beveiligingsmaatregelen</h3>
      <p style={styles.p}>
        Ribba treft passende technische en organisatorische maatregelen om een
        beveiligingsniveau te waarborgen dat past bij het risico, waaronder:
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>Versleuteling van gegevens in transit (SSL/TLS)</li>
        <li style={styles.li}>Versleuteling van gegevens at rest</li>
        <li style={styles.li}>
          Row Level Security (RLS): gegevens zijn strikt gescheiden per
          Gebruiker op databaseniveau
        </li>
        <li style={styles.li}>
          Toegangsbeheer: alleen geautoriseerd personeel heeft toegang
        </li>
        <li style={styles.li}>Regelmatige back-ups</li>
        <li style={styles.li}>
          Monitoring en logging van toegang tot systemen
        </li>
      </ul>

      <h3 style={styles.h3}>7.4 Meldplicht datalekken</h3>
      <p style={styles.p}>
        Ribba informeert de Verwerkingsverantwoordelijke zonder onredelijke
        vertraging, en in elk geval binnen 48 uur na kennisneming, over een
        Datalek dat betrekking heeft op persoonsgegevens van de
        Verwerkingsverantwoordelijke. De melding bevat ten minste:
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>De aard van het Datalek</li>
        <li style={styles.li}>
          De categorie&euml;n betrokkenen en persoonsgegevens die getroffen zijn
        </li>
        <li style={styles.li}>
          De waarschijnlijke gevolgen van het Datalek
        </li>
        <li style={styles.li}>
          De maatregelen die zijn genomen of voorgesteld om het Datalek aan te
          pakken
        </li>
      </ul>

      {/* Artikel 8 */}
      <h2 style={styles.h2}>Artikel 8 — Sub-verwerkers</h2>
      <p style={styles.p}>
        8.1. De Verwerkingsverantwoordelijke verleent hierbij algemene
        schriftelijke toestemming aan Ribba om sub-verwerkers in te schakelen.
      </p>
      <p style={styles.p}>
        8.2. Ribba maakt gebruik van de volgende sub-verwerkers:
      </p>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Sub-verwerker</th>
            <th style={styles.th}>Dienst</th>
            <th style={styles.th}>Locatie</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={styles.td}>Supabase Inc.</td>
            <td style={styles.td}>Hosting, database en authenticatie</td>
            <td style={styles.td}>EU (Frankfurt, Duitsland)</td>
          </tr>
          <tr>
            <td style={styles.td}>Mollie B.V.</td>
            <td style={styles.td}>Betalingsverwerking</td>
            <td style={styles.td}>Nederland</td>
          </tr>
          <tr>
            <td style={styles.td}>Resend Inc.</td>
            <td style={styles.td}>E-mailverzending</td>
            <td style={styles.td}>
              VS (gecertificeerd onder EU-VS Data Privacy Framework)
            </td>
          </tr>
          <tr>
            <td style={styles.td}>Moneybird B.V.</td>
            <td style={styles.td}>
              Boekhouding (alleen indien door Gebruiker gekoppeld)
            </td>
            <td style={styles.td}>Nederland</td>
          </tr>
        </tbody>
      </table>
      <p style={styles.p}>
        8.3. Ribba informeert de Verwerkingsverantwoordelijke vooraf over
        wijzigingen in de lijst van sub-verwerkers. De
        Verwerkingsverantwoordelijke kan binnen 30 dagen bezwaar maken. Indien
        het bezwaar gegrond is en geen oplossing wordt bereikt, heeft de
        Verwerkingsverantwoordelijke het recht de Overeenkomst op te zeggen.
      </p>
      <p style={styles.p}>
        8.4. Ribba legt aan sub-verwerkers dezelfde verplichtingen op als in
        deze Overeenkomst.
      </p>

      {/* Artikel 9 */}
      <h2 style={styles.h2}>Artikel 9 — Rechten van betrokkenen</h2>
      <p style={styles.p}>
        9.1. Ribba verleent medewerking aan de Verwerkingsverantwoordelijke bij
        het afhandelen van verzoeken van betrokkenen op grond van de AVG (inzage,
        correctie, verwijdering, beperking, overdraagbaarheid, bezwaar).
      </p>
      <p style={styles.p}>
        9.2. Indien Ribba een verzoek van een betrokkene ontvangt dat gericht is
        aan de Verwerkingsverantwoordelijke, stuurt Ribba dit verzoek onverwijld
        door.
      </p>
      <p style={styles.p}>
        9.3. Ribba biedt waar mogelijk technische functionaliteiten waarmee de
        Verwerkingsverantwoordelijke zelfstandig aan verzoeken van betrokkenen
        kan voldoen (bijv. export- en verwijderfuncties).
      </p>

      {/* Artikel 10 */}
      <h2 style={styles.h2}>Artikel 10 — Audits</h2>
      <p style={styles.p}>
        10.1. Ribba stelt alle informatie ter beschikking die nodig is om de
        naleving van deze Overeenkomst aan te tonen en maakt audits mogelijk.
      </p>
      <p style={styles.p}>
        10.2. De Verwerkingsverantwoordelijke kan maximaal eenmaal per jaar een
        audit (laten) uitvoeren, na minimaal 30 dagen schriftelijke
        vooraankondiging.
      </p>
      <p style={styles.p}>
        10.3. De kosten van de audit komen voor rekening van de
        Verwerkingsverantwoordelijke, tenzij uit de audit blijkt dat Ribba niet
        aan haar verplichtingen voldoet.
      </p>

      {/* Artikel 11 */}
      <h2 style={styles.h2}>
        Artikel 11 — Teruggave en verwijdering na be&euml;indiging
      </h2>
      <p style={styles.p}>
        11.1. Na be&euml;indiging van het Abonnement heeft de
        Verwerkingsverantwoordelijke 30 dagen de tijd om gegevens te exporteren.
      </p>
      <p style={styles.p}>
        11.2. Na het verstrijken van deze termijn verwijdert Ribba alle
        persoonsgegevens die in opdracht van de Verwerkingsverantwoordelijke zijn
        verwerkt, tenzij een wettelijke bewaarplicht anders vereist.
      </p>
      <p style={styles.p}>
        11.3. Ribba verstrekt op verzoek een schriftelijke bevestiging van de
        verwijdering.
      </p>

      {/* Artikel 12 */}
      <h2 style={styles.h2}>Artikel 12 — Aansprakelijkheid</h2>
      <p style={styles.p}>
        12.1. De aansprakelijkheid van Ribba onder deze Overeenkomst is beperkt
        conform de bepalingen in de Algemene Voorwaarden.
      </p>
      <p style={styles.p}>
        12.2. Iedere partij is aansprakelijk voor schade die het gevolg is van
        het niet naleven van de AVG, voor zover die schade aan haar kan worden
        toegerekend.
      </p>

      {/* Artikel 13 */}
      <h2 style={styles.h2}>Artikel 13 — Toepasselijk recht</h2>
      <p style={styles.p}>
        13.1. Op deze Verwerkersovereenkomst is Nederlands recht van toepassing.
      </p>
      <p style={styles.p}>
        13.2. Geschillen worden voorgelegd aan de bevoegde rechter in het
        arrondissement van de vestigingsplaats van Ribba (KVK: 85826898).
      </p>

      {/* Artikel 14 */}
      <h2 style={styles.h2}>Artikel 14 — Contact</h2>
      <p style={styles.p}>
        Voor vragen over deze Verwerkersovereenkomst kunt u contact opnemen via:
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          <strong>E-mail:</strong> info@ribba.app
        </li>
        <li style={styles.li}>
          <strong>Website:</strong> ribba.app
        </li>
      </ul>
    </div>
  );
}
