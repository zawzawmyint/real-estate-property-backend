import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => {
    const date = new Date(value);
    return (
      Number.isFinite(date.getTime()) &&
      date.getUTCFullYear() >= 2000 &&
      date.getUTCFullYear() <= 9999
    );
  })
  .transform((value) => new Date(value).toISOString());
const version = z.number().int().positive();
const title = z.string().trim().min(1).max(160);
const notes = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .transform((value) => value || null);
export const createSchema = z.strictObject({
  submissionId: z.uuid(),
  leadId: z.uuid(),
  expectedLeadVersion: version,
  title,
  notes: notes.optional().transform((value) => value ?? null),
  dueAt: instant,
});
export const updateSchema = z.strictObject({
  expectedVersion: version,
  expectedLeadVersion: version,
  title,
  notes,
  dueAt: instant,
});
export const statusSchema = z.strictObject({
  expectedVersion: version,
  status: z.enum(['completed', 'cancelled']),
});
const page = (max: number, fallback: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().max(max))
    .default(fallback);
export const listSchema = z
  .strictObject({
    leadId: z.uuid().optional(),
    status: z.enum(['open', 'completed', 'cancelled', 'all']).default('open'),
    due: z.enum(['all', 'overdue', 'today', 'upcoming']).default('all'),
    page: page(1000000, 1),
    pageSize: page(100, 20),
  })
  .refine((value) => value.due !== 'overdue' || value.status === 'open');
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid task input');
  return result.data;
}
export const parseId = (id: unknown) => parse(z.uuid(), id);
export function parseQuery(url: string) {
  const values: Record<string, string> = {};
  for (const [key, value] of new URL(url, 'http://local').searchParams) {
    if (Object.hasOwn(values, key))
      throw new AppError(400, 'VALIDATION_ERROR', 'Duplicate query parameter');
    values[key] = value;
  }
  return parse(listSchema, values);
}
export type CreateInput = z.infer<typeof createSchema>;
export type UpdateInput = z.infer<typeof updateSchema>;
export type StatusInput = z.infer<typeof statusSchema>;
export type ListQuery = z.infer<typeof listSchema>;
