import { normalizeLeadPhone } from './lead-phone.js';
import { duplicateAcknowledgementSchema } from './leads.schema.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseImport } from '../../shared/csv/parse-import.js';
import { AppError } from '../../shared/errors/app-error.js';
import { createSchema } from './leads.schema.js';

export const importColumns = [
  'name',
  'phone',
  'email',
  'purpose',
  'budget_aed',
  'source',
] as const;
const fields = [
  'name',
  'phone',
  'email',
  'purpose',
  'budgetFils',
  'source',
] as const;
const rowSchema = z
  .strictObject({
    name: createSchema.shape.name,
    phone: createSchema.shape.phone.pipe(
      createSchema.shape.phone.refine(
        (value) => !value || normalizeLeadPhone(value) !== null,
        {
          message:
            'Enter a valid UAE number starting with 0, or an international number starting with + or 00.',
        },
      ),
    ),
    email: createSchema.shape.email,
    purpose: createSchema.shape.purpose,
    budgetFils: createSchema.shape.budgetFils,
    source: createSchema.shape.source,
  })
  .refine((value) => Boolean(value.phone || value.email), {
    path: ['phone'],
    message: 'Provide a phone number or email address.',
  });

export interface ImportIssue {
  rowNumber: number;
  column: string;
  message: string;
}
export type ImportLead = z.infer<typeof rowSchema>;
export const previewSchema = z.strictObject({ csv: z.string() });
export const commitSchema = previewSchema.extend({
  duplicateAcknowledgement: duplicateAcknowledgementSchema.optional(),
  submissionId: z.uuid(),
  schemaVersion: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ImportCommit = z.infer<typeof commitSchema>;
export const importDigest = (csv: string, version = 2) =>
  createHash('sha256')
    .update(`lead-import:v${version}\0`)
    .update(csv, 'utf8')
    .digest('hex');

export function validateImport(csv: string) {
  const parsed = parseImport(csv, {
    allowedHeaders: importColumns,
    requiredHeaders: ['name', 'purpose', 'source'],
    maxBytes: 1048576,
    maxRows: 500,
    maxRecordBytes: 65536,
  });
  if (!parsed.headers.includes('phone') && !parsed.headers.includes('email'))
    throw new AppError(
      400,
      'IMPORT_INVALID_CSV',
      'Include a phone or email header.',
    );

  const issues: ImportIssue[] = [];
  const inputs: ImportLead[] = [];
  const duplicateRows: { rowNumber: number; phoneCanonical: string | null }[] =
    [];
  const previewRows: { rowNumber: number; values: string[] }[] = [];
  let issueCount = 0;
  for (const row of parsed.rows) {
    const values = importColumns.map((column) =>
      (row.values[column] ?? '').trim(),
    );
    values[1] = values[1]!.replace(/\s/g, ' ');
    for (const index of [2, 3, 5]) values[index] = values[index]!.toLowerCase();
    let budgetFils: number | null = null;
    if (values[4]) {
      const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(values[4]!);
      budgetFils =
        match && match[1]!.length <= 11
          ? Number(
              BigInt(match[1]!) * 100n +
                BigInt((match[2] ?? '').padEnd(2, '0')),
            )
          : Number.NaN;
    }
    const result = rowSchema.safeParse({
      name: values[0],
      phone: values[1] || null,
      email: values[2] || null,
      purpose: values[3],
      budgetFils,
      source: values[5],
    });
    if (result.success) {
      inputs.push(result.data);
      duplicateRows.push({
        rowNumber: row.rowNumber,
        phoneCanonical: result.data.phone
          ? normalizeLeadPhone(result.data.phone)
          : null,
      });
      values[1] = result.data.phone ?? '';
      values[2] = result.data.email ?? '';
      if (result.data.budgetFils != null)
        values[4] = `${Math.floor(result.data.budgetFils / 100)}.${String(result.data.budgetFils % 100).padStart(2, '0')}`;
    } else {
      for (const issue of result.error.issues) {
        issueCount++;
        const index = fields.indexOf(issue.path[0] as (typeof fields)[number]);
        if (issues.length < 100)
          issues.push({
            rowNumber: row.rowNumber,
            column: importColumns[index] ?? 'name',
            message:
              issue.code === 'custom'
                ? issue.message
                : 'Invalid value for this column.',
          });
      }
    }
    if (previewRows.length < 20)
      previewRows.push({ rowNumber: row.rowNumber, values });
  }
  return {
    inputs,
    duplicateRows,
    preview: {
      schemaVersion: 2 as const,
      digest: importDigest(csv),
      valid: issueCount === 0,
      totalRows: parsed.rows.length,
      validRows: inputs.length,
      issueCount,
      issues,
      columns: importColumns,
      previewRows,
    },
  };
}
