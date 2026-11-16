import { expect, it } from 'vitest';
import {
  serializeExport,
  decimalHundredths,
} from '../src/shared/csv/export.js';
it('writes BOM, CRLF, nulls, booleans, zero and quoted Unicode text', () => {
  expect(
    serializeExport(
      ['a', 'b', 'c', 'd'],
      [{ a: 'é,"x"\r\ny', b: null, c: false, d: 0 }],
    ),
  ).toBe('\uFEFFa,b,c,d\r\n"é,""x""\r\ny",,false,0\r\n');
  expect(serializeExport(['a'], [])).toBe('\uFEFFa\r\n');
  expect(decimalHundredths(1000000000001n)).toBe('10000000000.01');
});
it('escapes ASCII and Unicode formula starters', () => {
  for (const value of [
    '=1',
    '+971',
    '-1',
    '@x',
    '\tx',
    '\rx',
    '＝x',
    '＋x',
    '－x',
    '＠x',
  ])
    expect(serializeExport(['a'], [{ a: value }])).toContain("'" + value);
});
it('enforces exact row and UTF8 byte limits', () => {
  expect(() =>
    serializeExport(
      ['a'],
      Array.from({ length: 5000 }, () => ({ a: 0 })),
    ),
  ).not.toThrow();
  expect(() =>
    serializeExport(
      ['a'],
      Array.from({ length: 5001 }, () => ({ a: 0 })),
    ),
  ).toThrow('Too many results');
  const size = 10485760 - 8;
  expect(
    Buffer.byteLength(serializeExport(['a'], [{ a: 'x'.repeat(size) }])),
  ).toBe(10485760);
  expect(() => serializeExport(['a'], [{ a: 'x'.repeat(size + 1) }])).toThrow(
    'Too many results',
  );
});
