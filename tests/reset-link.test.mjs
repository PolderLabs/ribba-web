// Resetlink-classificatie
// ============================================================================
// 31 juli 2026 — /reset keek alléén naar de hash-vormen. createBrowserClient
// uit @supabase/ssr gebruikt STANDAARD PKCE, dat de link aflevert als
// `?code=<uuid>` in de query. Die vorm werd niet herkend, dus kreeg de
// gebruiker het e-mailformulier terwijl hij op een geldige link had geklikt.
//
// 20 augustus 2026 — de fix daarvan was te ruim: "is er een sessie, dan is de
// link al verzilverd". Een achtergebleven inlogsessie van een ánder account
// kaapte daarmee de pagina: /reset bood het wachtwoordveld voor dát account
// aan en riep `updateUser` op die sessie aan. Alleen een toevallige tweefactor
// hield het tegen (401 AAL2); of de server de wijziging anders had aanvaard is
// niet nagegaan en doet er niet toe — het scherm hoorde er niet te staan.
//
// Diezelfde dag, bij review: de vlag die een herlaad moest overleven hing eerst
// aan de user-id. Daarmee kon een afgebroken herstel later opnieuw een
// wachtwoordscherm openen vanuit een gewone login van dezelfde persoon. De
// vlag draagt nu de session_id.
//
// Getest wordt de beslissing, niet de render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyResetUrl,
  heeftHerstelLink,
  herstelHoortBij,
  isHerstelSessie,
  leesSessieId,
  RESET_LINK_ONBRUIKBAAR,
} from '../lib/reset-link.ts';

const basis = {
  search: '',
  hash: '',
  metLink: false,
  hasSession: false,
  herstelSessie: false,
  herstelInGang: false,
};

/** Bouwt een token met deze claims — alleen de payload doet ertoe. */
function token(claims) {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `header.${payload}.handtekening`;
}

test('PKCE: ?code= wordt herkend — dit was de bug van 31 juli', () => {
  assert.deepEqual(
    classifyResetUrl({
      ...basis,
      search: '?code=24e7d514-de9a-4268-aba8-a7782017c8f1',
      metLink: true,
    }),
    { kind: 'exchange-code', code: '24e7d514-de9a-4268-aba8-a7782017c8f1' },
  );
});

test('een sessie zónder link geeft het e-mailformulier — dit was de bug van 20 augustus', () => {
  // De kern van het incident: iemand was nog ingelogd (of had een halve
  // sessie van een mislukte support-login) en klikte "wachtwoord vergeten".
  // Toen kreeg hij meteen het wachtwoordscherm, zonder mail, voor het
  // verkeerde account. Nu niet meer.
  assert.deepEqual(
    classifyResetUrl({ ...basis, hasSession: true }),
    { kind: 'request' },
  );
});

test('mét link en een herstelsessie: de client heeft de code zelf al ingewisseld', () => {
  // detectSessionInUrl staat in @supabase/ssr 0.9.0 vast aan, dus de client
  // is ons vaak voor en wist de ?code= uit de balk. Alleen de amr-claim van de
  // sessie bewijst dan dat zij uit die link komt.
  assert.deepEqual(
    classifyResetUrl({ ...basis, metLink: true, hasSession: true, herstelSessie: true }),
    { kind: 'set-password' },
  );
});

test('mét link zonder sessie is een onbruikbare link, geen wachtwoordscherm', () => {
  // Bv. de link geopend in een andere browser dan waar hij is aangevraagd:
  // geen code_verifier, dus geen sessie. Een oude sessie mag dit gat niet
  // vullen.
  assert.deepEqual(
    classifyResetUrl({ ...basis, metLink: true, hasSession: false }),
    { kind: 'error' },
  );
});

