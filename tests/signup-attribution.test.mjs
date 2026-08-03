// signup-attribution — pint de server-side sanitizer en de mail-samenvatting
// vast: client-input is untrusted (whitelist, alleen strings, lengte-cap) en
// de Herkomst-regel in de admin-mail moet compact en voorspelbaar zijn.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { sanitizeSignupAttribution, summarizeAttribution } =
  await import('../lib/signup-attribution.ts');

test('whitelist: alleen bekende keys, alleen strings', () => {
  const result = sanitizeSignupAttribution({
    utm_source: 'google',
    utm_medium: 'cpc',
    landing_page: '/pro?utm_source=google',
    referrer: 'https://www.google.com/',
    evil_key: 'x',
    utm_campaign: 42, // geen string → weg
    captured_at: '2026-08-03T10:00:00Z',
  });
  assert.deepEqual(result, {
    utm_source: 'google',
    utm_medium: 'cpc',
    landing_page: '/pro?utm_source=google',
    referrer: 'https://www.google.com/',
    captured_at: '2026-08-03T10:00:00Z',
  });
});

test('lengte-cap op 300 tekens', () => {
  const result = sanitizeSignupAttribution({ referrer: 'x'.repeat(1000) });
  assert.equal(result.referrer.length, 300);
});

test('lege, ongeldige of niet-object input → null', () => {
  assert.equal(sanitizeSignupAttribution(null), null);
  assert.equal(sanitizeSignupAttribution(undefined), null);
  assert.equal(sanitizeSignupAttribution('string'), null);
  assert.equal(sanitizeSignupAttribution([1, 2]), null);
  assert.equal(sanitizeSignupAttribution({}), null);
  assert.equal(sanitizeSignupAttribution({ evil: 'x' }), null);
  assert.equal(sanitizeSignupAttribution({ utm_source: '   ' }), null);
});

test('samenvatting: utm-keten > referrer > direct', () => {
  assert.equal(
    summarizeAttribution({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'lp-vergelijk' }),
    'google / cpc / lp-vergelijk',
  );
  assert.equal(summarizeAttribution({ utm_source: 'google' }), 'google');
  assert.equal(summarizeAttribution({ referrer: 'https://www.bing.com/' }), 'https://www.bing.com/');
  assert.equal(summarizeAttribution({ landing_page: '/pro' }), 'direct / onbekend');
});
