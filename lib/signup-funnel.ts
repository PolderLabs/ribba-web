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
export const ACTIEVE_SIGNUP_ROUTE: string = OUDE_SIGNUP_ROUTE;

/**
 * Mag het formulier een actiecode aanbieden?
 *
 * Alleen wanneer de actieve route hem ook daadwerkelijk kan honoreren. Niet
 * los instelbaar — dat is het hele punt.
 */
export const promoBeschikbaar = ACTIEVE_SIGNUP_ROUTE === NIEUWE_SIGNUP_ROUTE;