test('sessie A + herstellink van B die niet verzilverd raakt → nooit het scherm van A', () => {
  // De review van 20 aug 2026: "er was een link én er is een sessie" is geen
  // bewijs. Blijft A's gewone inlogsessie staan omdat de callback voor B
  // faalde, dan draagt die sessie geen herstelmethode in haar amr — en dan
  // hoort hier geen wachtwoordscherm te komen, voor niemand.
  const sessieVanA = token({ sub: 'A', session_id: 'sessie-A', amr: [{ method: 'password' }] });

  assert.equal(isHerstelSessie(sessieVanA), false);
  assert.deepEqual(
    classifyResetUrl({
      ...basis,
      metLink: true,
      hasSession: true,
      herstelSessie: isHerstelSessie(sessieVanA),
    }),
    { kind: 'error' },
  );
});

test('herladen van het wachtwoordscherm blijft werken', () => {
  // De URL is dan schoongeveegd; de vlag in sessionStorage draagt het herstel.
  assert.deepEqual(
    classifyResetUrl({ ...basis, hasSession: true, herstelInGang: true }),
    { kind: 'set-password' },
  );
});

test('implicit: #access_token + #refresh_token blijft werken', () => {
  assert.deepEqual(
    classifyResetUrl({
      ...basis,
      hash: '#access_token=AAA&refresh_token=BBB&type=recovery',
      metLink: true,
    }),
    { kind: 'set-session', accessToken: 'AAA', refreshToken: 'BBB' },
  );
});

test('access_token zonder refresh_token is onbruikbaar', () => {
  assert.deepEqual(
    classifyResetUrl({ ...basis, hash: '#access_token=AAA&type=recovery', metLink: true }),
    { kind: 'error' },
  );
});

// De implicit-vorm draagt kant-en-klare tokens in de hash. Zonder eis aan het
// type zou élk tokenpaar het wachtwoordscherm openen — ook dat van een gewone
// inlog of een magic link. Het bewijs zit hier in `type=recovery`, niet in de
// amr: GoTrue geeft implicit-sessies uit met `otp` als methode, ook bij
// herstel, dus een amr-controle zou juist deze legacy links blokkeren.
test('implicit zonder type= wordt geweigerd, hoe compleet de tokens ook zijn', () => {
  assert.deepEqual(
    classifyResetUrl({ ...basis, hash: '#access_token=AAA&refresh_token=BBB', metLink: true }),
    { kind: 'error' },
  );
});

test('implicit met een ánder type dan recovery komt er niet door', () => {
  for (const type of ['magiclink', 'signup', 'invite', 'email_change']) {
    assert.deepEqual(
      classifyResetUrl({
        ...basis,
        hash: `#access_token=AAA&refresh_token=BBB&type=${type}`,
        metLink: true,
      }),
      { kind: 'error' },
      `type=${type} hoort geen wachtwoordscherm te openen`,
    );
  }
});

test('?error= van Supabase wordt óók een foutmelding — PKCE levert hem in de query', () => {
  // Op 20 aug 2026 in het serverlog gezien; tot dan viel deze vorm door naar
  // het kale e-mailformulier, zonder uitleg waarom de link niet werkte.
  assert.deepEqual(
    classifyResetUrl({
      ...basis,
      search: '?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      metLink: true,
    }),
    { kind: 'error' },
  );
  assert.equal(heeftHerstelLink('?error=access_denied&error_code=otp_expired', ''), true);
});

test('#error= van Supabase wordt een foutmelding', () => {
  assert.deepEqual(
    classifyResetUrl({
      ...basis,
      hash: '#error=access_denied&error_code=otp_expired',
      metLink: true,
    }),
    { kind: 'error' },
  );
});

test('zonder link gewoon het formulier', () => {
  assert.deepEqual(classifyResetUrl(basis), { kind: 'request' });
  assert.deepEqual(classifyResetUrl({ ...basis, search: '?utm_source=mail' }), { kind: 'request' });
});

test('PKCE gaat vóór een hash — een link draagt nooit beide, maar de volgorde ligt vast', () => {
  assert.deepEqual(
    classifyResetUrl({
      ...basis,
      search: '?code=XYZ',
      hash: '#access_token=AAA&refresh_token=BBB',
      metLink: true,
    }),
    { kind: 'exchange-code', code: 'XYZ' },
  );
});

