import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
import { propertySearchFields } from './property-search.js';

export const purposes = ['sale', 'rent'] as const;
export const propertyTypes = [
  'apartment',
  'villa',
  'townhouse',
  'penthouse',
] as const;
export const publishingStates = ['draft', 'published', 'archived'] as const;
export const availabilities = ['available', 'sold', 'rented'] as const;
const text = (max: number) => z.string().trim().min(1).max(max);
const area = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/)
  .refine((value) => Number(value) > 0 && Number(value) <= 1_000_000);
const fields = {
  title: text(160),
  purpose: z.enum(purposes),
  type: z.enum(propertyTypes).nullable(),
  description: text(10_000).nullable(),
  priceFils: z.number().int().min(1).max(1_000_000_000_000).nullable(),
  city: text(120).nullable(),
  community: text(120).nullable(),
  bedrooms: z.number().int().min(0).max(20).nullable(),
  bathrooms: z.number().int().min(0).max(20).nullable(),
  areaSqft: area.nullable(),
  ownerName: text(120).nullable(),
  ownerPhone: text(40)
    .min(3)
    .regex(/^[+\d ()-]+$/)
    .regex(/\d/)
    .nullable(),
  featured: z.boolean(),
};
export const createSchema = z
  .strictObject(fields)
  .partial()
  .required({ title: true, purpose: true });

export type CreatePropertyInput = z.infer<typeof createSchema>;

export const patchSchema = z
  .strictObject({
    ...fields,
    publishingState: z.enum(publishingStates),
    availability: z.enum(availabilities),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const orderSchema = z.strictObject({
  photoIds: z.array(z.uuid()).max(12),
});

export type PropertyInput = z.infer<typeof patchSchema>;

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);

  if (!parsed.success)
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid property input');

  return parsed.data;
}

export const parseId = (id: unknown) => parse(z.uuid(), id);
const integer = (min: number, max: number) =>
  z
    .string()
    .regex(/^(?:0|[1-9]\d*)$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
const queryFields = {
  purpose: z.enum(purposes).optional(),
  type: z.enum(propertyTypes).optional(),
  location: text(120).optional(),
  minPriceFils: integer(0, 1_000_000_000_000).optional(),
  maxPriceFils: integer(0, 1_000_000_000_000).optional(),
  minBedrooms: integer(0, 20).optional(),
  featured: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: integer(1, 10_000).default(1),
  pageSize: integer(1, 48).default(12),
};
const publicQuery = z.strictObject({
  ...queryFields,
  sort: z.enum(['newest', 'price_asc', 'price_desc']).default('newest'),
});
const staffQuery = z.strictObject({
  ...queryFields,
  q: text(160).optional(),
  publishingState: z.enum(publishingStates).optional(),
  availability: z.enum(availabilities).optional(),
  sort: z
    .enum(['newest', 'price_asc', 'price_desc', 'updated_desc'])
    .default('updated_desc'),
});

export type PropertyQuery = z.infer<typeof staffQuery>;

export function parseQuery(url: string, staff: boolean): PropertyQuery {
  const params = new URL(url, 'http://local').searchParams;
  const values: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;

  for (const [key, value] of params) {
    if (Object.hasOwn(values, key))
      throw new AppError(400, 'VALIDATION_ERROR', 'Duplicate query parameter');

    values[key] = value;
  }

  const result = parse(staff ? staffQuery : publicQuery, values);

  if (
    result.minPriceFils !== undefined &&
    result.maxPriceFils !== undefined &&
    result.minPriceFils > result.maxPriceFils
  )
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Minimum price exceeds maximum price',
    );

  return result;
}

export function toData(input: PropertyInput) {
  const { areaSqft, priceFils } = input;
  // Select write fields explicitly even for internal callers. TypeScript types
  // alone do not prevent additional properties on runtime objects.
  const remaining = {
    title: input.title,
    purpose: input.purpose,
    type: input.type,
    description: input.description,
    city: input.city,
    community: input.community,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    ownerName: input.ownerName,
    ownerPhone: input.ownerPhone,
    featured: input.featured,
    publishingState: input.publishingState,
    availability: input.availability,
  };

  type Fields = Omit<PropertyInput, 'areaSqft' | 'priceFils'>;

  const rest = Object.fromEntries(
    Object.entries(remaining).filter(([, value]) => value !== undefined),
  ) as { [K in keyof Fields]?: Exclude<Fields[K], undefined> };

  return {
    ...rest,
    ...propertySearchFields(input),
    ...(areaSqft !== undefined
      ? {
          areaHundredths:
            areaSqft === null
              ? null
              : Number(areaSqft.split('.')[0]) * 100 +
                Number((areaSqft.split('.')[1] ?? '').padEnd(2, '0')),
        }
      : {}),
    ...(priceFils !== undefined
      ? { priceFils: priceFils === null ? null : BigInt(priceFils) }
      : {}),
  };
}
