// Factuurprofiel-regels (voorbereiding Stripe Customer-sync).
// Bindend (Önder, 19 jul 2026): fail-closed — ontbrekende kritieke
// factuurgegevens blokkeren, nooit stil terugvallen op een default.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { invoiceNameFor, invoiceAddressFor, InvoiceProfileError } =
  await import('../lib/invoice-profile.ts');

function school(over = {}) {
  return {
    name: 'Rijschool Voorbeeld',
    legal_form: 'eenmanszaak',
    legal_name: null,
    address: 'Bergweg 120',
    postal_code: '3037EG',
    city: 'Rotterdam',
    country_code: 'NL',
    billing_address: null,
    billing_postal_code: null,
    billing_city: null,
    ...over,
  };
}

test('factuurnaam: eenmanszaak en vof → handelsnaam', () => {
  assert.equal(invoiceNameFor(school()), 'Rijschool Voorbeeld');
  assert.equal(invoiceNameFor(school({ legal_form: 'vof' })), 'Rijschool Voorbeeld');
});

test('factuurnaam: bv → statutaire naam, nooit de handelsnaam', () => {
  const bv = school({ legal_form: 'bv', legal_name: 'Voorbeeld Holding B.V.' });
  assert.equal(invoiceNameFor(bv), 'Voorbeeld Holding B.V.');
});

test('factuurnaam faalt hard bij bv zonder statutaire naam', () => {
  assert.throws(
    () => invoiceNameFor(school({ legal_form: 'bv', legal_name: null })),
    InvoiceProfileError,
  );
  assert.throws(
    () => invoiceNameFor(school({ legal_form: 'bv', legal_name: '   ' })),
    InvoiceProfileError,
  );
});

test('factuurnaam faalt hard bij onbekende of ontbrekende bedrijfsvorm', () => {
  // legal_form NULL kan een BV verhullen → handelsnaam zou een onjuiste
  // factuur opleveren. Eerst bedrijfsvorm vastleggen (bestaande scholen
  // van vóór de migratie: Sideways, testschool).
  assert.throws(() => invoiceNameFor(school({ legal_form: null })), InvoiceProfileError);
  assert.throws(() => invoiceNameFor(school({ legal_form: 'BV' })), InvoiceProfileError);
});

test('factuuradres: zonder billing_* het gewone adres, mét landcode', () => {
  assert.deepEqual(invoiceAddressFor(school()), {
    line1: 'Bergweg 120',
    postal_code: '3037EG',
    city: 'Rotterdam',
    country: 'NL',
  });
});

test('factuuradres: volledig billing_* wint van het gewone adres', () => {
  const bv = school({
    legal_form: 'bv',
    legal_name: 'Voorbeeld Holding B.V.',
    billing_address: 'Herengracht 1',
    billing_postal_code: '1015BA',
    billing_city: 'Amsterdam',
  });
  assert.deepEqual(invoiceAddressFor(bv), {
    line1: 'Herengracht 1',
    postal_code: '1015BA',
    city: 'Amsterdam',
    country: 'NL',
  });
});

test('factuuradres faalt hard bij een HALF ingevuld billing-adres', () => {
  // Alles-of-niets: nooit stil twee adressen mengen.
  assert.throws(
    () => invoiceAddressFor(school({ billing_address: 'Herengracht 1' })),
    InvoiceProfileError,
  );
  assert.throws(
    () => invoiceAddressFor(school({ billing_postal_code: '1015BA', billing_city: 'Amsterdam' })),
    InvoiceProfileError,
  );
});

test('factuuradres faalt hard zonder land of met onvolledig adres', () => {
  assert.throws(() => invoiceAddressFor(school({ country_code: null })), InvoiceProfileError);
  assert.throws(() => invoiceAddressFor(school({ country_code: '' })), InvoiceProfileError);
  assert.throws(() => invoiceAddressFor(school({ city: null })), InvoiceProfileError);
});

test('landcode wordt genormaliseerd naar uppercase in het resultaat', () => {
  assert.equal(invoiceAddressFor(school({ country_code: 'nl' })).country, 'NL');
});
