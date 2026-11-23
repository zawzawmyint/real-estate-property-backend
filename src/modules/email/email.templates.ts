import {
  parseEmailPayload,
  type EmailKind,
  type PayloadFor,
} from './email.types.js';
import type { EmailMessage } from './email.sender.js';

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (value) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        value
      ]!,
  );
function renderAcknowledgement(
  payload: PayloadFor<'WEBSITE_ENQUIRY_RECEIVED'>,
): EmailMessage {
  const confirmation = payload.property
    ? `We have received your enquiry about ${payload.property.title}.`
    : 'We have received your enquiry.';
  const text = `Hello ${payload.name},\n\n${confirmation}\nOur team will follow up with you.\n${payload.property ? `\nView property: ${payload.property.url}\n` : ''}\nYou can reply to ${payload.replyTo}.\n\n${payload.brand}`;
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enquiry received</title></head><body style="font-family:Arial,sans-serif;color:#252329;background:#FAF8F5;padding:24px"><main style="max-width:600px;margin:auto"><h1>${escape(payload.brand)}</h1><p>Hello ${escape(payload.name)},</p><p>${escape(confirmation)}</p><p>Our team will follow up with you.</p>${payload.property ? `<p><a href="${escape(payload.property.url)}">View property</a></p>` : ''}<p>You can reply to <a href="mailto:${escape(payload.replyTo)}">${escape(payload.replyTo)}</a>.</p></main></body></html>`;
  return {
    to: payload.to,
    senderName: payload.brand,
    replyTo: payload.replyTo,
    subject: payload.property
      ? 'We received your property enquiry'
      : 'We received your enquiry',
    text,
    html,
  };
}

const descriptions = {
  LEAD_ASSIGNED: [
    'A lead has been assigned to you',
    'You are now assigned to this lead.',
  ],
  STAFF_WEBSITE_ENQUIRY_RECEIVED: [
    'New website enquiry',
    'A new website enquiry is waiting for assignment.',
  ],
  STAFF_VIEWING_RESCHEDULED: [
    'Assigned lead viewing rescheduled',
    'The viewing for your assigned lead has been rescheduled.',
  ],
  STAFF_VIEWING_CANCELLED: [
    'Assigned lead viewing cancelled',
    'The viewing for your assigned lead has been cancelled.',
  ],
  TASK_DUE_SOON: [
    'A follow-up task is due soon',
    'You have a follow-up task due soon.',
  ],
  CUSTOMER_VIEWING_CONFIRMED: [
    'Your viewing is confirmed',
    'We look forward to welcoming you at your viewing.',
  ],
  CUSTOMER_VIEWING_REMINDER: [
    'Reminder for your upcoming viewing',
    'We look forward to seeing you at your upcoming viewing.',
  ],
  CUSTOMER_VIEWING_RESCHEDULED: [
    'Your viewing has been rescheduled',
    'Your viewing has moved to the new time below.',
  ],
  CUSTOMER_VIEWING_CANCELLED: [
    'Your viewing has been cancelled',
    'Your viewing at the time below has been cancelled.',
  ],
} satisfies Record<
  Exclude<EmailKind, 'WEBSITE_ENQUIRY_RECEIVED'>,
  [string, string]
>;

const dubaiTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  dateStyle: 'medium',
  timeStyle: 'short',
});
const formatTime = (value: string) =>
  dubaiTime.format(new Date(value)) + ' (Dubai time, UTC+4)';

export function renderEmail(
  kind: string,
  version: number,
  input: unknown,
): EmailMessage {
  const payload = parseEmailPayload(kind, version, input);
  if ('property' in payload) return renderAcknowledgement(payload);

  const [subject, summary] = descriptions[kind as keyof typeof descriptions];
  const paragraphs = [`Hello ${payload.name},`, summary];
  if ('propertyTitle' in payload) {
    paragraphs.push(payload.propertyTitle);
    if (payload.location) paragraphs.push(payload.location);
    paragraphs.push(
      `Starts: ${formatTime(payload.startsAt)}`,
      `Ends: ${formatTime(payload.endsAt)}`,
    );
  }
  if ('dueAt' in payload) paragraphs.push(`Due: ${formatTime(payload.dueAt)}`);
  const crmUrl = 'crmUrl' in payload ? payload.crmUrl : null;
  const reply = `You can reply to ${payload.replyTo}.`;
  return {
    to: payload.to,
    replyTo: payload.replyTo,
    senderName: payload.brand,
    subject,
    text: [
      ...paragraphs,
      ...(crmUrl ? ['Open lead in CRM: ' + crmUrl] : []),
      reply,
      payload.brand,
    ].join('\n\n'),
    html: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body><main><h1>${escape(payload.brand)}</h1>${paragraphs.map((line) => `<p>${escape(line)}</p>`).join('')}${crmUrl ? `<p><a href="${escape(crmUrl)}">Open lead in CRM</a></p>` : ''}<p>${escape(reply)}</p></main></body></html>`,
  };
}
