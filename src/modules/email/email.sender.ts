import nodemailer from 'nodemailer';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  senderName?: string;
  replyTo?: string;
};
export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  replyTo: string;
  username?: string;
  password?: string;
  requireTLS?: boolean;
};
export type EmailSender = {
  send(message: EmailMessage): Promise<{ messageId?: string }>;
  close(): void;
  activeCount(): number;
};

/** Each send owns its AbortController; no shared transport shutdown on a deadline. */
export function createEmailSender(
  config: SmtpConfig,
  deadlineMs = 30_000,
): EmailSender {
  const active = new Set<AbortController>();
  let stopped = false;
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS ?? !config.secure,
    ...(config.username
      ? { auth: { user: config.username, pass: config.password } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send(message) {
      if (stopped) throw new Error('EMAIL_SENDER_STOPPED');
      const controller = new AbortController();
      active.add(controller);
      const timer = setTimeout(() => controller.abort(), deadlineMs);
      try {
        const result = await transport.sendMail({
          from: message.senderName
            ? { name: message.senderName, address: config.from }
            : config.from,
          replyTo: message.replyTo ?? config.replyTo,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          signal: controller.signal,
        });
        return { messageId: result.messageId };
      } finally {
        clearTimeout(timer);
        active.delete(controller);
      }
    },
    activeCount: () => active.size,
    close() {
      stopped = true;
      for (const controller of active) controller.abort();
      transport.close();
    },
  };
}
