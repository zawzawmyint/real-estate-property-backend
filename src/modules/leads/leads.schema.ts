import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';

export const stages = [
  'new',
  'contacted',
  'viewing_scheduled',
  'offer',
  'won',
  'lost',
] as const;
const text = (max: number) => z.string().trim().min(1).max(max);
const contact = {
  name: text(120),
  phone: text(40)
    .min(3)
    .regex(/^[+\d ()-]+$/)
    .regex(/\d/)
    .nullable()
    .optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email().max(254))
    .nullable()
    .optional(),
};
const details = {
  ...contact,
  purpose: z.enum(['sale', 'rent']),
  budgetFils: z
    .number()
    .int()
    .min(1)
    .max(1_000_000_000_000)
    .nullable()
    .optional(),
  propertyId: z.uuid().nullable().optional(),
};
const hasContact = (value: {
  phone?: string | null | undefined;
  email?: string | null | undefined;
}) => Boolean(value.phone || value.email);

export const inquirySchema = z
  .strictObject({
    ...contact,
    submissionId: z.uuid(),
    message: text(2000).nullable().optional(),
  })
  .refine(hasContact);

export const createSchema = z
  .strictObject({
    ...details,
    submissionId: z.uuid(),
    source: z.enum(['call', 'walk_in']),
    assignedAgentId: text(200).nullable().optional(),
  })
  .refine(hasContact);

export const patchSchema = z
  .strictObject({ ...details })
  .partial()
  .extend({ expectedVersion: z.number().int().positive() })
  .refine((value) => Object.keys(value).length > 1);

export const assignmentSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  assignedAgentId: text(200).nullable(),
});

export const stageSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  stage: z.enum(stages),
});

export const noteSchema = z.strictObject({
  submissionId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  kind: z.enum(['note', 'call']),
  body: text(5000),
});
const page = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().max(1_000_000))
  .default(1);

export const listSchema = z.strictObject({
  view: z.enum(['unassigned', 'all', 'mine']).optional(),
  q: z.string().trim().max(120).optional(),
  stage: z.enum(stages).optional(),
  source: z.enum(['website', 'call', 'walk_in']).optional(),
  agentId: text(200).optional(),
  sort: z.enum(['newest', 'oldest', 'updated']).default('newest'),
  page,
});

export const pageSchema = z.strictObject({ page });

export const candidatesSchema = z.strictObject({
  page,
  q: z.string().trim().max(120).optional(),
});

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid lead input');
  return result.data;
}
export const parseId = (id: unknown) => parse(z.uuid(), id);

export function parseQuery<T>(schema: z.ZodType<T>, url: string): T {
  const values: Record<string, string> = {};
  for (const [key, value] of new URL(url, 'http://local').searchParams) {
    if (Object.hasOwn(values, key))
      throw new AppError(400, 'VALIDATION_ERROR', 'Duplicate query parameter');
    values[key] = value;
  }
  return parse(schema, values);
}
export type CreateInput = z.infer<typeof createSchema>;

export type InquiryInput = z.infer<typeof inquirySchema>;

export type PatchInput = z.infer<typeof patchSchema>;

export type NoteInput = z.infer<typeof noteSchema>;

export type ListQuery = z.infer<typeof listSchema>;

export type CandidateQuery = z.infer<typeof candidatesSchema>;
