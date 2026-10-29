import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { leadFixture } from './lead-fixture.js';
import { createTaskService } from '../src/modules/tasks/tasks.service.js';
import type { Actor } from '../src/modules/leads/leads.repository.js';
export async function taskFixture() {
  const f = await leadFixture(),
    lead = await f.create({}, 'agent');
  const body = {
    submissionId: randomUUID(),
    leadId: lead.id,
    expectedLeadVersion: 1,
    title: 'Call customer',
    notes: null,
    dueAt: new Date(Date.now() + 86400000).toISOString(),
  };
  function taskWrite(method: 'post' | 'patch', suffix = '', role = 'agent') {
    const client = request(f.app);
    return client[method](`/api/v1/staff/tasks${suffix}`)
      .set('Cookie', f.cookies[role]!)
      .set('Origin', f.env.APP_ORIGIN);
  }
  function taskRead(suffix = '', role = 'agent') {
    return request(f.app)
      .get(`/api/v1/staff/tasks${suffix}`)
      .set('Cookie', f.cookies[role]!);
  }
  async function createTask(extra: object = {}) {
    const response = await taskWrite('post').send({
      ...body,
      submissionId: randomUUID(),
      ...extra,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.task;
  }
  async function serviceAt(instant: string, role = 'agent') {
    const session = await f.database.session.findFirstOrThrow({
      where: { userId: f.ids[role]! },
    });
    const actor: Actor = {
      id: f.ids[role]!,
      name: role,
      role: role === 'other' ? 'agent' : (role as Actor['role']),
      sessionId: session.id,
    };
    return {
      service: createTaskService(f.database, () => new Date(instant)),
      actor,
    };
  }
  return { ...f, lead, body, taskWrite, taskRead, createTask, serviceAt };
}
