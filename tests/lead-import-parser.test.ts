import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  commitSchema,
  importDigest,
  validateImport,
} from '../src/modules/leads/lead-import.schema.js';

it('normalizes existing lead contacts, enums and exact money in template order', () => {
  const result = validateImport(
    '\ufeffsource,email,name,budget_aed,purpose,phone\r\n CALL , A@EXAMPLE.TEST , Ágent ,10000000000.00, SALE , 001\t234 \r\n',
  );
  expect(result.preview.valid).toBe(true);
  expect(result.inputs[0]).toEqual({
    name: 'Ágent',
    phone: '001 234',
    email: 'a@example.test',
    purpose: 'sale',
    source: 'call',
    budgetFils: 1000000000000,
  });
  expect(result.preview.previewRows[0]).toEqual({
    rowNumber: 2,
    values: [
      'Ágent',
      '001 234',
      'a@example.test',
      'sale',
      '10000000000.00',
      'call',
    ],
  });
  expect(importDigest('x')).toBe(
    createHash('sha256').update('lead-import:v1\0x').digest('hex'),
  );
  expect(importDigest('x')).not.toBe(importDigest('\ufeffx'));
});

it('permits either contact header and represents omitted optional fields as null', () => {
  expect(
    validateImport('name,email,purpose,source\nOne,A@EXAMPLE.TEST,rent,walk_in')
      .inputs[0],
  ).toEqual({
    name: 'One',
    email: 'a@example.test',
    phone: null,
    purpose: 'rent',
    source: 'walk_in',
    budgetFils: null,
  });
  expect(
    validateImport('name,phone,purpose,source\nOne,00123,sale,call').preview
      .valid,
  ).toBe(true);
});

it('requires contact per row and rejects a supplied invalid contact even with a valid other contact', () => {
  const result = validateImport(
    'name,phone,email,purpose,source\nOne,,,sale,call\nTwo,00123,bad,rent,call\nThree,letters1,a@example.test,rent,call',
  );
  expect(result.preview.validRows).toBe(0);
  expect(result.preview.issues).toEqual([
    {
      rowNumber: 2,
      column: 'phone',
      message: 'Provide a phone number or email address.',
    },
    {
      rowNumber: 3,
      column: 'email',
      message: 'Invalid value for this column.',
    },
    {
      rowNumber: 4,
      column: 'phone',
      message: 'Invalid value for this column.',
    },
  ]);
});

it.each(['0', '-1', '1.001', '1e2', '1,000', 'AED1', '10000000000.01'])(
  'rejects invalid budget %s',
  (budget) => {
    expect(
      validateImport(
        `name,email,purpose,source,budget_aed\nOne,a@example.test,sale,call,"${budget}"`,
      ).preview.valid,
    ).toBe(false);
  },
);

it.each([
  'name,purpose,source\nOne,sale,call',
  'name,email,purpose,source,stage\nOne,a@example.test,sale,call,new',
  'name,email,email,purpose,source\nOne,a@example.test,a@example.test,sale,call',
  'name,email,purpose,source,\nOne,a@example.test,sale,call,',
  'name,email,purpose,source\nOne,a@example.test,sale,call,extra',
  'name,email,purpose,source\n"bad',
  'name,email,purpose,source\n\ud800,a@example.test,sale,call',
  'name,email,purpose,source\nOne\0,a@example.test,sale,call',
  'name,email,purpose,source\n',
])('rejects structural/header/encoding errors', (csv) => {
  expect(() => validateImport(csv)).toThrowError(
    expect.objectContaining({ status: 400, code: 'IMPORT_INVALID_CSV' }),
  );
});

it('bounds diagnostics while counting all errors and rejects website source', () => {
  const result = validateImport(
    'name,email,purpose,source\n' +
      Array.from({ length: 101 }, () => ',a@example.test,bad,website').join(
        '\n',
      ),
  );
  expect(result.preview).toMatchObject({
    totalRows: 101,
    validRows: 0,
    valid: false,
    issueCount: 303,
  });
  expect(result.preview.issues).toHaveLength(100);
  expect(result.preview.previewRows).toHaveLength(20);
});

it('enforces row/file/raw-record caps and strict positive version request shape', () => {
  const csv =
    'name,email,purpose,source\n' +
    Array.from({ length: 500 }, () => 'One,a@example.test,sale,call').join(
      '\n',
    );
  expect(validateImport(csv).preview.validRows).toBe(500);
  for (const value of [
    csv + '\nOne,a@example.test,sale,call',
    'x'.repeat(1048577),
    'name,email,purpose,source\n' +
      'é'.repeat(32768) +
      ',a@example.test,sale,call',
  ])
    expect(() => validateImport(value)).toThrowError(
      expect.objectContaining({ status: 413 }),
    );
  expect(
    commitSchema.safeParse({
      csv,
      submissionId: 'a',
      schemaVersion: 0,
      digest: importDigest(csv),
    }).success,
  ).toBe(false);
});
