import { z } from 'zod';

const common = {
  to: z.email().max(254),
  name: z.string().min(1).max(120),
  publicOrigin: z.url().refine((value) => {
    const url = URL.parse(value);
    return (
      url !== null &&
      url.origin === value &&
      ['http:', 'https:'].includes(url.protocol)
    );
  }),
  brand: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[^\r\n]+$/),
  replyTo: z.email().max(254),
};

function snapshotLink(value: string, origin: string, path: RegExp) {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.origin === origin &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    path.test(url.pathname)
  );
}

const enquirySchema = z
  .strictObject({
    ...common,
    property: z
      .strictObject({ title: z.string().min(1).max(500), url: z.url() })
      .nullable(),
  })
  .refine(
    (payload) =>
      !payload.property ||
      snapshotLink(
        payload.property.url,
        payload.publicOrigin,
        /^\/properties\/[^/]+$/,
      ),
  );

const staff = { ...common, crmUrl: z.url() };
const viewing = {
  propertyTitle: z.string().min(1).max(500),
  location: z.string().max(500).nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
};

function validStaffLink(payload: { publicOrigin: string; crmUrl: string }) {
  return snapshotLink(
    payload.crmUrl,
    payload.publicOrigin,
    /^\/crm\/leads\/[A-Za-z0-9_-]+$/,
  );
}

const staffSchema = z.strictObject(staff).refine(validStaffLink);
const taskSchema = z
  .strictObject({ ...staff, dueAt: z.iso.datetime() })
  .refine(validStaffLink);
const staffViewingSchema = z
  .strictObject({ ...staff, ...viewing })
  .refine(validStaffLink);
const customerViewingSchema = z.strictObject({ ...common, ...viewing });

const payloadSchemas = {
  WEBSITE_ENQUIRY_RECEIVED: enquirySchema,
  LEAD_ASSIGNED: staffSchema,
  STAFF_WEBSITE_ENQUIRY_RECEIVED: staffSchema,
  TASK_DUE_SOON: taskSchema,
  STAFF_VIEWING_RESCHEDULED: staffViewingSchema,
  STAFF_VIEWING_CANCELLED: staffViewingSchema,
  CUSTOMER_VIEWING_CONFIRMED: customerViewingSchema,
  CUSTOMER_VIEWING_REMINDER: customerViewingSchema,
  CUSTOMER_VIEWING_RESCHEDULED: customerViewingSchema,
  CUSTOMER_VIEWING_CANCELLED: customerViewingSchema,
} as const;
export type EmailKind = keyof typeof payloadSchemas;
export type PayloadFor<K extends EmailKind> = z.infer<
  (typeof payloadSchemas)[K]
>;
export type EmailPayload = PayloadFor<EmailKind>;
export function parseEmailPayload(
  kind: string,
  version: number,
  input: unknown,
): EmailPayload {
  if (version !== 1 || !Object.hasOwn(payloadSchemas, kind))
    throw new Error('EMAIL_TEMPLATE_UNSUPPORTED');
  return payloadSchemas[kind as EmailKind].parse(input);
}

export type EncryptedPayload = {
  payloadCiphertext: string | null;
  payloadIv: string | null;
  payloadTag: string | null;
  payloadKeyId: string | null;
};
export const terminalStates = [
  'SUBMITTED',
  'FAILED',
  'UNCERTAIN',
  'EXPIRED',
  'SUPPRESSED',
];
export const day = 86_400_000;
export const emailViewingChanged = 'EMAIL_VIEWING_CHANGED';
