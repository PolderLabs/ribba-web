/**
 * reset-link — welke vorm heeft de resetlink, en wat moet de pagina doen?
 *
 * Waarom dit bestaat (31 juli 2026): `/reset` keek uitsluitend naar de
 * hash-vormen (`#access_token`, `#error=`). Maar `createBrowserClient` uit
 * `@supabase/ssr` gebruikt STANDAARD de PKCE-flow, en die levert de link af
 * als `?code=<uuid>` in de query. Die vorm viel door naar het
 * e-mailformulier.
 *
 * Herzien op 20 augustus 2026, na een tweede incident. De fix van juli loste
 * dat op met één regel: "is er een sessie, dan is de link kennelijk al
 * verzilverd". Die aanname is te ruim. Elke sessie in de browser — ook een
 * gewone inlogsessie van een héél ander account — kaapte daarmee de
 * resetpagina:
 *
 *   1. mislukte support-login laat een aal1-sessie van account A achter;
 *   2. gebruiker probeert als rijschool (account B) in te loggen, mislukt;
 *   3. klikt "wachtwoord vergeten" → pagina toont meteen het
 *      wachtwoordscherm, zonder mail, want er ís een sessie;
 *   4. "Wachtwoord wijzigen" roept dan `updateUser` aan op de sessie van A,
 *      niet die van B.
 *
 * In het echte geval liep stap 4 vast op een 401 ("AAL2 session is required"),
 * omdat A toevallig tweefactor had. Dat was geluk, geen ontwerp: zonder die
 * factor kreeg je het wachtwoordveld voor de verkeerde bestaande sessie te
 * zien, en werd `updateUser` op dát account aangeroepen. Of de server die
 * wijziging ook had geaccepteerd hangt af van de reauthenticatie-instelling
 * in Supabase Auth en is niet nagegaan — het aanbieden van dat scherm is op
 * zichzelf al fout.
 *
 * Het onderscheid dat we nodig hebben is niet "is er een sessie" maar "komt
 * deze sessie uit de link waarmee deze pagina is geopend". Daarvoor legt de
 * pagina de URL synchroon vast vóór de eerste `await` (zie `metLink`) —
 * race-vrij, want de client van @supabase/ssr wisselt de code soms al in
 * voordat onze code draait, en `detectSessionInUrl` is in 0.9.0 niet uit te
 * zetten.
 *
 * Deze module is puur: geen Supabase, geen DOM. Daardoor is de beslissing
 * testbaar zonder browser — en dat is precies de laag waarin beide fouten
 * zaten.
 */

export type ResetAction =
  /** De sessie komt aantoonbaar uit deze herstellink: wachtwoordveld tonen. */
  | { kind: 'set-password' }
  /** PKCE: wissel deze code in voor een sessie. */
  | { kind: 'exchange-code'; code: string }
  /** Implicit (oudere links): zet de sessie met deze tokens. */
  | { kind: 'set-session'; accessToken: string; refreshToken: string }
  /** Supabase gaf een fout terug, of de link is onbruikbaar. */
  | { kind: 'error' }
  /** Gewoon de pagina bezoeken zonder link. */
  | { kind: 'request' };

export type ResetUrlInput = {
  /** `window.location.search` op het moment van beslissen, bijv. `?code=abc`. */
  search: string;
  /** `window.location.hash` op het moment van beslissen. */
  hash: string;
  /**
   * Droeg de URL waarmee deze pagina werd geopend een herstellink?
   * Synchroon vastgelegd vóór enige `await`, want de Supabase-client wist de
   * `?code=` uit de balk zodra hij hem met succes heeft ingewisseld.
   */
  metLink: boolean;
  /** Heeft de client nu een sessie? */
  hasSession: boolean;
  /**
   * Is de sessie die nu in de client zit aantoonbaar uit een herstellink
   * ontstaan? Gelezen uit de `amr`-claim, niet afgeleid uit de URL.
   */
  herstelSessie: boolean;
  /**
   * Is de sessie die nu in de client zit dezelfde sessie die in deze tab uit
   * een herstellink is ontstaan? Alleen dan overleeft het wachtwoordscherm
   * een herlaad.
   */
  herstelInGang: boolean;
};

/**
 * Sleutel in sessionStorage; de waarde is de `session_id` van de herstelsessie.
 *
 * Bewust niet de user-id. Die eerste opzet (20 aug 2026) had een gat: wie een
 * herstel begon maar afbrak, hield de vlag in de tab. Logde diezelfde persoon
 * later gewoon opnieuw in en opende hij `/reset` zonder link, dan matchte de
 * vlag alsnog en verscheen het wachtwoordscherm — de oude fout terug, nu
 * gebonden aan "deze gebruiker heeft hier ooit herstel gestart". sessionStorage
 * leeft namelijk door tot de tab sluit, en een gewone login wist hem niet.
 *
 * `session_id` sluit dat af: een nieuwe login maakt een nieuwe auth-sessie en
 * dus een andere id, terwijl een herlaad of tokenvernieuwing dezelfde houdt.
 * Een blijven hangende vlag matcht daarna nooit meer, en het ergste wat een
 * mismatch oplevert is het e-mailformulier — fail-closed.
 */
