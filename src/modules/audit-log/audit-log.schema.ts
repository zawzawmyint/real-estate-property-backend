import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
import { actions } from './audit-log.changes.js';

const paging = {
  page: z
    .string()
    .regex(/^[1-9]\d*$/)
    .default('1')
    .transform(Number)
    .pipe(z.int().positive()),
  pageSize: z
    .string()
    .regex(/^[1-9]\d*$/)
    .default('20')
    .transform(Number)
    .pipe(z.int().min(1).max(100)),
};
const instant = z.iso
  .datetime({ offset: true })
  .transform((text) => new Date(text))
  .pipe(z.date());
const list = z
  .strictObject({
    ...paging,
    from: instant,
    to: instant,
    actorId: z.string().trim().min(1).max(128).optional(),
    actorKind: z.enum(['staff', 'website', 'system']).optional(),
    entityType: z
      .enum(['property', 'lead', 'viewing', 'task', 'import'])
      .optional(),
    entityId: z.uuid().optional(),
    action: z.enum(actions).optional(),
    importId: z.uuid().optional(),
  })
  .refine(
    (v) =>
      v.to > v.from &&
      v.to.getTime() - v.from.getTime() <= 93 * 86400000 &&
      !(v.actorId && v.actorKind) &&
      (!v.entityId || !!v.entityType) &&
      (!v.entityType || !v.action || v.action.startsWith(v.entityType + '.')),
  );
const actors = z.strictObject({
  ...paging,
  q: z.string().trim().max(100).optional(),
});
export type ListQuery = z.infer<typeof list>;
export type ActorQuery = z.infer<typeof actors>;

function invalid(): never {
  throw new AppError(400, 'INVALID_INPUT', 'Invalid audit filters');
}

function parse<T extends { page: number; pageSize: number }>(
  schema: z.ZodType<T>,
  url: string,
) {
  const params = new URLSearchParams(url.split('?').slice(1).join('?'));
  const entries = Object.fromEntries(params);
  if (Object.keys(entries).length !== params.size) invalid();

  const result = schema.safeParse(entries);
  if (
    !result.success ||
    !Number.isSafeInteger((result.data.page - 1) * result.data.pageSize)
  )
    invalid();

  return result.data;
}

export const parseListQuery = (url: string) => parse(list, url);
export const parseActorQuery = (url: string) => parse(actors, url);
