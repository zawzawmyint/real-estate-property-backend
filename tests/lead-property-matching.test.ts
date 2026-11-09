import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';
import { toData } from '../src/modules/properties/properties.schema.js';

const fixture = await leadFixture();
afterAll(() => fixture.close());

const idFor = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const matchPath = (id: string, query = '?purpose=rent') =>
  `/${id}/property-matches${query}`;

async function seedRentInventory() {
  const { database } = fixture;
  const rentStudio = {
    ...toData({
      city: 'Dubai',
      community: 'Cafe\u0301 %_ Marina',
      description: 'Rental listing details',
      ownerName: 'Private owner',
      ownerPhone: '+971 555555555',
    }),
    title: 'Rental studio',
    purpose: 'rent',
    type: 'apartment',
    priceFils: 12_000_000n,
    publishingState: 'published',
    bedrooms: 0,
    createdAt: new Date('2026-11-01'),
  };

  await database.property.createMany({
    data: [
      ...Array.from({ length: 11 }, (_, index) => ({
        ...rentStudio,
        id: idFor(index + 1),
      })),
      ...[
        { priceFils: 12_000_001n },
        { bedrooms: 1 },
        { publishingState: 'draft' },
        { publishingState: 'archived' },
        { availability: 'rented' },
        { purpose: 'sale' },
        { type: 'villa' },
        { searchCommunity: 'café xx marina' },
      ].map((excluded, index) => ({
        ...rentStudio,
        ...excluded,
        id: idFor(20 + index),
        createdAt: new Date('2026-11-02'),
      })),
    ],
  });

  await database.propertyPhoto.create({
    data: {
      propertyId: idFor(1),
      storageKey: `${randomUUID()}.webp`,
      position: 0,
      width: 640,
      height: 480,
    },
  });
}

it('filters available published rentals before pagination and returns the public summary', async () => {
  await seedRentInventory();
  // The staff-confirmed purpose takes precedence over the lead's stored purpose.
  const lead = await fixture.create({ purpose: 'sale', budgetFils: 1 });
  const query =
    '?purpose=rent&location=%20CAF%C3%89%20%25_%20&exactBedrooms=0&type=apartment&maxPriceFils=12000000';
  const first = await fixture.read(matchPath(lead.id, query));
  const second = await fixture.read(matchPath(lead.id, `${query}&page=2`));
  expect(first.status).toBe(200);
  expect(first.headers['cache-control']).toBe('no-store');
  expect(first.body).toMatchObject({
    items: Array.from({ length: 10 }, (_, index) => ({ id: idFor(index + 1) })),
    total: 11,
    page: 1,
    pageSize: 10,
  });
  expect(second.status).toBe(200);
  expect(second.body).toMatchObject({
    items: [{ id: idFor(11) }],
    total: 11,
    page: 2,
    pageSize: 10,
  });
  const publicPage = await request(fixture.app).get(
    '/api/v1/properties?purpose=rent&location=CAF%C3%89%20%25_&maxPriceFils=12000000',
  );
  expect(publicPage.status).toBe(200);
  expect(first.body.items[0]).toEqual(
    publicPage.body.items.find((item: { id: string }) => item.id === idFor(1)),
  );
  expect(first.body.items[0]).toMatchObject({
    purpose: 'rent',
    bedrooms: 0,
    priceFils: 12_000_000,
    coverPhoto: { width: 640, height: 480 },
  });
  for (const field of [
    'ownerName',
    'ownerPhone',
    'description',
    'availability',
  ])
    expect(first.body.items[0]).not.toHaveProperty(field);
  const uncapped = await fixture.read(matchPath(lead.id));
  expect(uncapped.status).toBe(200);
  expect(uncapped.body.items).toEqual(
    expect.arrayContaining(
      [{ id: idFor(20) }, { id: idFor(21) }].map((expected) =>
        expect.objectContaining(expected),
      ),
    ),
  );
  const zeroCap = await fixture.read(
    matchPath(lead.id, '?purpose=rent&maxPriceFils=0'),
  );
  expect(zeroCap.status).toBe(200);
  expect(zeroCap.body).toEqual({ items: [], total: 0, page: 1, pageSize: 10 });
});

