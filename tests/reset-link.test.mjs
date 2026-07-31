// Resetlink-classificatie (31 juli 2026)
// ============================================================================
// Aanleiding: /reset keek alléén naar de hash-vormen. createBrowserClient uit
// @supabase/ssr gebruikt STANDAARD PKCE, dat de link aflevert als
// `?code=<uuid>` in de query. Die vorm werd niet herkend, dus kreeg de
// gebruiker het e-mailformulier terwijl hij op een geldige link had geklikt.
//
// De lus die daaruit volgde, terug te zien in de auth-logs:
//   303 login (eerste klik slaagt) → 403 "One-time token not found" (tweede
//   klik op dezelfde eenmalige token) → 429 rate limit (opnieuw aanvragen).
//
// Getest wordt de beslissing, niet de render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyResetUrl, RESET_LINK_ONBRUIKBAAR } from '../lib/reset-link.ts';

const basis = { search: '', hash: '', hasSession: false };

test('PKCE: ?code= wordt herkend — dit was de bug', () => {
  assert.deepEqual(
    classifyResetUrl({ ...basis, search: '?code=24e7d514-de9a-4268-aba8-a7782017c8f1' }),
    { kind: 'exchange-code', code: '24e7d514-de9a-4268-aba8-a7782017c8f1' },
  );
});

test('een bestaande sessie wint van alles', () => {
  // Wie al is ingelogd heeft de link verzilverd. Opnieuw om een e-mailadres
  // vragen is dan onzin — precies wat er gebeurde na een herlaad van de pagina.
  for (const extra of [{}, { search: '?code=abc' }, { hash: '#error=access_denied' }]) {
    assert.deepEqual(
      classifyResetUrl({ ...basis, ...extra, hasSession: true }),
      { kind: 'set-password' },
    );
  }
});

test('implicit: #access_token + #refresh_token blijft werken', () => {
  assert.deepEqual(
    classifyResetUrl({ ...basis, hash: '#access_token=AAA&refresh_token=BBB&type=recovery' }),
    { kind: 'set-session', accessToken: 'AAA', refreshToken: 'BBB' },
  );
});

test('access_token zonder refresh_token is onbruikbaar', () => {
  assert.deepEqual(
    classifyResetUrl({ ...basis, hash: '#access_token=AAA&type=recovery' }),
    { kind: 'error' },
  );
});

test('#error= van Supabase wordt een foutmelding', () => {
  assert.deepEqual(
    classifyResetUrl({ ...basis, hash: '#error=access_denied&error_code=otp_expired' }),
    { kind: 'error' },
  );
});

test('zonder link gewoon het formulier', () => {
  assert.deepEqual(classifyResetUrl(basis), { kind: 'request' });
  assert.deepEqual(classifyResetUrl({ ...basis, search: '?utm_source=mail' }), { kind: 'request' });
});

test('PKCE gaat vóór een hash — een link draagt nooit beide, maar de volgorde ligt vast', () => {
  assert.deepEqual(
    classifyResetUrl({ ...basis, search: '?code=XYZ', hash: '#access_token=AAA&refresh_token=BBB' }),
    { kind: 'exchange-code', code: 'XYZ' },
  );
});

test('hash zonder leidende # wordt ook gelezen', () => {
  assert.deepEqual(
    classifyResetUrl({ ...basis, hash: 'access_token=AAA&refresh_token=BBB' }),
    { kind: 'set-session', accessToken: 'AAA', refreshToken: 'BBB' },
  );
});

test('lege of ontbrekende velden laten de functie niet omvallen', () => {
  assert.deepEqual(
    classifyResetUrl({ search: undefined, hash: undefined, hasSession: false }),
    { kind: 'request' },
  );
});

test('de foutmelding zegt "al gebruikt of verlopen", niet alleen "verlopen"', () => {
  // De meest voorkomende oorzaak is een tweede klik op een eenmalige link.
  // "Verlopen" stuurt iemand op het verkeerde been.
  assert.match(RESET_LINK_ONBRUIKBAAR, /al gebruikt/);
  assert.match(RESET_LINK_ONBRUIKBAAR, /nieuwe aan/);
});
