import { expect, it } from 'vitest';
import { normalizeLeadPhone } from '../src/modules/leads/lead-phone.js';
it('canonicalizes strict UAE and explicitly international phone input', () => {
  for (const value of [
    '0501234567',
    '+971 (50) 123-4567',
    '00971501234567',
    '(050) 123-4567',
    '0 50 123 4567',
    '0-50-123-4567',
    '(00971) 50 123 4567',
  ])
    expect(normalizeLeadPhone(value)).toBe('+971501234567');
  expect(normalizeLeadPhone('04 234 5678')).toBe('+97142345678');
  expect(normalizeLeadPhone('00442079460018')).toBe('+442079460018');
  for (const value of [
    '',
    '971501234567',
    '501234567',
    '02079460018',
    '05012',
    'call +971501234567',
    '+971501234567 ext 2',
    '+971501234567#2',
    '+99912345678',
    '+971501234567890',
  ])
    expect(normalizeLeadPhone(value), value).toBeNull();
});