it('matches all lead sources and enforces current assignment and session access', async () => {
  const linked = await fixture.database.property.create({
    data: {
      title: 'Linked sale',
      purpose: 'sale',
      publishingState: 'published',
    },
  });
  const submit = (path: string, fields: object) =>
    request(fixture.app)
      .post(path)
      .set('Origin', fixture.env.APP_ORIGIN)
      .send({
        submissionId: randomUUID(),
        name: 'Website contact',
        email: 'visitor@example.test',
        message: 'Interested',
        ...fields,
      });
  expect(
    (await submit('/api/v1/public/inquiries', { purpose: 'sale' })).status,
  ).toBe(201);
  expect(
    (await submit(`/api/v1/public/properties/${linked.id}/inquiries`, {}))
      .status,
  ).toBe(201);

  const website = await fixture.database.lead.findMany({
    where: { source: 'website' },
  });
  expect(website.map((lead) => lead.propertyId)).toEqual(
    expect.arrayContaining([null, linked.id]),
  );
  for (const lead of website) {
    const result = await fixture.read(
      matchPath(lead.id, '?purpose=sale'),
      'admin',
    );
    expect(result.status).toBe(200);
    expect(result.body.items.map((item: { id: string }) => item.id)).toContain(
      linked.id,
    );
  }

  const manual = await fixture.create({}, 'agent');
  const path = matchPath(manual.id);
  expect((await fixture.read(path, 'agent')).status).toBe(200);
  expect((await fixture.read(path, 'other')).status).toBe(404);
  expect((await fixture.read(matchPath(randomUUID()), 'admin')).status).toBe(
    404,
  );
  const anonymous = await request(fixture.app).get(
    `/api/v1/staff/leads${path}`,
  );
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers['cache-control']).toBe('no-store');

  const leadBefore = await fixture.database.lead.findUnique({
    where: { id: manual.id },
  });
  const activityBefore = await fixture.database.leadActivity.count();
  await fixture.read(path, 'agent').expect(200);
  expect(
    await fixture.database.lead.findUnique({ where: { id: manual.id } }),
  ).toEqual(leadBefore);
  expect(await fixture.database.leadActivity.count()).toBe(activityBefore);

  await fixture
    .write('patch', `/${manual.id}/assignment`)
    .send({
      expectedVersion: manual.version,
      assignedAgentId: fixture.ids.other,
    })
    .expect(200);
  expect((await fixture.read(path, 'agent')).status).toBe(404);
  expect((await fixture.read(path, 'other')).status).toBe(200);
  await fixture.operator.deactivate('other@lead-fixture.test');
  expect((await fixture.read(path, 'other')).status).toBe(401);
});

it('rejects unknown, duplicate and invalid matching parameters', async () => {
  const lead = await fixture.create();
  for (const query of [
    '',
    '?purpose=all',
    '?purpose=sale&purpose=rent',
    '?purpose=sale&maxPriceFils=1000000000001',
    '?purpose=sale&maxPriceFils=-1',
    '?purpose=sale&maxPriceFils=1.5',
    '?purpose=sale&location=%20',
    `?purpose=sale&location=${'x'.repeat(121)}`,
    '?purpose=sale&exactBedrooms=21',
    '?purpose=sale&exactBedrooms=',
    '?purpose=sale&type=condo',
    '?purpose=sale&page=0',
    '?purpose=sale&page=10001',
    '?purpose=sale&pageSize=1',
    '?purpose=sale&__proto__=bad',
  ]) {
    const response = await fixture.read(matchPath(lead.id, query));
    expect(response.status, query).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      requestId: expect.any(String),
    });
  }
});
