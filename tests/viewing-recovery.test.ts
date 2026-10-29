import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { viewingFixture } from './viewing-fixture.js';

let f: Awaited<ReturnType<typeof viewingFixture>>;
beforeAll(async () => {
  f = await viewingFixture();
});
afterAll(async () => {
  await f?.close();
});

it('returns a saved receipt identifier only to its currently authorized creator', async () => {
  const input = { ...f.body, submissionId: randomUUID() };
  const saved = await f.viewingWrite('post').send(input);
  expect(saved.status).toBe(201);
  const edited = {
    ...input,
    endsAt: new Date(Date.parse(input.endsAt) + 60000).toISOString(),
  };
  const conflict = await f.viewingWrite('post').send(edited);
  expect(conflict.status).toBe(409);
  expect(conflict.body.error).toMatchObject({
    code: 'VIEWING_RECEIPT_CONFLICT',
    existingViewingId: saved.body.id,
  });
  const otherActor = await f.viewingWrite('post', '', 'manager').send(edited);
  expect(otherActor.status).toBe(409);
  expect(otherActor.body.error).not.toHaveProperty('existingViewingId');
  const inaccessible = await f.viewingWrite('post', '', 'other').send(edited);
  expect(inaccessible.status).toBe(404);
  expect(inaccessible.body.error).not.toHaveProperty('existingViewingId');
  expect((await f.viewingWrite('post').send(input)).body.id).toBe(
    saved.body.id,
  );
});

it('allows corrected time and stale lead retries with the same submission identifier', async () => {
  const input = { ...f.body, submissionId: randomUUID() };
  const past = {
    ...input,
    startsAt: '2020-01-01T10:00:00Z',
    endsAt: '2020-01-01T11:00:00Z',
  };
  expect((await f.viewingWrite('post').send(past)).status).toBe(400);
  expect(
    (await f.viewingWrite('post').send({ ...input, expectedLeadVersion: 999 }))
      .status,
  ).toBe(409);
  const saved = await f.viewingWrite('post').send(input);
  expect(saved.status).toBe(201);
  expect(
    (await f.viewingWrite('post').send(past)).body.error.existingViewingId,
  ).toBe(saved.body.id);
  expect(
    await f.database.viewing.count({
      where: { submissionId: input.submissionId },
    }),
  ).toBe(1);
});

it('allows only one insert when a delayed original races a deliberate correction', async () => {
  const input = { ...f.body, submissionId: randomUUID() };
  const corrected = {
    ...input,
    endsAt: new Date(Date.parse(input.endsAt) + 60000).toISOString(),
  };
  const results = await Promise.all([
    f.viewingWrite('post').send(input),
    f.viewingWrite('post').send(corrected),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(
    results.find((result) => result.status === 409)!.body.error
      .existingViewingId,
  ).toBe(results.find((result) => result.status === 201)!.body.id);
  expect(
    await f.database.viewing.count({
      where: { submissionId: input.submissionId },
    }),
  ).toBe(1);
});
