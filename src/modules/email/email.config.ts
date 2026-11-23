import { z } from 'zod';
import { resolve } from 'node:path';
import type { SmtpConfig } from './email.sender.js';

export type EmailGroups = {
  enquiryEnabled: boolean;
  staffEnabled: boolean;
  customerViewingEnabled: boolean;
  customerViewingActivatedAt: Date | null;
};
export type ProducerConfig = EmailGroups & {
  keys: Record<string, string>;
  activeKeyId: string;
  origin: string;
  brand: string;
  replyTo: string;
};
export type WorkerConfig = ProducerConfig & {
  databaseUrl: string;
  redisUrl: string;
  prefix: string;
  concurrency: number;
  rateMax: number;
  rateDuration: number;
  healthPort: number;
  smtp: SmtpConfig;
};
const invalid = () => new Error('EMAIL_CONFIG_INVALID');
const required = (input: Record<string, unknown>, key: string) => {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value))
    throw invalid();
  return value.trim();
};
function positive(
  input: Record<string, unknown>,
  key: string,
  fallback?: number,
  max = 1_000_000,
) {
  const value = Number(input[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw invalid();
  return value;
}
function groupConfig(input: Record<string, unknown>): EmailGroups {
  const flag = (key: string) => {
    const value = input[key];
    if (value === undefined || value === false || value === 'false')
      return false;
    if (value === true || value === 'true') return true;
    throw invalid();
  };
  const customerViewingEnabled = flag(
    'EMAIL_CUSTOMER_VIEWING_NOTIFICATIONS_ENABLED',
  );
  let customerViewingActivatedAt = null;
  if (customerViewingEnabled) {
    const cutoff = z.iso
      .datetime()
      .safeParse(input.EMAIL_CUSTOMER_VIEWING_ACTIVATED_AT);
    if (!cutoff.success) throw invalid();
    customerViewingActivatedAt = new Date(cutoff.data);
  }
  return {
    enquiryEnabled: flag('EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED'),
    staffEnabled: flag('EMAIL_STAFF_NOTIFICATIONS_ENABLED'),
    customerViewingEnabled,
    customerViewingActivatedAt,
  };
}

function payloadConfig(
  input: Record<string, unknown>,
  groups: EmailGroups,
): ProducerConfig {
  try {
    const keys: unknown = JSON.parse(required(input, 'EMAIL_PAYLOAD_KEYS'));
    const parsed = z
      .record(
        z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
        z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
      )
      .parse(keys);
    for (const key of Object.values(parsed))
      if (Buffer.from(key, 'base64').length !== 32) throw invalid();
    const activeKeyId = required(input, 'EMAIL_PAYLOAD_ACTIVE_KEY_ID');
    if (!Object.hasOwn(parsed, activeKeyId)) throw invalid();
    const origin = required(input, 'APP_ORIGIN');
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw invalid();
    const replyTo = z.email().max(254).parse(required(input, 'SMTP_REPLY_TO'));
    const brand =
      input.EMAIL_BRAND_NAME === undefined
        ? 'Avenor'
        : required(input, 'EMAIL_BRAND_NAME');
    if (brand.length > 120) throw invalid();
    return { ...groups, keys: parsed, activeKeyId, origin, replyTo, brand };
  } catch {
    throw invalid();
  }
}
export function readProducerConfig(
  input: Record<string, unknown>,
): ProducerConfig | null {
  const groups = groupConfig(input);
  return groups.enquiryEnabled ||
    groups.staffEnabled ||
    groups.customerViewingEnabled
    ? payloadConfig(input, groups)
    : null;
}
export function readWorkerConfig(input: Record<string, unknown>): WorkerConfig {
  const payload = payloadConfig(input, groupConfig(input));
  const redisUrl = required(input, 'REDIS_URL');
  const redis = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(redis.protocol)) throw invalid();
  const prefix = required(input, 'EMAIL_QUEUE_PREFIX');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(prefix)) throw invalid();
  const database = required(input, 'DATABASE_URL');
  if (!database.startsWith('file:') || database.length <= 5) throw invalid();
  const port = positive(input, 'SMTP_PORT', undefined, 65535);
  const secureValue = required(input, 'SMTP_SECURE');
  if (!['true', 'false'].includes(secureValue)) throw invalid();
  const secure = secureValue === 'true';
  const production = input.NODE_ENV === 'production';
  if (
    production &&
    (redis.protocol !== 'rediss:' ||
      !redis.password ||
      !payload.origin.startsWith('https:') ||
      ![465, 587].includes(port) ||
      secure !== (port === 465))
  )
    throw invalid();
  const username =
    typeof input.SMTP_USERNAME === 'string' ? input.SMTP_USERNAME : undefined;
  const password =
    typeof input.SMTP_PASSWORD === 'string' ? input.SMTP_PASSWORD : undefined;
  if (Boolean(username) !== Boolean(password) || (production && !username))
    throw invalid();
  const from = z.email().max(254).safeParse(input.SMTP_FROM);
  if (!from.success) throw invalid();
  const smtp: SmtpConfig = {
    host: required(input, 'SMTP_HOST'),
    port,
    secure,
    from: from.data,
    replyTo: payload.replyTo,
    ...(username && password ? { username, password } : {}),
  };
  return {
    ...payload,
    databaseUrl: `file:${resolve(database.slice(5))}`,
    redisUrl,
    prefix,
    smtp,
    concurrency: positive(input, 'EMAIL_CONCURRENCY', 2, 32),
    rateMax: positive(input, 'EMAIL_RATE_LIMIT_MAX'),
    rateDuration: positive(
      input,
      'EMAIL_RATE_LIMIT_DURATION_MS',
      1000,
      86_400_000,
    ),
    healthPort: positive(input, 'EMAIL_WORKER_HEALTH_PORT', 4312, 65535),
  };
}