test('hash zonder leidende # wordt ook gelezen', () => {
  assert.deepEqual(
    classifyResetUrl({
      ...basis,
      hash: 'access_token=AAA&refresh_token=BBB&type=recovery',
      metLink: true,
    }),
    { kind: 'set-session', accessToken: 'AAA', refreshToken: 'BBB' },
  );
});

test('lege of ontbrekende velden laten de functie niet omvallen', () => {
  assert.deepEqual(
    classifyResetUrl({ search: undefined, hash: undefined }),
    { kind: 'request' },
  );
});

test('heeftHerstelLink herkent alle drie de vormen, en verder niets', () => {
  assert.equal(heeftHerstelLink('?code=abc', ''), true);
  assert.equal(heeftHerstelLink('', '#access_token=AAA&refresh_token=BBB'), true);
  assert.equal(heeftHerstelLink('', '#error=access_denied'), true);

  assert.equal(heeftHerstelLink('', ''), false);
  assert.equal(heeftHerstelLink('?utm_source=mail', ''), false);
  assert.equal(heeftHerstelLink('?returnTo=/upgrade', '#section'), false);
});

test('leesSessieId haalt de session_id uit een token, of niets', () => {
  assert.equal(
    leesSessieId(token({ sub: 'user-a', session_id: 'sessie-1', aal: 'aal1' })),
    'sessie-1',
  );
  // Claims met niet-ASCII mogen het uitlezen niet breken.
  assert.equal(
    leesSessieId(token({ email: 'jan@rijschool-müller.nl', session_id: 'sessie-2' })),
    'sessie-2',
  );

  assert.equal(leesSessieId(token({ sub: 'user-a' })), null, 'claim ontbreekt');
  assert.equal(leesSessieId('geen.jwt'), null);
  assert.equal(leesSessieId('losse-tekst'), null);
  assert.equal(leesSessieId(''), null);
  assert.equal(leesSessieId(null), null);
  assert.equal(leesSessieId(undefined), null);
});

test('isHerstelSessie accepteert alléén recovery', () => {
  // De methodenamen zoals GoTrue ze in productie wegschrijft; geverifieerd in
  // auth.mfa_amr_claims op 20 aug 2026.
  assert.equal(isHerstelSessie(token({ amr: [{ method: 'recovery' }] })), true);
  // Na de tweefactorstap komt totp erbij op dezelfde sessie.
  assert.equal(
    isHerstelSessie(token({ amr: [{ method: 'recovery' }, { method: 'totp' }] })),
    true,
  );
  // De claim mag ook een kale stringlijst zijn (types.d.ts: AMREntry[] | string[]).
  assert.equal(isHerstelSessie(token({ amr: ['recovery'] })), true);

  // Een gewone inlogsessie is geen herstel — ook niet mét tweefactor.
  assert.equal(isHerstelSessie(token({ amr: [{ method: 'password' }] })), false);
  assert.equal(
    isHerstelSessie(token({ amr: [{ method: 'password' }, { method: 'totp' }] })),
    false,
  );

  // En passwordless aanmelden is óók geen herstel. Supabase onderscheidt deze
  // methoden expliciet; ze horen bij inloggen, niet bij accountherstel. Zo'n
  // sessie kan al in de browser staan en een mislukte herstelcallback van een
  // ander account overleven — dat is precies wat we hier uitsluiten.
  assert.equal(isHerstelSessie(token({ amr: [{ method: 'magiclink' }] })), false);
  assert.equal(isHerstelSessie(token({ amr: [{ method: 'otp' }] })), false);
  assert.equal(isHerstelSessie(token({ amr: ['magiclink'] })), false);

  // Alles wat we niet kunnen lezen valt dicht.
  assert.equal(isHerstelSessie(token({ amr: [] })), false);
  assert.equal(isHerstelSessie(token({ amr: 'recovery' })), false, 'geen lijst');
  assert.equal(isHerstelSessie(token({ amr: [null] })), false);
  assert.equal(isHerstelSessie(token({ sub: 'A' })), false, 'claim ontbreekt');
  assert.equal(isHerstelSessie('kapot'), false);
  assert.equal(isHerstelSessie(null), false);
  assert.equal(isHerstelSessie(undefined), false);
});

