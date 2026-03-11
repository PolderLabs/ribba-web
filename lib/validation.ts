/**
 * Dutch postcode validation: 4 digits + 2 letters (e.g. 1234AB)
 */
export function isValidPostalCode(value: string): boolean {
  return /^\d{4}\s?[a-zA-Z]{2}$/.test(value.trim());
}

/**
 * Normalize postcode to "1234AB" format (no space, uppercase)
 */
export function normalizePostalCode(value: string): string {
  return value.trim().replace(/\s/g, '').toUpperCase();
}
