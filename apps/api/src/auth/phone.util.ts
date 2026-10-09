import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Normalizes to +998XXXXXXXXX. Accepts local formats too (e.g. "90 123 45
 * 67", "901234567") by assuming UZ as the default region when no country
 * code is present. Returns null if the input isn't a valid UZ number.
 */
export function normalizePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input, 'UZ');
  if (!parsed || !parsed.isValid()) {
    return null;
  }
  return parsed.number;
}
