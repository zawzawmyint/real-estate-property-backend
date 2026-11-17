import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { AppError } from '../../shared/errors/app-error.js';

export function normalizeLeadPhone(value: string): string | null {
  let phone = value.trim();
  if (!phone || phone.length > 40 || !/^[+\d ()-]+$/.test(phone)) return null;
  phone = phone.replace(/[ ()-]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  else if (!phone.startsWith('+') && !/^0[2346795]/.test(phone)) return null;
  const parsed = parsePhoneNumberFromString(phone, {
    defaultCountry: 'AE',
    extract: false,
  });
  if (!parsed || parsed.ext || !parsed.isValid()) return null;
  if (
    !phone.startsWith('+') &&
    (parsed.country !== 'AE' ||
      !['MOBILE', 'FIXED_LINE', 'FIXED_LINE_OR_MOBILE'].includes(
        parsed.getType() ?? '',
      ))
  )
    return null;
  return parsed.number;
}

export class LeadPhoneValidationError extends AppError {
  readonly fieldErrors = {
    phone: [
      'Enter a valid UAE number starting with 0, or an international number starting with + or 00.',
    ],
  };
  constructor() {
    super(400, 'VALIDATION_ERROR', 'Invalid lead phone');
  }
}

export function requireLeadPhone(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const canonical = normalizeLeadPhone(value);
  if (!canonical) throw new LeadPhoneValidationError();
  return canonical;
}
