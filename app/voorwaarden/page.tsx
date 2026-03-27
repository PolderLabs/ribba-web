import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Algemene Voorwaarden | Ribba",
  description:
    "Algemene voorwaarden van Ribba rijschoolsoftware. Lees hier de voorwaarden voor het gebruik van onze SaaS-diensten.",
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

export default function VoorwaardenPage() {
  return (
    <div style={styles.container}>
      <Link href="/" style={styles.logo}>
        Ribba
      </Link>

      <h1 style={styles.h1}>Algemene Voorwaarden</h1>
      <p style={styles.updated}>Laatst bijgewerkt: maart 2026</p>

      {/* Artikel 1 */}
      <h2 style={styles.h2}>Artikel 1 — Definities</h2>
      <p style={styles.p}>In deze Algemene Voorwaarden wordt verstaan onder:</p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          <strong>Ribba:</strong> de SaaS-dienst aangeboden door PolderLabs,
          bereikbaar via ribba.app.
        </li>
        <li style={styles.li}>
          <strong>Gebruiker:</strong> de natuurlijke of rechtspersoon
          (rijschoolhouder, instructeur) die een account aanmaakt en gebruikmaakt
          van de Dienst.
        </li>
        <li style={styles.li}>
          <strong>Dienst:</strong> de online rijschoolsoftware van Ribba,
          inclusief planning, leerlingbeheer, facturatie en alle bijbehorende
          functionaliteiten.
        </li>
        <li style={styles.li}>
          <strong>Abonnement:</strong> de overeenkomst tussen Ribba en Gebruiker
          voor toegang tot de Dienst tegen een maandelijkse vergoeding.
        </li>
        <li style={styles.li}>
          <strong>Leerling:</strong> een persoon wiens gegevens door de Gebruiker
          worden ingevoerd en beheerd binnen de Dienst.
        </li>
        <li style={styles.li}>
          <strong>Account:</strong> de persoonlijke toegang van Gebruiker tot de
          Dienst, beveiligd met inloggegevens.
        </li>
      </ul>

      {/* Artikel 2 */}
      <h2 style={styles.h2}>Artikel 2 — Toepasselijkheid</h2>
      <p style={styles.p}>
        2.1. Deze Algemene Voorwaarden zijn van toepassing op elk gebruik van de
        Dienst en op elke overeenkomst tussen Ribba en de Gebruiker.
      </p>
      <p style={styles.p}>
        2.2. Door een account aan te maken of de Dienst te gebruiken, gaat de
        Gebruiker akkoord met deze Algemene Voorwaarden.
      </p>
      <p style={styles.p}>
        2.3. Afwijkingen van deze voorwaarden zijn alleen geldig indien
        schriftelijk overeengekomen.
      </p>
      <p style={styles.p}>
        2.4. Eventuele inkoop- of andere voorwaarden van de Gebruiker worden
        uitdrukkelijk van de hand gewezen.
      </p>

      {/* Artikel 3 */}
      <h2 style={styles.h2}>Artikel 3 — Abonnementen en prijzen</h2>
      <p style={styles.p}>
        3.1. Ribba biedt de volgende abonnementsvormen aan:
      </p>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Abonnement</th>
            <th style={styles.th}>Prijs</th>
            <th style={styles.th}>Omschrijving</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={styles.td}>Basic</td>
            <td style={styles.td}>&euro; 25,00 / maand</td>
            <td style={styles.td}>
              Alle basisfunctionaliteiten voor de zelfstandige rijinstructeur.
            </td>
          </tr>
          <tr>
            <td style={styles.td}>Premium</td>
            <td style={styles.td}>&euro; 45,00 / maand</td>
            <td style={styles.td}>
              Uitgebreide functies inclusief facturatie-integraties,
              boekhouding-koppeling en meer.
            </td>
          </tr>
        </tbody>
      </table>
      <p style={styles.p}>
        3.2. Alle genoemde prijzen zijn exclusief btw, tenzij anders vermeld.
      </p>
      <p style={styles.p}>
        3.3. Ribba behoudt zich het recht voor om prijzen aan te passen. Bij
        prijswijzigingen wordt de Gebruiker minimaal 30 dagen van tevoren op de
        hoogte gesteld. De Gebruiker heeft het recht om het Abonnement op te
        zeggen voordat de nieuwe prijs ingaat.
      </p>

      {/* Artikel 4 */}
      <h2 style={styles.h2}>Artikel 4 — Proefperiode</h2>
      <p style={styles.p}>
        4.1. Nieuwe Gebruikers ontvangen een gratis proefperiode van 3 maanden
        met volledige toegang tot alle functionaliteiten.
      </p>
      <p style={styles.p}>
        4.2. Voor de proefperiode is geen creditcard of betaalmethode vereist.
      </p>
      <p style={styles.p}>
        4.3. Na afloop van de proefperiode dient de Gebruiker een Abonnement te
        kiezen om de Dienst te blijven gebruiken. Zonder actief Abonnement wordt
        de toegang tot de Dienst beperkt.
      </p>
      <p style={styles.p}>
        4.4. Gegevens die tijdens de proefperiode zijn ingevoerd, blijven
        beschikbaar na het afsluiten van een Abonnement.
      </p>

      {/* Artikel 5 */}
      <h2 style={styles.h2}>Artikel 5 — Betaling</h2>
      <p style={styles.p}>
        5.1. Betaling geschiedt maandelijks vooraf via de betalingsprovider
        Mollie.
      </p>
      <p style={styles.p}>
        5.2. De eerste betaling vindt plaats via iDEAL. Hiermee wordt tevens een
        SEPA-machtiging afgegeven voor automatische incasso van toekomstige
        maandelijkse betalingen.
      </p>
      <p style={styles.p}>
        5.3. Bij niet-tijdige betaling stuurt Ribba een herinnering. Indien
        betaling na 14 dagen uitblijft, kan Ribba de toegang tot de Dienst
        opschorten.
      </p>
      <p style={styles.p}>
        5.4. Alle bedragen worden gefactureerd in euro&apos;s.
      </p>

      {/* Artikel 6 */}
      <h2 style={styles.h2}>Artikel 6 — Opzegging</h2>
      <p style={styles.p}>
        6.1. Het Abonnement is maandelijks opzegbaar.
      </p>
      <p style={styles.p}>
        6.2. Opzegging kan op elk moment plaatsvinden via de instellingen in de
        app of door een e-mail te sturen naar support@ribba.app.
      </p>
      <p style={styles.p}>
        6.3. Bij opzegging blijft het Abonnement actief tot het einde van de
        lopende maandperiode, tenzij de Gebruiker verzoekt om directe
        be&euml;indiging.
      </p>
      <p style={styles.p}>
        6.4. Na be&euml;indiging van het Abonnement heeft de Gebruiker 30 dagen
        de tijd om gegevens te exporteren. Daarna worden de gegevens verwijderd
        conform het privacybeleid.
      </p>
      <p style={styles.p}>
        6.5. Reeds betaalde bedragen worden niet gerestitueerd, tenzij sprake is
        van een toerekenbare tekortkoming aan de zijde van Ribba.
      </p>

      {/* Artikel 7 */}
      <h2 style={styles.h2}>Artikel 7 — Beschikbaarheid en onderhoud</h2>
      <p style={styles.p}>
        7.1. Ribba streeft naar een beschikbaarheid van de Dienst van 99,5% op
        jaarbasis.
      </p>
      <p style={styles.p}>
        7.2. Dit betreft een inspanningsverplichting en geen garantie. Ribba is
        niet aansprakelijk voor schade als gevolg van onbeschikbaarheid.
      </p>
      <p style={styles.p}>
        7.3. Ribba is gerechtigd de Dienst tijdelijk buiten gebruik te stellen
        voor onderhoud, updates of verbeteringen. Gepland onderhoud wordt waar
        mogelijk vooraf aangekondigd.
      </p>
      <p style={styles.p}>
        7.4. Ribba spant zich in om onderhoud buiten kantooruren uit te voeren.
      </p>

      {/* Artikel 8 */}
      <h2 style={styles.h2}>Artikel 8 — Gebruik van de Dienst</h2>
      <p style={styles.p}>
        8.1. De Gebruiker is verantwoordelijk voor het juiste gebruik van de
        Dienst en het geheimhouden van inloggegevens.
      </p>
      <p style={styles.p}>
        8.2. Het is niet toegestaan de Dienst te gebruiken voor onrechtmatige
        doeleinden of op een wijze die de Dienst of andere gebruikers schaadt.
      </p>
      <p style={styles.p}>
        8.3. De Gebruiker is zelf verantwoordelijk voor de juistheid en
        volledigheid van de ingevoerde gegevens.
      </p>
      <p style={styles.p}>
        8.4. Het is niet toegestaan om het Account ter beschikking te stellen
        aan derden zonder toestemming van Ribba.
      </p>

      {/* Artikel 9 */}
      <h2 style={styles.h2}>Artikel 9 — Intellectueel eigendom</h2>
      <p style={styles.p}>
        9.1. Alle intellectuele eigendomsrechten op de Dienst, waaronder
        software, teksten, ontwerpen en logo&apos;s, berusten bij Ribba /
        PolderLabs.
      </p>
      <p style={styles.p}>
        9.2. De Gebruiker verkrijgt een niet-exclusief, niet-overdraagbaar
        gebruiksrecht voor de duur van het Abonnement.
      </p>
      <p style={styles.p}>
        9.3. Het is niet toegestaan de Dienst te kopi&euml;ren, aan te passen,
        te reverse-engineeren of te distribueren.
      </p>
      <p style={styles.p}>
        9.4. De Gebruiker behoudt alle rechten op de door hem ingevoerde
        gegevens.
      </p>

      {/* Artikel 10 */}
      <h2 style={styles.h2}>Artikel 10 — Aansprakelijkheid</h2>
      <p style={styles.p}>
        10.1. De aansprakelijkheid van Ribba is beperkt tot het bedrag dat de
        Gebruiker in de maand voorafgaand aan de schadeveroorzakende gebeurtenis
        aan Ribba heeft betaald.
      </p>
      <p style={styles.p}>
        10.2. Ribba is niet aansprakelijk voor indirecte schade, waaronder
        gevolgschade, gederfde winst, gemiste besparingen of schade door
        bedrijfsstagnatie.
      </p>
      <p style={styles.p}>
        10.3. Ribba is niet aansprakelijk voor schade als gevolg van overmacht,
        waaronder storingen in internet-, telecommunicatie- of
        stroomvoorzieningen.
      </p>
      <p style={styles.p}>
        10.4. De in dit artikel genoemde beperkingen gelden niet indien sprake
        is van opzet of bewuste roekeloosheid van Ribba.
      </p>

      {/* Artikel 11 */}
      <h2 style={styles.h2}>Artikel 11 — Wijzigingen</h2>
      <p style={styles.p}>
        11.1. Ribba behoudt zich het recht voor deze Algemene Voorwaarden te
        wijzigen.
      </p>
      <p style={styles.p}>
        11.2. Wijzigingen worden minimaal 30 dagen van tevoren per e-mail of
        via de Dienst aan de Gebruiker bekendgemaakt.
      </p>
      <p style={styles.p}>
        11.3. Indien de Gebruiker niet akkoord gaat met de gewijzigde
        voorwaarden, heeft hij het recht het Abonnement op te zeggen v&oacute;&oacute;r
        de ingangsdatum van de wijzigingen.
      </p>
      <p style={styles.p}>
        11.4. Voortgezet gebruik van de Dienst na de ingangsdatum geldt als
        aanvaarding van de gewijzigde voorwaarden.
      </p>

      {/* Artikel 12 */}
      <h2 style={styles.h2}>Artikel 12 — Toepasselijk recht en geschillen</h2>
      <p style={styles.p}>
        12.1. Op deze Algemene Voorwaarden en alle overeenkomsten tussen Ribba
        en de Gebruiker is Nederlands recht van toepassing.
      </p>
      <p style={styles.p}>
        12.2. Geschillen worden bij voorkeur in onderling overleg opgelost.
        Indien dit niet lukt, is de bevoegde rechter in het arrondissement van
        de vestigingsplaats van PolderLabs bevoegd.
      </p>

      {/* Artikel 13 */}
      <h2 style={styles.h2}>Artikel 13 — Contact</h2>
      <p style={styles.p}>
        Voor vragen over deze Algemene Voorwaarden kunt u contact opnemen via:
      </p>
      <ul style={styles.ul}>
        <li style={styles.li}>
          <strong>E-mail:</strong> support@ribba.app
        </li>
        <li style={styles.li}>
          <strong>Website:</strong> ribba.app
        </li>
      </ul>

      <h2 style={styles.h2}>Ingangsdatum</h2>
      <p style={styles.p}>
        Deze Algemene Voorwaarden treden in werking op 1 maart 2026.
      </p>
    </div>
  );
}
