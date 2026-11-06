import request from 'supertest';
import { expect, it } from 'vitest';
import { LocalStorage } from '../src/infrastructure/storage/local-storage.js';
import { seedDemoProperties } from '../src/modules/properties/demo-seed.js';
import { authFixture } from './auth-fixture.js';
import { preparePublicChatListing } from './public-chat-fixture.js';

it('uses the real app, provider adapters and FAQ index with an isolated chat fixture', async () => {
  const fixture = await authFixture({ publicChat: true });
  const post = (message: string) =>
    request(fixture.app)
      .post('/api/v1/public/chat')
      .set('Origin', fixture.env.APP_ORIGIN)
      .send({ message });

  try {
    await seedDemoProperties(
      fixture.database,
      new LocalStorage(fixture.env.STORAGE_ROOT, fixture.env.PUBLIC_ORIGIN),
    );
    await preparePublicChatListing(fixture.database);

    const faq = await post('How do I arrange a viewing?');
    expect(faq.status).toBe(200);
    expect(faq.body).toMatchObject({
      kind: 'faq',
      sources: [{ path: '/contact', title: 'Contact Avenor Properties' }],
    });

    const listing = await post(
      'Find me a 2-bedroom rental in Dubai Marina under AED 120,000 a year.',
    );
    expect(listing.status).toBe(200);
    expect(listing.body).toMatchObject({
      kind: 'properties',
      properties: [
        {
          title: 'Marina View Apartment',
          bedrooms: 2,
          priceFils: 11_500_000,
        },
      ],
    });

    const clarify = await post('Chat fixture clarification');
    expect(clarify.status).toBe(200);
    expect(clarify.body).toMatchObject({ kind: 'clarify' });

    const empty = await post('Chat fixture no matches');
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ kind: 'properties', properties: [] });

    const outage = await post('Chat fixture outage');
    expect(outage.status).toBe(503);
    expect(outage.body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(await fixture.database.lead.count()).toBe(0);
  } finally {
    await fixture.close();
  }
});
