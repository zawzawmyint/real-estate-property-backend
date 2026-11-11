import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { viewingFixture } from './viewing-fixture.js';

const f = await viewingFixture();
afterAll(() => f.close());

function alerts(leadId: string) {
  return f.database.notification.findMany({
    where: { leadId },
    select: { recipientId: true, type: true, retiredAt: true },
  });
}

function assign(leadId: string, expectedVersion: number, role: string | null) {
  return f.write('patch', `/${leadId}/assignment`).send({
    expectedVersion,
    assignedAgentId: role ? f.ids[role] : null,
  });
}

it('keeps one live lead-assignment alert across same-assignee saves, conflicts and returning ownership', async () => {
  const lead = await f.create();

  expect((await assign(lead.id, 1, 'agent')).status).toBe(200);
  expect((await assign(lead.id, 2, 'agent')).status).toBe(200);
  expect((await assign(lead.id, 1, 'other')).status).toBe(409);
  expect((await assign(lead.id, 2, 'other')).status).toBe(200);
  expect((await assign(lead.id, 3, 'agent')).status).toBe(200);

  const rows = await alerts(lead.id);
  expect(rows).toHaveLength(3);
  expect(rows.filter((row) => row.retiredAt === null)).toEqual([
    { recipientId: f.ids.agent, type: 'lead_assigned', retiredAt: null },
  ]);
  expect(
    rows.filter((row) => row.retiredAt).map((row) => row.recipientId),
  ).toEqual(expect.arrayContaining([f.ids.agent, f.ids.other]));

  expect((await assign(lead.id, 4, null)).status).toBe(200);
  expect((await alerts(lead.id)).every((row) => row.retiredAt !== null)).toBe(
    true,
  );
});

it('alerts on an assigned manual lead only once and skips agent self-creation', async () => {
  const input = {
    submissionId: randomUUID(),
    name: 'Manual lead',
    email: 'manual@example.test',
    purpose: 'sale',
    source: 'call',
    assignedAgentId: f.ids.agent,
  };
  const creation = await f.write('post').send(input);
  expect(creation.status).toBe(201);
  expect((await f.write('post').send(input)).status).toBe(200);
  expect(await alerts(creation.body.id)).toEqual([
    { recipientId: f.ids.agent, type: 'lead_assigned', retiredAt: null },
  ]);
  expect(await alerts(f.lead.id)).toEqual([]);
});

it('rolls back lead ownership and activity when the notification write fails', async () => {
  const lead = await f.create();
  await f.database.$executeRaw`
    CREATE TRIGGER reject_notification BEFORE INSERT ON Notification
    BEGIN SELECT RAISE(ABORT, 'test notification failure'); END
  `;
  try {
    expect((await assign(lead.id, 1, 'agent')).status).toBe(500);
    expect((await f.read(`/${lead.id}`)).body).toMatchObject({
      version: 1,
      assignedAgent: null,
    });
    expect(
      await f.database.leadActivity.count({ where: { leadId: lead.id } }),
    ).toBe(1);
    expect(await alerts(lead.id)).toEqual([]);
  } finally {
    await f.database.$executeRaw`DROP TRIGGER reject_notification`;
  }
});

it('notifies the viewing assignee only for a committed change by another staff member', async () => {
  const viewing = await f.createViewing();
  const edit = (expectedVersion: number, days: number, role = 'manager') =>
    f.viewingWrite('patch', `/${viewing.id}`, role).send({
      expectedVersion,
      expectedLeadVersion: 1,
      startsAt: new Date(
        Date.parse(f.body.startsAt) + days * 86400000,
      ).toISOString(),
      endsAt: new Date(
        Date.parse(f.body.endsAt) + days * 86400000,
      ).toISOString(),
    });

  const same = await edit(1, 0);
  expect(same.status).toBe(200);
  const self = await edit(same.body.version, 1, 'agent');
  expect(self.status).toBe(200);
  expect(await alerts(f.lead.id)).toEqual([]);

  const rescheduled = await edit(self.body.version, 2);
  expect(rescheduled.status).toBe(200);
  expect((await edit(self.body.version, 3)).status).toBe(409);
  expect(
    (
      await f.viewingWrite('patch', `/${viewing.id}/status`, 'manager').send({
        expectedVersion: rescheduled.body.version,
        status: 'cancelled',
      })
    ).status,
  ).toBe(200);
  expect(
    (await alerts(f.lead.id)).map(({ recipientId, type }) => ({
      recipientId,
      type,
    })),
  ).toEqual(
    expect.arrayContaining([
      { recipientId: f.ids.agent, type: 'viewing_rescheduled' },
      { recipientId: f.ids.agent, type: 'viewing_cancelled' },
    ]),
  );
  expect(await alerts(f.lead.id)).toHaveLength(2);
});

it('alerts active Admin and Manager users for both public inquiry paths and retires the alerts upon assignment', async () => {
  const disabled = await f.operator.create({
    name: 'Disabled manager',
    email: 'disabled-manager@example.test',
    role: 'manager',
    password: 'Test-password-123!',
  });
  await f.database.user.update({
    where: { id: disabled.id },
    data: { disabled: true },
  });

  for (const [path, extra] of [
    ['/api/v1/public/inquiries', { purpose: 'sale' }],
    [`/api/v1/public/properties/${f.property.id}/inquiries`, {}],
  ] as const) {
    const app = createApp(f.env, f.auth, f.database);
    const submissionId = randomUUID();
    const submit = (email: string) =>
      request(app)
        .post(path)
        .set('Origin', f.env.APP_ORIGIN)
        .send({
          submissionId,
          name: 'Visitor',
          email,
          message: 'Hello',
          ...extra,
        });

    expect((await submit('visitor@example.test')).status).toBe(201);
    expect((await submit('visitor@example.test')).status).toBe(200);
    expect((await submit('conflict@example.test')).status).toBe(409);
    const { leadId } = await f.database.leadSubmissionReceipt.findUniqueOrThrow(
      { where: { id: submissionId } },
    );
    const rows = await alerts(leadId);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          recipientId: f.ids.admin,
          type: 'website_inquiry_received',
          retiredAt: null,
        },
        {
          recipientId: f.ids.manager,
          type: 'website_inquiry_received',
          retiredAt: null,
        },
      ]),
    );

    expect((await assign(leadId, 1, 'agent')).status).toBe(200);
    const updated = await alerts(leadId);
    expect(updated).toHaveLength(3);
    expect(updated.filter((row) => row.retiredAt === null)).toEqual([
      { recipientId: f.ids.agent, type: 'lead_assigned', retiredAt: null },
    ]);
  }
});
