import { expect, it } from 'vitest';
import { parseImport } from '../src/shared/csv/parse-import.js';
import { validateImport } from '../src/modules/properties/property-import.schema.js';

const options = {
  allowedHeaders: ['title', 'purpose'],
  requiredHeaders: ['title', 'purpose'],
  maxBytes: 1048576,
  maxRows: 500,
  maxRecordBytes: 65536,
};
it('preserves strings, BOM and multiline logical rows', () => {
  expect(
    parseImport('\ufefftitle,purpose\r\n"Home,\nnew",sale\r\n', options).rows,
  ).toEqual([
    { rowNumber: 2, values: { title: 'Home,\nnew', purpose: 'sale' } },
  ]);
});
it.each([
  'title,title\na,b',
  'title,unknown\na,b',
  'title,purpose\n"bad,sale',
  'title,purpose\na,sale,extra',
  'title,purpose\n\ud800,sale',
  'title,purpose\na\0,sale',
])('rejects structural or encoding errors', (csv) => {
  expect(() => parseImport(csv, options)).toThrow();
});
it('counts UTF8 raw bytes including quotes and CRLF', () => {
  // The data record is longer than the header: 8 UTF-8 data bytes, 2 quotes,
  // and 2 CRLF bytes. This measures the quoted multibyte record itself.
  const record = 'v\r\n"éééé"\r\n';
  const policy = {
    ...options,
    allowedHeaders: ['v'],
    requiredHeaders: ['v'],
  };
  expect(() =>
    parseImport(record, {
      ...policy,
      maxRecordBytes: 11,
    }),
  ).toThrow();
  expect(() =>
    parseImport(record, {
      ...policy,
      maxRecordBytes: 12,
    }),
  ).not.toThrow();
});
it('normalizes exact money, enums, nulls and zero without losing phone zeroes', () => {
  const result = validateImport(
    'title,purpose,price_aed,bedrooms,owner_phone\n Home , SALE ,1.01,0,0012345',
  );
  expect(result.preview.valid).toBe(true);
  expect(result.inputs[0]).toMatchObject({
    title: 'Home',
    purpose: 'sale',
    priceFils: 101,
    bedrooms: 0,
    ownerPhone: '0012345',
  });
});
it('aggregates bounded issues including the final row', () => {
  const result = validateImport(
    'title,purpose\n' + Array.from({ length: 101 }, () => ',wrong').join('\n'),
  );
  expect(result.preview.valid).toBe(false);
  expect(result.preview.issueCount).toBe(202);
  expect(result.preview.issues).toHaveLength(100);
  expect(result.preview.previewRows).toHaveLength(20);
});
it('accepts exactly 500 rows and rejects 501, oversized files and raw records', () => {
  const csv =
    'title,purpose\n' +
    Array.from({ length: 500 }, () => 'Home,sale').join('\n');
  expect(parseImport(csv, options).rows).toHaveLength(500);
  expect(() => parseImport(csv + '\nHome,sale', options)).toThrow();
  expect(() => parseImport('x'.repeat(1048577), options)).toThrow();
  expect(() =>
    parseImport('title,purpose\n' + 'é'.repeat(32768) + ',sale', options),
  ).toThrow();
});
it.each(['0', '-1', '1.001', '1e2', '1,000', 'AED1', '10000000000.01'])(
  'rejects invalid price %s',
  (price) => {
    expect(
      validateImport(`title,purpose,price_aed\nHome,sale,"${price}"`).preview
        .valid,
    ).toBe(false);
  },
);
