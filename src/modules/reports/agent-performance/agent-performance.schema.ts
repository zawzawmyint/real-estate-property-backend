import { AppError } from '../../../shared/errors/app-error.js';

const day = 86_400_000;
const dubaiOffset = 4 * 3_600_000;

function invalid(): never {
  throw new AppError(400, 'VALIDATION_ERROR', 'Invalid report filters');
}

function calendarDate(value: string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const midnight = new Date(value + 'T00:00:00.000Z');
  if (
    !Number.isFinite(midnight.getTime()) ||
    !midnight.toISOString().startsWith(value + 'T')
  )
    invalid();
  return midnight.getTime();
}

export function parsePerformanceQuery(url: string) {
  const params = new URL(url, 'http://localhost').searchParams;
  for (const [key, value] of params) {
    if (
      !['from', 'to', 'agentId', 'page', 'pageSize'].includes(key) ||
      !value.trim() ||
      params.getAll(key).length !== 1
    )
      invalid();
  }
  const from = params.get('from'),
    to = params.get('to');
  if ((from === null) !== (to === null)) invalid();
  if (from && to) {
    const length = (calendarDate(to) - calendarDate(from)) / day + 1;
    if (length < 1 || length > 366) invalid();
  }
  const agentId = params.get('agentId') ?? undefined;
  if (agentId && agentId.length > 128) invalid();
  const pageText = params.get('page') ?? '1',
    size = params.get('pageSize') ?? '25';
  const page = Number(pageText);
  if (
    !/^[1-9]\d*$/.test(pageText) ||
    !Number.isSafeInteger(page) ||
    !['25', '50'].includes(size)
  )
    invalid();
  return { from, to, agentId, page, pageSize: Number(size) };
}

export function performanceRange(
  query: ReturnType<typeof parsePerformanceQuery>,
  generatedAt: Date,
) {
  const today = new Date(generatedAt.getTime() + dubaiOffset)
    .toISOString()
    .slice(0, 10);
  const from = query.from ?? today.slice(0, 8) + '01',
    to = query.to ?? today;
  if (to > today) invalid();
  const rangeStart = new Date(calendarDate(from) - dubaiOffset);
  const rangeEndExclusive = new Date(calendarDate(to) + day - dubaiOffset);
  return {
    from,
    to,
    generatedAt,
    rangeStart,
    rangeEndExclusive,
    asOf: new Date(
      Math.min(generatedAt.getTime(), rangeEndExclusive.getTime()),
    ),
  };
}

export type ReportRange = ReturnType<typeof performanceRange>;