export const HERSTEL_VLAG = 'ribba:herstel-sessie';

type Claims = { session_id?: unknown; amr?: unknown };

/**
 * Leest de payload van een Supabase-token.
 *
 * Geen handtekeningcontrole, en die hoort hier ook niet: dit is een token dat
 * de client zelf net heeft opgehaald, en de uitkomst stuurt alleen welk scherm
 * we tonen. Elke echte grens ligt server-side — GoTrue weigert `updateUser`
 * zonder geldige sessie en zonder aal2, wat wij hier ook beslissen.
 */
function leesClaims(accessToken: string | null | undefined): Claims | null {
  const payload = (accessToken ?? '').split('.')[1];
  if (!payload) return null;
  try {
    // base64url → base64, inclusief de padding die JWT's weglaten.
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const opgevuld = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    // atob levert een byte-string; niet-ASCII in andere claims raakt daarmee
    // vervormd, maar de JSON-structuur, een uuid en een methodenaam blijven
    // intact — en meer lezen we hier niet.
    return JSON.parse(atob(opgevuld)) as Claims;
  } catch {
    return null;
  }
}

/**
 * Leest de `session_id`-claim: de identiteit van de auth-sessie zelf.
 *
 * Verplichte claim in elk Supabase-token (zie @supabase/auth-js,
 * lib/types.d.ts: "Required claims (iss, aud, exp, iat, sub, role, aal,
 * session_id)").
 */
export function leesSessieId(accessToken: string | null | undefined): string | null {
  const sid = leesClaims(accessToken)?.session_id;
  return typeof sid === 'string' ? sid : null;
}

/**
 * De enige methode die "deze sessie komt uit een wachtwoordherstel" betekent.
 *
 * Geverifieerd in productie (`auth.mfa_amr_claims`): de herstelsessie van
 * 20 aug 2026 draagt `recovery`, gewone logins dragen `password`, en een
 * tweefactorstap voegt `totp` toe aan diezelfde sessie. De typedefinitie van
 * @supabase/auth-js noemt `recovery` niet in haar stringlijst, maar `AMRMethod`
 * is expliciet open (`| (string & {})`), dus die lijst is niet uitputtend.
 *
 * Bewust géén `magiclink` of `otp` erbij, hoe verwant ze ook lijken. Supabase
 * onderscheidt ze expliciet: dat zijn gewone passwordless *aanmeldmethoden*,
 * geen herstel. Een sessie die zo is ontstaan kan al in de browser staan en
 * blijft bestaan wanneer de herstelcallback van een ánder account mislukt —
 * precies het geval dat deze controle moet uitsluiten. "Lijkt op e-mail" is
 * geen bewijs van herstel.
 */
const HERSTELMETHODE = 'recovery';

/**
 * Kwam deze sessie uit een herstellink?
 *
 * Leest de `amr`-claim — de authenticatiemethoden waarmee déze sessie is
 * opgebouwd. Dat is het enige positieve bewijs dat de client heeft: alle
 * andere signalen (stond er een link in de URL, is er een sessie) zijn
 * omstandigheden, geen bewijs.
 *
 * Onleesbaar, ontbrekend of onbekend → `false`, en de pagina valt terug op het
 * e-mailformulier. Een verkeerde uitkomst kost hooguit een nieuwe resetmail;
 * de omgekeerde fout kost een wachtwoordscherm voor het verkeerde account.
 */
export function isHerstelSessie(accessToken: string | null | undefined): boolean {
  const amr = leesClaims(accessToken)?.amr;
  if (!Array.isArray(amr)) return false;
  // De claim komt in twee vormen voor: objecten met `method`, of kale strings.
  return amr.some((entry) => {
    const methode =
      typeof entry === 'string'
        ? entry
        : (entry as { method?: unknown } | null)?.method;
    return methode === HERSTELMETHODE;
  });
}

/**
 * Draagt deze URL een herstellink? Bedoeld voor de momentopname die de pagina
 * maakt vóór de eerste `await`.
 */
export function heeftHerstelLink(search: string, hash: string): boolean {
  const query = new URLSearchParams(search || '');
  const h = hash || '';
  return (
    query.has('code') ||
    query.has('error') ||
    h.includes('access_token') ||
    h.includes('error=')
  );
}