test('magiclink-sessie A + herstellink van B die niet verzilverd raakt → nooit het scherm van A', () => {
  // Dezelfde val als met een wachtwoordsessie, maar subtieler: A is via een
  // magic link binnengekomen. Dat is een aanmeldmethode, geen herstel, dus die
  // sessie mag na een mislukte callback voor B geen wachtwoordscherm openen.
  const sessieVanA = token({ sub: 'A', session_id: 'sessie-A', amr: [{ method: 'magiclink' }] });

  assert.equal(isHerstelSessie(sessieVanA), false);
  assert.deepEqual(
    classifyResetUrl({
      ...basis,
      metLink: true,
      hasSession: true,
      herstelSessie: isHerstelSessie(sessieVanA),
    }),
    { kind: 'error' },
  );
});

// De drie scenario's uit de review van 20 aug 2026. De vlag hing eerst aan de
// user-id; daardoor erfde een latere gewone login van dezelfde persoon het
// wachtwoordscherm van een herstel dat allang was afgebroken.
const SESSIE_HERSTEL_A = 'a1111111-0000-0000-0000-000000000001';
const SESSIE_NIEUW_A = 'a1111111-0000-0000-0000-000000000002';
const SESSIE_B = 'b2222222-0000-0000-0000-000000000001';

test('herstel A → herlaad met dezelfde herstelsessie → wachtwoordscherm', () => {
  const vlag = SESSIE_HERSTEL_A;
  const huidig = leesSessieId(token({ sub: 'A', session_id: SESSIE_HERSTEL_A }));

  assert.equal(herstelHoortBij(vlag, huidig), true);
  assert.deepEqual(
    classifyResetUrl({ ...basis, hasSession: true, herstelInGang: herstelHoortBij(vlag, huidig) }),
    { kind: 'set-password' },
  );
});

test('herstel A afgebroken → nieuwe gewone sessie van diezelfde A → e-mailformulier', () => {
  // Dit was de regressie: opnieuw inloggen maakt een nieuwe auth-sessie, dus
  // een andere session_id. De achtergebleven vlag mag niet meer matchen.
  const vlag = SESSIE_HERSTEL_A;
  const huidig = leesSessieId(token({ sub: 'A', session_id: SESSIE_NIEUW_A }));

  assert.equal(herstelHoortBij(vlag, huidig), false);
  assert.deepEqual(
    classifyResetUrl({ ...basis, hasSession: true, herstelInGang: herstelHoortBij(vlag, huidig) }),
    { kind: 'request' },
  );
});

test('herstel A → sessie van B in dezelfde tab → e-mailformulier', () => {
  const vlag = SESSIE_HERSTEL_A;
  const huidig = leesSessieId(token({ sub: 'B', session_id: SESSIE_B }));

  assert.equal(herstelHoortBij(vlag, huidig), false);
  assert.deepEqual(
    classifyResetUrl({ ...basis, hasSession: true, herstelInGang: herstelHoortBij(vlag, huidig) }),
    { kind: 'request' },
  );
});

test('zonder vlag of zonder sessie matcht er niets', () => {
  assert.equal(herstelHoortBij(null, SESSIE_HERSTEL_A), false);
  assert.equal(herstelHoortBij(SESSIE_HERSTEL_A, null), false);
  assert.equal(herstelHoortBij(null, null), false);
  // Een onleesbaar token levert null op en mag dus nooit per ongeluk matchen.
  assert.equal(herstelHoortBij(SESSIE_HERSTEL_A, leesSessieId('kapot')), false);
});

test('de foutmelding zegt "al gebruikt of verlopen", niet alleen "verlopen"', () => {
  // De meest voorkomende oorzaak is een tweede klik op een eenmalige link.
  // "Verlopen" stuurt iemand op het verkeerde been.
  assert.match(RESET_LINK_ONBRUIKBAAR, /al gebruikt/);
  assert.match(RESET_LINK_ONBRUIKBAAR, /nieuwe aan/);
});
