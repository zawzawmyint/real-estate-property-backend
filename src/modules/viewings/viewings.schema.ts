import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
const instant = z.iso.datetime({ offset: true });
const version = z.number().int().positive();
const times = { startsAt: instant, endsAt: instant };

export const createSchema = z.strictObject({
  submissionId: z.uuid(),
  leadId: z.uuid(),
  propertyId: z.uuid(),
  expectedLeadVersion: version,
  ...times,
});
export const rescheduleSchema = z.strictObject({
  expectedVersion: version,
  expectedLeadVersion: version,
  ...times,
});
export const statusSchema = z.discriminatedUnion('status', [
  z.strictObject({ expectedVersion: version, status: z.literal('cancelled') }),
  z.strictObject({
    expectedVersion: version,
    status: z.literal('completed'),
    feedback: z.string().trim().min(1).max(4000),
  }),
]);
const page = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().max(1000000))
  .default(1);
export const listSchema = z
  .strictObject({
    from: instant,
    to: instant,
    page,
    pageSize: z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .pipe(z.number().int().max(100))
      .default(50),
    leadId: z.uuid().optional(),
    status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
  })
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 42 * 86400000,
  );
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid viewing input');
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
export type RescheduleInput = z.infer<typeof rescheduleSchema>;
export type StatusInput = z.infer<typeof statusSchema>;
export type ListQuery = z.infer<typeof listSchema>;
