// Welke inschrijfroute er live is — en wat daar uit volgt.
//
// Er bestaan twee routes naast elkaar:
//
//   /api/register-school   de huidige. Maakt direct een school en account.
//                          Kent geen actiecode en geen proefperiode uit Stripe.
//   /api/signup/start      de nieuwe. Maakt een pending registratie, resolvet
//                          het aanbod en stuurt naar Checkout; de school
//                          ontstaat pas op bevestiging van Stripe.
//
// Bewust twee endpoints in plaats van een feature flag: een schakelaar wordt
// zelf toestand, en een tweede endpoint dat straks het eerste vervangt is
// eerlijker.
//
// ── WAAROM DIT BESTAND BESTAAT ──────────────────────────────────────────────
//
// De actiecode mag niet zichtbaar zijn zolang de oude route draait. Die kent
// `promo_code` niet, dus iemand zou STARTGRATIS kunnen invullen, "6 maanden
// gratis" lezen, zich inschrijven en die zes maanden niet krijgen. Dat is het
// verschil tussen wat we beloven en wat we uitvoeren, en juist dat hebben we
// overal weggeontworpen.
//
// Een los `PROMO_ZICHTBAAR = false` zou dat risico terugbrengen: twee dingen
// die samen moeten omgaan, en dus een keer uit de pas lopen. Daarom is de
// zichtbaarheid AFGELEID. Eén plek veranderen — `ACTIEVE_SIGNUP_ROUTE` — en
// alles wat ervan afhangt gaat vanzelf mee.
//
// De omschakeling gebeurt pas wanneer de hele nieuwe keten compleet is:
// promo-inwisseling bij activatie, Revenue Recovery, en opgeruimde
// €0-prijzen in Stripe.

export const OUDE_SIGNUP_ROUTE = '/api/register-school';
export const NIEUWE_SIGNUP_ROUTE = '/api/signup/start';

/** De route waar het registratieformulier vandaag naartoe post. */
//
// ⚠️ OMGEZET VOOR DE KETENPROBE — DEZE BRANCH MAG NOOIT NAAR MAIN.
//
// Op main staat deze constante op OUDE_SIGNUP_ROUTE. Hier staat hij om, zodat
// de Vercel-preview van deze branch de nieuwe keten laat zien: formulier →
// pending registratie → Stripe Checkout.
//
// Diezelfde preview draait wel op de ECHTE database en het ECHTE
// Stripe-account. Een inschrijving hier is dus een echte inschrijving, met een
// echte rijschool en een echt SEPA-mandaat. Dat is precies de bedoeling van de
// probe — maar het is geen speeltuin.
//
// Zie de probe-afspraak in ribbaPro docs/design/mandaat-bij-inschrijving.
export const ACTIEVE_SIGNUP_ROUTE: string = NIEUWE_SIGNUP_ROUTE;

/**
 * Vraagt de actieve route om een wachtwoord bij inschrijven?
 *
 * De oude route maakt het account meteen aan en EIST daarom een wachtwoord.
 * De nieuwe route maakt het account pas na de betaling; de rijschool kiest
 * daarna zelf een wachtwoord via de set-wachtwoordmail, en een wachtwoord in
 * het formulier zou dan nergens heen gaan.
 *
 * Ook dit is afgeleid en niet los instelbaar: zouden de velden verdwijnen
 * terwijl de oude route nog draait, dan weigert die met "alle verplichte
 * velden" en is inschrijven onmogelijk.
 */
export const wachtwoordBijInschrijven = ACTIEVE_SIGNUP_ROUTE === OUDE_SIGNUP_ROUTE;

/**
 * Mag het formulier een actiecode aanbieden?
 *
 * Alleen wanneer de actieve route hem ook daadwerkelijk kan honoreren. Niet
 * los instelbaar — dat is het hele punt.
 */
export const promoBeschikbaar = ACTIEVE_SIGNUP_ROUTE === NIEUWE_SIGNUP_ROUTE;

/**
 * Wat de verzendknop belooft.
 *
 * Ook afgeleid, en om dezelfde reden als de rest: de knop moet zeggen wat er
 * daadwerkelijk gebeurt. Op de oude route ontstaat het account meteen, dus
 * "Account aanmaken" klopt. Op de nieuwe route gebeurt dat juist NIET — je gaat
 * naar een pagina waar je een machtiging afgeeft, en het account volgt daarna
 * per mail. Zou daar "Account aanmaken" staan, dan belooft de knop iets wat
 * pas twee stappen later waar is.
 */
export const verzendknopLabel = ACTIEVE_SIGNUP_ROUTE === OUDE_SIGNUP_ROUTE
  ? 'Account aanmaken'
  : 'Doorgaan naar betaalgegevens';

/**
 * De zin onder de kop op /registreren.
 *
 * "Begin direct" is waar op de oude route en onwaar op de nieuwe: daar begin je
 * pas als je de machtiging hebt afgegeven en je wachtwoord hebt ingesteld.
 */
export const registratieIntro = ACTIEVE_SIGNUP_ROUTE === OUDE_SIGNUP_ROUTE
  ? 'Maak een account aan voor je rijschool en begin direct.'
  : 'Nog geen betaling — je geeft een machtiging af en start je gratis periode.';
