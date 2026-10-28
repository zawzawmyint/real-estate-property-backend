import request from 'supertest';
import { afterAll, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
import { createApp } from '../src/app.js';

const fixture = await authFixture();
afterAll(() => fixture.close());
const agency = {
  name: 'Agency',
  isDemo: true,
  phone: null,
  email: null,
  address: null,
  officeHours: [],
  timeZone: 'Asia/Dubai',
  mapUrl: null,
};
const profile = {
  slug: 'sample-agent',
  name: 'Sample Agent',
  title: 'Demo advisor',
  specialties: ['Homes'],
  portrait: {
    src: '/images/agents/sample-agent.webp',
    width: 800,
    height: 1000,
  },
  isDemo: true,
  introduction: 'Fictional introduction.',
  biography: ['Fictional biography.'],
  languages: ['English'],
  publicPhone: null,
  publicEmail: null,
  published: true,
};
function app(catalog: unknown) {
  return createApp(
    fixture.env,
    fixture.auth,
    fixture.database,
    undefined,
    () => catalog,
  );
}

it('publishes a safe demo catalog without actionable invented contacts', async () => {
  const agencyResponse = await request(fixture.app).get(
    '/api/v1/public/agency',
  );
  expect(agencyResponse.status).toBe(200);
  expect(agencyResponse.body).toEqual({ ...agency, name: 'Avenor Properties' });
  const directory = await request(fixture.app).get('/api/v1/public/agents');
  expect(directory.status).toBe(200);
  expect(
    directory.body.items.map((item: { slug: string }) => item.slug),
  ).toEqual(['amira-hassan', 'daniel-brooks', 'leila-mansour']);
  expect(directory.body.total).toBe(3);
  for (const item of directory.body.items) {
    expect(Object.keys(item).sort()).toEqual(
      ['slug', 'name', 'title', 'specialties', 'portrait', 'isDemo'].sort(),
    );
    expect(item.isDemo).toBe(true);
    const detail = await request(fixture.app).get(
      `/api/v1/public/agents/${item.slug}`,
    );
    expect(detail.body.publicPhone).toBeNull();
    expect(detail.body.publicEmail).toBeNull();
    expect(detail.headers['cache-control']).toBe('no-store');
  }
});

it('filters unpublished profiles, sorts by name then slug, and supports an empty directory', async () => {
  const application = app({
    agency,
    agents: [
      { ...profile, slug: 'z-agent', name: 'Zed' },
      { ...profile, slug: 'b-agent' },
      { ...profile, slug: 'a-agent' },
      { ...profile, slug: 'draft-agent', published: false },
    ],
  });
  const response = await request(application).get('/api/v1/public/agents');
  expect(response.status).toBe(200);
  expect(
    response.body.items.map((item: { slug: string }) => item.slug),
  ).toEqual(['a-agent', 'b-agent', 'z-agent']);
  expect(response.body.total).toBe(3);
  const detail = await request(application).get(
    '/api/v1/public/agents/a-agent',
  );
  expect(Object.keys(detail.body).sort()).toEqual(
    [
      'slug',
      'name',
      'title',
      'specialties',
      'portrait',
      'isDemo',
      'introduction',
      'biography',
      'languages',
      'publicPhone',
      'publicEmail',
    ].sort(),
  );
  for (const slug of ['draft-agent', 'unknown', 'UPPER', 'bad--slug']) {
    const missing = await request(application).get(
      `/api/v1/public/agents/${slug}`,
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe('Agent not found');
  }
  expect(
    (await request(app({ agency, agents: [] })).get('/api/v1/public/agents'))
      .body,
  ).toEqual({ items: [], total: 0 });
});

it('rejects every query key on content routes with no-store safe envelopes', async () => {
  for (const path of ['agency', 'agents', 'agents/amira-hassan']) {
    for (const query of ['?page=1', '?x=1&x=2']) {
      const response = await request(fixture.app).get(
        `/api/v1/public/${path}${query}`,
      );
      expect(response.status).toBe(400);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.error.requestId).toBe(
        response.headers['x-request-id'],
      );
    }
  }
});

it('returns the safe missing-agent response for invalid URI encoding', async () => {
  const response = await request(fixture.app).get(
    '/api/v1/public/agents/%E0%A4%A',
  );
  expect(response.status).toBe(404);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.error.message).toBe('Agent not found');
});

it('fails closed for invalid catalog bounds, contacts, publication flags and assets', async () => {
  const invalid = [
    {
      agency,
      agents: Array.from({ length: 25 }, (_, i) => ({
        ...profile,
        slug: `agent-${i}`,
      })),
    },
    { agency, agents: [profile, profile] },
    { agency, agents: [{ ...profile, published: 'yes' }] },
    { agency, agents: [{ ...profile, biography: [] }] },
    {
      agency,
      agents: [
        {
          ...profile,
          portrait: {
            ...profile.portrait,
            src: 'https://private.test/avatar.svg',
          },
        },
      ],
    },
    { agency, agents: [{ ...profile, publicEmail: 'invalid' }] },
    {
      agency: { ...agency, mapUrl: 'https://secret:password@example.test' },
      agents: [],
    },
    { agency: { ...agency, mapUrl: 'javascript:alert(1)' }, agents: [] },
    { agency: { ...agency, privateSecret: 'PRIVATE' }, agents: [] },
  ];
  for (const catalog of invalid) {
    const application = app(catalog);
    for (const path of ['agency', 'agents', 'agents/sample-agent']) {
      const response = await request(application).get(`/api/v1/public/${path}`);
      expect(response.status).toBe(503);
      expect(response.body.error.message).toBe(
        'Public agency content is unavailable',
      );
      expect(JSON.stringify(response.body)).not.toMatch(
        /PRIVATE|password|avatar/,
      );
    }
    expect((await request(application).get('/api/v1/health')).status).toBe(200);
  }
});
