import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { leadFixture } from './lead-fixture.js';
export async function viewingFixture() {
  const f = await leadFixture();
  const property = await f.database.property.create({
    data: {
      title: 'Viewing property',
      purpose: 'sale',
      publishingState: 'published',
      availability: 'available',
    },
  });
  const lead = await f.create({}, 'agent');
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const body = {
    submissionId: randomUUID(),
    leadId: lead.id,
    propertyId: property.id,
    expectedLeadVersion: 1,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
  };
  function write(method: 'post' | 'patch', suffix = '', role = 'agent') {
    const client = request(f.app);
    return client[method](`/api/v1/staff/viewings${suffix}`)
      .set('Cookie', f.cookies[role]!)
      .set('Origin', f.env.APP_ORIGIN);
  }
  function read(suffix = '', role = 'agent') {
    return request(f.app)
      .get(`/api/v1/staff/viewings${suffix}`)
      .set('Cookie', f.cookies[role]!);
  }
  async function create(extra: object = {}) {
    const result = await write('post').send({
      ...body,
      submissionId: randomUUID(),
      ...extra,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }
  const range = `?from=${encodeURIComponent(new Date(Date.parse(startsAt) - 1).toISOString())}&to=${encodeURIComponent(new Date(Date.parse(startsAt) + 86400000).toISOString())}`;
  return {
    ...f,
    property,
    lead,
    body,
    viewingWrite: write,
    viewingRead: read,
    createViewing: create,
    range,
  };
}
