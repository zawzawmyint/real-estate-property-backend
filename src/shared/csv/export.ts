import { stringify } from 'csv-stringify/sync';
import type { Response } from 'express';
import { AppError } from '../errors/app-error.js';
export const exportLimit = () =>
  new AppError(
    422,
    'EXPORT_LIMIT_EXCEEDED',
    'Too many results to export. Narrow your filters and try again.',
  );
export function decimalHundredths(
  value: bigint | number | null,
): string | null {
  if (value === null) return null;
  const amount = BigInt(value);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}
export function serializeExport(
  columns: readonly string[],
  rows: ReadonlyArray<Record<string, string | number | boolean | null>>,
): string {
  if (rows.length > 5000) throw exportLimit();
  const csv = stringify([...rows], {
    columns: [...columns],
    header: true,
    bom: true,
    record_delimiter: '\r\n',
    escape_formulas: true,
    cast: { boolean: (value) => String(value) },
  });
  if (Buffer.byteLength(csv, 'utf8') > 10485760) throw exportLimit();
  return csv;
}
export function sendExport(
  res: Response,
  kind: 'leads' | 'properties',
  started: Date,
  csv: string,
) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(started);
  res
    .set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${kind}-${date}.csv"`,
    })
    .send(csv);
}
