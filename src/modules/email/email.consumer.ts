import { randomUUID } from 'node:crypto';
import type { EmailRepository } from './email.repository.js';
import type { EmailSender } from './email.sender.js';
import { renderEmail } from './email.templates.js';

export function classifySmtpFailure(
  error: unknown,
): 'RETRY' | 'FAILED' | 'UNCERTAIN' {
  const e = error as {
    code?: string;
    command?: string;
    responseCode?: number;
  } | null;
  if (!e || typeof e !== 'object') return 'UNCERTAIN';
  if (
    e.code === 'EAUTH' ||
    e.code === 'EENVELOPE' ||
    (e.responseCode && e.responseCode >= 500)
  )
    return 'FAILED';
  if (e.responseCode && e.responseCode >= 400 && e.responseCode < 500)
    return 'RETRY';
  if (
    [
      'CONN',
      'EHLO',
      'HELO',
      'STARTTLS',
      'AUTH',
      'MAIL FROM',
      'RCPT TO',
    ].includes(e.command ?? '') &&
    ['ECONNECTION', 'ECONNREFUSED', 'ETIMEDOUT', 'EDNS', 'ESOCKET'].includes(
      e.code ?? '',
    )
  )
    return 'RETRY';
  return 'UNCERTAIN';
}
export function createEmailConsumer(input: {
  repository: EmailRepository;
  sender: EmailSender;
  keyIds?: string[];
  clock?: () => number;
  observe?: (code: string, id: string) => void;
}) {
  const { repository: repo, sender } = input;
  const clock = input.clock ?? Date.now;
  return async (id: string) => {
    if (!/^[a-f0-9-]{36}$/i.test(id)) return;
    const token = randomUUID();
    const row = await repo.claimSend(id, clock, token, input.keyIds);
    if (!row) return;
    let message;
    try {
      message = renderEmail(row.kind, row.templateVersion, row.payload);
    } catch {
      await repo.finish(id, token, 'FAILED', clock(), 'EMAIL_TEMPLATE_INVALID');
      return;
    }
    let result;
    try {
      result = await sender.send(message);
    } catch (error) {
      const outcome = classifySmtpFailure(error);
      if (outcome === 'RETRY')
        await repo.retry(id, token, clock(), 'SMTP_TRANSIENT');
      else
        await repo.finish(
          id,
          token,
          outcome,
          clock(),
          outcome === 'FAILED' ? 'SMTP_PERMANENT' : 'SMTP_UNCERTAIN',
        );
      input.observe?.(`SMTP_${outcome}`, id);
      return;
    }

    // If recording SMTP acceptance fails, lease recovery marks the attempt uncertain.
    if (
      await repo.finish(
        id,
        token,
        'SUBMITTED',
        clock(),
        undefined,
        result.messageId,
      )
    )
      input.observe?.('EMAIL_SUBMITTED', id);
  };
}