/**
 * Is de sessie die nu in de client zit dezelfde als die waarvoor de vlag is
 * gezet?
 *
 * Vergelijkt `session_id`, niet de gebruiker: dezelfde persoon die opnieuw
 * inlogt krijgt een andere auth-sessie, en mag het wachtwoordscherm dus niet
 * erven van een herstel dat hij eerder in deze tab heeft afgebroken.
 */
export function herstelHoortBij(
  vlag: string | null,
  huidigeSessieId: string | null,
): boolean {
  return Boolean(vlag && huidigeSessieId && vlag === huidigeSessieId);
}

/**
 * Bepaalt wat de resetpagina moet doen.
 *
 * Volgorde is bewust:
 *   1. PKCE (`?code=`) — de huidige vorm, en hij staat er alleen nog als de
 *      client hem niet zelf heeft ingewisseld;
 *   2. implicit (`#access_token=`) — oudere links, blijft ondersteund, maar
 *      alleen mét `type=recovery`;
 *   3. een expliciete fout van Supabase — `?error=` bij PKCE, `#error=` bij de
 *      oudere vorm;
 *   4. binnengekomen mét link, en de sessie die er nu is komt aantoonbaar uit
 *      een herstellink: de client was ons voor met het inwisselen;
 *   5. binnengekomen mét link, maar zonder zo'n sessie: de link heeft niets
 *      opgeleverd;
 *   6. deze tab was al bezig met herstellen (herlaad van het wachtwoordscherm);
 *   7. anders: het e-mailformulier — óók als er een sessie is. Een sessie is
 *      geen bewijs dat iemand een herstellink had.
 */
export function classifyResetUrl(input: ResetUrlInput): ResetAction {
  const query = new URLSearchParams(input.search || '');

  const code = query.get('code');
  if (code) return { kind: 'exchange-code', code };

  const hash = input.hash || '';
  if (hash.includes('access_token')) {
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    // De oude implicit-vorm draagt kant-en-klare tokens in de hash. Zonder
    // verdere eis zou élk tokenpaar hier het wachtwoordscherm openen — ook dat
    // van een gewone inlog, een magic link of een net bevestigde inschrijving.
    // Dat verdraagt zich niet met de regel die de rest van deze module
    // handhaaft: alleen bewezen herstel mag door.
    //
    // Het bewijs zit hier niet in de `amr`-claim maar in `type=recovery` uit
    // de redirect. GoTrue geeft implicit-sessies namelijk uit met `otp` als
    // methode, óók bij herstel — een centrale amr-controle zou deze legacy
    // links dus juist blokkeren. Supabase' eigen client leest de herkomst op
    // dezelfde plek: `_getSessionFromURL` geeft `redirectType: params.type`
    // terug en stuurt daarop het PASSWORD_RECOVERY-event.
    if (params.get('type') !== 'recovery') return { kind: 'error' };

    if (accessToken && refreshToken) {
      return { kind: 'set-session', accessToken, refreshToken };
    }
    // access_token zonder refresh_token is onbruikbaar: setSession faalt dan
    // sowieso. Meteen als fout behandelen scheelt een mislukte netwerkronde.
    return { kind: 'error' };
  }

  // Supabase levert de fout bij PKCE in de query, niet in de hash. Op 20 aug
  // 2026 in het serverlog gezien als
  // `/reset?error=access_denied&error_code=otp_expired&…`. Wie die vorm niet
  // herkent, geeft iemand met een verlopen link stil het gewone formulier.
  if (query.has('error') || hash.includes('error=')) return { kind: 'error' };

  if (input.metLink) {
    // De client van @supabase/ssr heeft de code al ingewisseld en uit de balk
    // gewist — anders had hij er nog gestaan en waren we hierboven afgeslagen.
    //
    // "Er was een link én er is een sessie" is daarvoor géén bewijs. Was
    // account A al ingelogd en mislukt de callback voor B, dan blijft A's
    // sessie bestaan; die combinatie mag nooit het wachtwoordscherm van A
    // openen. Daarom telt alleen wat de sessie zelf zegt: draagt haar
    // `amr`-claim een herstelmethode? Zo niet, dan is dit geen herstel.
    return input.hasSession && input.herstelSessie
      ? { kind: 'set-password' }
      : { kind: 'error' };
  }

  if (input.herstelInGang) return { kind: 'set-password' };

  return { kind: 'request' };
}

/**
 * Eén melding voor alle onbruikbare links.
 *
 * Bewust niet "verlopen": de meest voorkomende oorzaak is dat de link al is
 * gebruikt — een resetlink is eenmalig, en tot deze fix klikten mensen er
 * juist een tweede keer op omdat de eerste keer niets leek te doen. "Verlopen"
 * stuurt iemand op het verkeerde been.
 */
export const RESET_LINK_ONBRUIKBAAR =
  'Deze resetlink is al gebruikt of verlopen. Vraag hieronder een nieuwe aan.';
