import { z } from 'zod';
import { phoneSchema } from '../../shared/validation/phone.js';

const text = (max: number) => z.string().trim().min(1).max(max);
export const agentSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const phone = phoneSchema.nullable();
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254))
  .nullable();
const portrait = z
  .strictObject({
    src: z.string().regex(/^\/images\/agents\/[a-z0-9-]+\.webp$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .nullable();

const agency = z.strictObject({
  name: text(120),
  isDemo: z.boolean(),
  phone,
  email,
  address: text(500).nullable(),
  officeHours: z
    .array(z.strictObject({ days: text(120), hours: text(120) }))
    .max(7),
  timeZone: z.literal('Asia/Dubai'),
  mapUrl: z
    .url({ protocol: /^https$/ })
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password;
    })
    .nullable(),
});
const agent = z.strictObject({
  slug: agentSlugSchema,
  name: text(120),
  title: text(120),
  specialties: z.array(text(80)).max(8),
  portrait,
  isDemo: z.boolean(),
  introduction: text(320),
  biography: z.array(text(1500)).min(1).max(3),
  languages: z.array(text(80)).max(8),
  publicPhone: phone,
  publicEmail: email,
  published: z.boolean(),
});

export const agencyCatalogSchema = z.strictObject({
  agency,
  agents: z
    .array(agent)
    .max(24)
    .refine(
      (agents) =>
        new Set(agents.map((profile) => profile.slug)).size === agents.length,
    ),
});

export type AgencyContent = z.infer<typeof agency>;
export type AgentContent = z.infer<typeof agent>;
