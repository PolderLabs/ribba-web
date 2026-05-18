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
