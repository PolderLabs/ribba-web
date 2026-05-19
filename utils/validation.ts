/**
 * Check if a person is at least `minAge` years old based on date of birth.
 */
export function isMinimumAge(dateOfBirth: string, minAge: number = 16): boolean {
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return false;

  const today = new Date();
  const age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  const dayDiff = today.getDate() - dob.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    return age - 1 >= minAge;
  }
  return age >= minAge;
}

/**
 * Basic email validation
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Dutch phone number validation (06-xxxxxxxx or +316xxxxxxxx).
 * Strip alles behalve digits en '+' — vangt ook hidden unicode-tekens
 * (NBSP, LTR-mark, etc.) die mobile keyboards soms invoegen bij paste.
 */
export function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[^\d+]/g, '');
  return /^(06\d{8}|\+316\d{8}|00316\d{8})$/.test(cleaned);
}

/**
 * Internationale telefoonnummervalidatie. Accepteert nummers uit alle landen,
 * niet alleen Nederlandse. Bedoeld voor leerlingen die zich bij een rijschool
 * inschrijven met een buitenlands nummer (bijv. een Duits +49-nummer).
 *
 * Geaccepteerd:
 *  - E.164-formaat: '+' gevolgd door 8-15 cijfers (00-prefix wordt genormaliseerd naar '+')
 *  - Lokaal nummer zonder landcode: begint met '0', 9-12 cijfers (bijv. NL '0612345678')
 */
export function isValidInternationalPhone(phone: string): boolean {
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }
  if (cleaned.startsWith('+')) {
    return /^\+\d{8,15}$/.test(cleaned);
  }
  return /^0\d{8,11}$/.test(cleaned);
}

/**
 * KVK number validation: exactly 8 digits
 */
export function isValidKVK(kvk: string): boolean {
  return /^\d{8}$/.test(kvk.replace(/\s/g, ''));
}

/**
 * IBAN validation: 2 letters + 2 digits + 11-30 alphanumeric chars
 */
export function isValidIBAN(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(cleaned);
}
