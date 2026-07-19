// Landprofielen voor de rijschoolregistratie.
//
// Eén profiel per ondersteund land stuurt labels, placeholders en validatie
// van het registratieformulier én van /api/register-school. Een nieuw land
// toevoegen = één profiel + de code in ENABLED_COUNTRY_CODES zetten; geen
// refactor van formulier of API.
//
// BE staat hier al volledig uitgewerkt maar is bewust NIET enabled: de picker
// toont hem niet en de server weigert hem. Aanzetten is een besluit (o.a.
// btw-verlegging en OSS-administratie), geen codewijziging.
//
// Pure module: geen React, geen I/O — importeerbaar door client, server én
// de node-tests.

export type LegalForm = 'eenmanszaak' | 'vof' | 'bv';

export const LEGAL_FORMS: ReadonlyArray<{ value: LegalForm; label: string }> = [
  { value: 'eenmanszaak', label: 'Eenmanszaak' },
  { value: 'vof', label: 'VOF' },
  { value: 'bv', label: 'BV' },
];

export function isLegalForm(v: unknown): v is LegalForm {
  return v === 'eenmanszaak' || v === 'vof' || v === 'bv';
}

/** Alleen een BV factureert op statutaire naam; die is dan verplicht. */
export function requiresLegalName(form: LegalForm): boolean {
  return form === 'bv';
}

export type CountryProfile = {
  code: string;
  /** Weergavenaam in de picker. */
  label: string;
  postcode: {
    /** Toegepast op de GENORMALISEERDE waarde (zie normalizePostcode). */
    pattern: RegExp;
    placeholder: string;
    errorHint: string;
  };
  /** Handelsregister: KvK (NL), KBO (BE), … — label verschilt per land. */
  businessRegister: {
    label: string;
    pattern: RegExp;
    placeholder: string;
    errorHint: string;
  };
  vat: {
    /** Toegepast op de genormaliseerde waarde (uppercase, zonder spaties). */
    pattern: RegExp;
    placeholder: string;
  };
  phone: {
    /** Toegepast op de waarde ontdaan van alles behalve cijfers en '+'. */
    pattern: RegExp;
    placeholder: string;
    errorHint: string;
  };
};

export const COUNTRY_PROFILES: Record<string, CountryProfile> = {
  NL: {
    code: 'NL',
    label: 'Nederland',
    postcode: {
      // Zelfde semantiek als de bestaande isValidPostalCode: 4 cijfers + 2
      // letters; spatie wordt door normalisatie verwijderd vóór de match.
      pattern: /^\d{4}[A-Z]{2}$/,
      placeholder: '1234 AB',
      errorHint: 'Ongeldige postcode (bijv. 1234 AB)',
    },
    businessRegister: {
      label: 'KVK-nummer',
      pattern: /^\d{8}$/,
      placeholder: '12345678',
      errorHint: 'KVK-nummer moet 8 cijfers zijn',
    },
    vat: {
      pattern: /^NL\d{9}B\d{2}$/,
      placeholder: 'NL123456789B01',
    },
    phone: {
      // Zelfde semantiek als de bestaande isValidPhone (NL-mobiel).
      pattern: /^(06\d{8}|\+316\d{8}|00316\d{8})$/,
      placeholder: '0612345678',
      errorHint: 'Ongeldig telefoonnummer (bijv. 0612345678)',
    },
  },
  BE: {
    code: 'BE',
    label: 'België',
    postcode: {
      pattern: /^[1-9]\d{3}$/,
      placeholder: '1000',
      errorHint: 'Ongeldige postcode (bijv. 1000)',
    },
    businessRegister: {
      label: 'Ondernemingsnummer (KBO)',
      pattern: /^[01]\d{9}$/,
      placeholder: '0123456789',
      errorHint: 'Ondernemingsnummer moet 10 cijfers zijn en met 0 of 1 beginnen',
    },
    vat: {
      pattern: /^BE[01]\d{9}$/,
      placeholder: 'BE0123456789',
    },
    phone: {
      pattern: /^(04\d{8}|\+324\d{8}|00324\d{8})$/,
      placeholder: '0470123456',
      errorHint: 'Ongeldig telefoonnummer (bijv. 0470123456)',
    },
  },
};

/**
 * Landen die daadwerkelijk kunnen registreren. De picker toont uitsluitend
 * deze lijst en de server weigert al het andere — een niet-ondersteund land
 * mag nooit stil worden opgeslagen.
 */
export const ENABLED_COUNTRY_CODES: readonly string[] = ['NL'];

export function isEnabledCountry(code: unknown): code is string {
  return typeof code === 'string' && ENABLED_COUNTRY_CODES.includes(code);
}

/** Profiel van een ENABLED land; null voor al het andere (ook BE, nu). */
export function getCountryProfile(code: unknown): CountryProfile | null {
  if (!isEnabledCountry(code)) return null;
  return COUNTRY_PROFILES[code] ?? null;
}

// ── Normalisatie + validatie (altijd samen gebruiken) ────────────────────────

/** Uppercase, alle spaties eruit — "1234 ab" → "1234AB". */
export function normalizePostcode(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

export function isValidPostcodeFor(profile: CountryProfile, value: string): boolean {
  return profile.postcode.pattern.test(normalizePostcode(value));
}

/** Alleen cijfers overhouden — "0123.456.789" (BE-notatie) → "0123456789". */
export function normalizeBusinessRegister(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidBusinessRegisterFor(profile: CountryProfile, value: string): boolean {
  return profile.businessRegister.pattern.test(normalizeBusinessRegister(value));
}

/** Uppercase, spaties en punten eruit — "be 0123.456.789" → "BE0123456789". */
export function normalizeVat(value: string): string {
  return value.trim().replace(/[\s.]/g, '').toUpperCase();
}

export function isValidVatFor(profile: CountryProfile, value: string): boolean {
  return profile.vat.pattern.test(normalizeVat(value));
}

export function isValidPhoneFor(profile: CountryProfile, value: string): boolean {
  // Zelfde opschoning als de bestaande isValidPhone: vangt ook onzichtbare
  // unicode-tekens die mobiele toetsenborden bij plakken invoegen.
  const cleaned = value.replace(/[^\d+]/g, '');
  return profile.phone.pattern.test(cleaned);
}
