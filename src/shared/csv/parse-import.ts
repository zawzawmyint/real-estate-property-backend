import { parse } from 'csv-parse/sync';
import { AppError } from '../errors/app-error.js';

export interface ImportOptions {
  allowedHeaders: readonly string[];
  requiredHeaders: readonly string[];
  maxBytes: number;
  maxRows: number;
  maxRecordBytes: number;
}

const invalid = () =>
  new AppError(
    400,
    'IMPORT_INVALID_CSV',
    'Use a valid UTF-8 CSV and the import template headers.',
  );
const limit = () =>
  new AppError(
    413,
    'IMPORT_LIMIT_EXCEEDED',
    'The CSV exceeds an import limit.',
  );

export function parseImport(csv: string, options: ImportOptions) {
  if (
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      csv,
    ) ||
    csv.includes('\0')
  )
    throw invalid();
  if (Buffer.byteLength(csv, 'utf8') > options.maxBytes) throw limit();

  // Count raw UTF-8 record bytes independently: parser field-size guards do not
  // include all delimiters, quoting and CRLF bytes. Quotes double inside fields.
  const bytes = Buffer.from(csv);
  let quoted = false;
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 34) {
      if (quoted && bytes[i + 1] === 34) i++;
      else quoted = !quoted;
    }
    if (!quoted && (bytes[i] === 10 || bytes[i] === 13)) {
      if (bytes[i] === 13 && bytes[i + 1] === 10) i++;
      if (i + 1 - start > options.maxRecordBytes) throw limit();
      start = i + 1;
    }
  }
  if (bytes.length - start > options.maxRecordBytes) throw limit();

  let records: string[][];
  try {
    records = parse(csv, {
      bom: true,
      cast: false,
      skip_empty_lines: true,
    }) as string[][];
  } catch {
    throw invalid();
  }
  const headers = records.shift()?.map((header) => header.trim());
  if (
    !headers ||
    headers.some((header) => !options.allowedHeaders.includes(header)) ||
    new Set(headers).size !== headers.length ||
    options.requiredHeaders.some((header) => !headers.includes(header))
  )
    throw invalid();
  if (!records.length) throw invalid();
  if (records.length > options.maxRows) throw limit();
  return {
    headers,
    rows: records.map((record, index) => ({
      rowNumber: index + 2,
      values: Object.fromEntries(
        headers.map((header, i) => [header, record[i]!]),
      ),
    })),
  };
}
