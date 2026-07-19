// Factuurprofiel-regels: welke naam en welk adres komen op een factuur
// (straks: op de Stripe Customer).
//
// ⚠️ VOLGEND EXEMPLAAR (besluit B2, ribbaPro
// docs/design/2026-07-19_customer-sync-contract.md). Het LEIDENDE exemplaar
// is ribbaPro supabase/functions/_shared/invoice-profile.ts — wijzig eerst
// dáár, en neem implementatie + tests/invoice-profile.fixtures.json in
// dezelfde werkstroom hierheen over (incl. de fixture-checksum in
// tests/invoice-profile-contract.test.mjs).
//
// De regel is vastgelegd bij de drivingschools-migratie (ribbaPro,
// 20260719140000_drivingschools_invoice_profile):
//
//   factuurnaam  = bv → legal_name, anders → name (handelsnaam)
//   factuuradres = billing_* indien gevuld, anders address/postal_code/city
//   land         = country_code
//
// Fail-closed, zelfde filosofie als UnknownPlanError in plan-pricing: bij
// ontbrekende kritieke gegevens gooien we, nooit stil terugvallen. Een school
// met legal_form NULL (bestaansrecht vóór de migratie) moet dus eerst haar
// bedrijfsvorm vastleggen voordat er een factuurprofiel bestaat — precies de
// blokkeerregel die Önder voor de Stripe-activatie heeft gekozen.

// Via het @/-alias, niet relatief: de node-testrunner lost alleen @/-paden
// op naar .ts (zie tests/_alias-loader.mjs).
import { isLegalForm, requiresLegalName, type LegalForm } from '@/lib/country-profile';

export class InvoiceProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceProfileError';
  }
}

export type InvoiceProfileInput = {
  name: string | null;
  legal_form: string | null;
  legal_name: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country_code: string | null;
  billing_address: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
};

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * De naam die op de factuur hoort.
 * - eenmanszaak / vof → handelsnaam (name)
 * - bv               → statutaire naam (legal_name)
 * - legal_form NULL  → FOUT: kan een BV zijn, dan zou de handelsnaam een
 *                      onjuiste factuur opleveren. Eerst bedrijfsvorm
 *                      vastleggen.
 */
export function invoiceNameFor(school: InvoiceProfileInput): string {
  const form = school.legal_form;
  if (!isLegalForm(form)) {
    throw new InvoiceProfileError(
      'Bedrijfsvorm ontbreekt of is onbekend — factuurnaam kan niet worden bepaald.',
    );
  }
  if (requiresLegalName(form as LegalForm)) {
    if (!nonEmpty(school.legal_name)) {
      // De DB-constraint maakt dit onmogelijk; dit vangnet houdt de regel
      // ook overeind voor data die buiten de DB om wordt aangeleverd.
      throw new InvoiceProfileError('BV zonder statutaire naam — factuurnaam kan niet worden bepaald.');
    }
    return school.legal_name.trim();
  }
  if (!nonEmpty(school.name)) {
    throw new InvoiceProfileError('Handelsnaam ontbreekt — factuurnaam kan niet worden bepaald.');
  }
  return school.name.trim();
}

export type InvoiceAddress = {
  line1: string;
  postal_code: string;
  city: string;
  country: string;
};

/**
 * Het adres dat op de factuur hoort. billing_* is alles-of-niets: een half
 * ingevuld afwijkend adres is een datafout en levert een harde fout op,
 * geen stil mengsel van twee adressen.
 */
export function invoiceAddressFor(school: InvoiceProfileInput): InvoiceAddress {
  if (!nonEmpty(school.country_code)) {
    throw new InvoiceProfileError('Land ontbreekt — factuuradres kan niet worden bepaald.');
  }

  const billingParts = [school.billing_address, school.billing_postal_code, school.billing_city];
  const filled = billingParts.filter(nonEmpty).length;

  if (filled > 0 && filled < billingParts.length) {
    throw new InvoiceProfileError(
      'Afwijkend factuuradres is onvolledig — vul adres, postcode én plaats in, of geen van drie.',
    );
  }

  const useBilling = filled === billingParts.length;
  const line1 = useBilling ? school.billing_address : school.address;
  const postal = useBilling ? school.billing_postal_code : school.postal_code;
  const city = useBilling ? school.billing_city : school.city;

  if (!nonEmpty(line1) || !nonEmpty(postal) || !nonEmpty(city)) {
    throw new InvoiceProfileError('Adres is onvolledig — factuuradres kan niet worden bepaald.');
  }

  return {
    line1: line1.trim(),
    postal_code: postal.trim(),
    city: city.trim(),
    country: school.country_code.trim().toUpperCase(),
  };
}
