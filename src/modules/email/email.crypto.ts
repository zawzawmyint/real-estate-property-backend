import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  parseEmailPayload,
  type EmailPayload,
  type EncryptedPayload,
} from './email.types.js';

export function createEmailCrypto(config: {
  keys: Record<string, string>;
  activeKeyId: string;
}) {
  const keys = new Map(
    Object.entries(config.keys).map(([id, value]) => [
      id,
      Buffer.from(value, 'base64'),
    ]),
  );
  const active = keys.get(config.activeKeyId);
  if (!active || active.length !== 32) throw new Error('EMAIL_CONFIG_INVALID');
  const context = (id: string, kind: string, version: number) =>
    Buffer.from(JSON.stringify([id, kind, version]));
  return {
    seal(
      id: string,
      kind: string,
      version: number,
      payload: EmailPayload,
    ): EncryptedPayload {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', active, iv);
      cipher.setAAD(context(id, kind, version));
      const ciphertext = Buffer.concat([
        cipher.update(
          JSON.stringify(parseEmailPayload(kind, version, payload)),
          'utf8',
        ),
        cipher.final(),
      ]);
      return {
        payloadCiphertext: ciphertext.toString('base64'),
        payloadIv: iv.toString('base64'),
        payloadTag: cipher.getAuthTag().toString('base64'),
        payloadKeyId: config.activeKeyId,
      };
    },
    open(
      row: EncryptedPayload & {
        id: string;
        kind: string;
        templateVersion: number;
      },
    ): EmailPayload {
      const key = row.payloadKeyId && keys.get(row.payloadKeyId);
      if (!key) throw new Error('EMAIL_PAYLOAD_KEY_UNAVAILABLE');
      try {
        if (!row.payloadCiphertext || !row.payloadIv || !row.payloadTag)
          throw new Error();
        const iv = Buffer.from(row.payloadIv, 'base64'),
          tag = Buffer.from(row.payloadTag, 'base64');
        if (iv.length !== 12 || tag.length !== 16) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(context(row.id, row.kind, row.templateVersion));
        decipher.setAuthTag(tag);
        return parseEmailPayload(
          row.kind,
          row.templateVersion,
          JSON.parse(
            Buffer.concat([
              decipher.update(Buffer.from(row.payloadCiphertext, 'base64')),
              decipher.final(),
            ]).toString('utf8'),
          ),
        );
      } catch {
        throw new Error('EMAIL_PAYLOAD_INVALID');
      }
    },
  };
}
export type EmailCrypto = ReturnType<typeof createEmailCrypto>;
