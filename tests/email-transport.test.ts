import { expect, it } from 'vitest';
import { createEmailSender } from '../src/modules/email/email.sender.js';
import { smtpFixture } from './email-smtp-fixture.js';

it('emits the snapshot display name and reply-to with the current authorized sender address', async () => {
  const smtp = await smtpFixture();
  const sender = createEmailSender({
    host: '127.0.0.1',
    port: smtp.port,
    secure: false,
    requireTLS: false,
    from: 'authorized@example.test',
    replyTo: 'new@example.test',
  });
  try {
    await sender.send({
      to: 'visitor@example.test',
      subject: 'Receipt',
      text: 'Receipt',
      html: '<p>Receipt</p>',
      senderName: 'Original Agency',
      replyTo: 'original@example.test',
    });
    expect(smtp.messages[0]).toMatch(
      /From: Original Agency <authorized@example.test>/,
    );
    expect(smtp.messages[0]).toMatch(/Reply-To: original@example.test/);
  } finally {
    sender.close();
    await smtp.close();
  }
});

for (const stage of ['greeting', 'data', 'accepted'] as const) {
  it(`cancels a stalled ${stage} send without cancelling another delivery`, async () => {
    const smtp = await smtpFixture(stage);
    const sender = createEmailSender(
      {
        host: '127.0.0.1',
        port: smtp.port,
        secure: false,
        from: 'Agency <agency@example.test>',
        replyTo: 'help@example.test',
        requireTLS: false,
      },
      250,
    );
    const message = {
      to: 'visitor@example.test',
      subject: 'Received',
      text: 'Receipt',
      html: '<p>Receipt</p>',
    };
    try {
      const stalled = sender.send(message).catch((error: unknown) => error);
      await expect.poll(() => smtp.sockets.size).toBe(1);
      await expect(
        sender.send({ ...message, to: 'second@example.test' }),
      ).resolves.toMatchObject({ messageId: expect.any(String) });
      expect(await stalled).toMatchObject({ code: 'EABORT' });
      await expect.poll(() => smtp.sockets.size).toBe(0);
      expect(smtp.messages.length).toBe(stage === 'accepted' ? 2 : 1);
      expect(sender.activeCount()).toBe(0);
    } finally {
      sender.close();
      await smtp.close();
    }
  });
}

it('shutdown aborts active SMTP work and observes its completion', async () => {
  const smtp = await smtpFixture('accepted');
  const sender = createEmailSender({
    host: '127.0.0.1',
    port: smtp.port,
    secure: false,
    requireTLS: false,
    from: 'agency@example.test',
    replyTo: 'help@example.test',
  });
  try {
    const work = sender
      .send({
        to: 'visitor@example.test',
        subject: 'Receipt',
        text: 'Receipt',
        html: '<p>Receipt</p>',
      })
      .catch((error: unknown) => error);
    await expect.poll(() => smtp.messages.length).toBe(1);
    sender.close();
    expect(await work).toMatchObject({ code: 'EABORT' });
    await expect.poll(() => smtp.sockets.size).toBe(0);
    expect(sender.activeCount()).toBe(0);
  } finally {
    sender.close();
    await smtp.close();
  }
});
