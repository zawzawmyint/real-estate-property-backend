import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseImport } from '../../shared/csv/parse-import.js';
import { createSchema, type CreatePropertyInput } from './properties.schema.js';

export const importColumns = [
  'title',
  'purpose',
  'type',
  'description',
  'price_aed',
  'city',
  'community',
  'bedrooms',
  'bathrooms',
  'area_sqft',
  'owner_name',
  'owner_phone',
] as const;
const fields = [
  'title',
  'purpose',
  'type',
  'description',
  'priceFils',
  'city',
  'community',
  'bedrooms',
  'bathrooms',
  'areaSqft',
  'ownerName',
  'ownerPhone',
] as const;
export interface ImportIssue {
  rowNumber: number;
  column: string;
  message: string;
}
export const previewSchema = z.strictObject({ csv: z.string() });
export const commitSchema = previewSchema.extend({
  submissionId: z.uuid(),
  schemaVersion: z.number().int(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ImportCommit = z.infer<typeof commitSchema>;
export const importDigest = (csv: string) =>
  createHash('sha256')
    .update('property-import:v1\0')
    .update(csv, 'utf8')
    .digest('hex');

export function validateImport(csv: string) {
  const parsed = parseImport(csv, {
    allowedHeaders: importColumns,
    requiredHeaders: ['title', 'purpose'],
    maxBytes: 1048576,
    maxRows: 500,
    maxRecordBytes: 65536,
  });
  const issues: ImportIssue[] = [];
  let issueCount = 0;
  let validRows = 0;
  const inputs: CreatePropertyInput[] = [];
  const previewRows: { rowNumber: number; values: string[] }[] = [];
  for (const row of parsed.rows) {
    const values = importColumns.map((column) =>
      (row.values[column] ?? '').trim(),
    );
    values[1] = values[1]!.toLowerCase();
    values[2] = values[2]!.toLowerCase();
    const input: Record<string, unknown> = {};
    fields.forEach((field, index) => {
      input[field] = values[index] || null;
    });
    input.title = values[0];
    input.purpose = values[1];
    for (const index of [7, 8])
      if (values[index])
        input[fields[index]!] = /^(?:0|[1-9]\d*)$/.test(values[index]!)
          ? Number(values[index])
          : Number.NaN;
    if (values[4]) {
      const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(values[4]!);
      input.priceFils = match
        ? Number(
            BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0')),
          )
        : Number.NaN;
    }
    const result = createSchema.safeParse(input);
    if (result.success) {
      validRows++;
      inputs.push(result.data);
      if (result.data.priceFils != null)
        values[4] = `${Math.floor(result.data.priceFils / 100)}.${String(result.data.priceFils % 100).padStart(2, '0')}`;
    } else {
      for (const issue of result.error.issues) {
        issueCount++;
        const index = fields.indexOf(issue.path[0] as (typeof fields)[number]);
        if (issues.length < 100)
          issues.push({
            rowNumber: row.rowNumber,
            column: importColumns[index] ?? 'title',
            message: 'Invalid value for this column.',
          });
      }
    }
    if (previewRows.length < 20)
      previewRows.push({ rowNumber: row.rowNumber, values });
  }
  return {
    inputs,
    preview: {
      schemaVersion: 1 as const,
      digest: importDigest(csv),
      valid: issueCount === 0,
      totalRows: parsed.rows.length,
      validRows,
      issueCount,
      issues,
      columns: importColumns,
      previewRows,
    },
  };
}
