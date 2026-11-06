import { join } from 'node:path';
import { writeJsonFaqIndex } from '../src/modules/public-chat/public-chat.faq.js';
import type { Database } from '../src/infrastructure/database/transaction.js';
import { propertySearchFields } from '../src/modules/properties/property-search.js';

const viewingQuestion = 'How do I arrange a viewing?';
const propertyQuestion =
  'Find me a 2-bedroom rental in Dubai Marina under AED 120,000 a year.';
const viewingAnswer =
  'Open the listing and use its inquiry form to request a viewing. An agent can confirm available times.';
const embeddingModel = 'fixture/embeddings';

function chatResponse(content: object) {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
}

const fixtureFetch: typeof fetch = async (input, init) => {
  if (input === 'https://openrouter.ai/api/v1/embeddings')
    return Response.json({ data: [{ index: 0, embedding: [1, 0] }] });

  if (
    input !== 'https://openrouter.ai/api/v1/chat/completions' ||
    typeof init?.body !== 'string'
  )
    throw new Error('Unexpected chat fixture request');

  const { messages } = JSON.parse(init.body) as {
    messages: { content: string }[];
  };
  const question = messages[1]?.content;

  switch (question) {
    case viewingQuestion:
      return chatResponse({ kind: 'faq' });
    case propertyQuestion:
      return chatResponse({
        kind: 'properties',
        filters: {
          purpose: 'rent',
          location: 'Dubai Marina',
          exactBedrooms: 2,
          maxPriceFils: 12_000_000,
        },
      });
    case 'Chat fixture outage':
      return new Response(null, { status: 503 });
    case 'Chat fixture clarification':
      return chatResponse({ kind: 'clarify' });
    case 'Chat fixture no matches':
      return chatResponse({
        kind: 'properties',
        filters: { location: 'Unmatched fixture location' },
      });
    default:
      if (question?.startsWith('{"question":')) {
        const context = JSON.parse(question) as { question: string };
        if (context.question === viewingQuestion)
          return chatResponse({
            message: viewingAnswer,
            sourceIds: ['viewings'],
          });
      }
      return chatResponse({ kind: 'no_answer' });
  }
};

export async function preparePublicChatFixture(directory: string) {
  const indexPath = join(directory, 'faq-index.json');
  await writeJsonFaqIndex(
    indexPath,
    [
      {
        id: 'viewings',
        title: 'Contact Avenor Properties',
        path: '/contact',
        text: viewingAnswer,
      },
    ],
    embeddingModel,
    async () => [[1, 0]],
  );

  return {
    fetch: fixtureFetch,
    env: {
      PUBLIC_CHAT_ENABLED: 'true',
      OPENROUTER_API_KEY: 'fixture-key',
      OPENROUTER_CHAT_MODEL: 'fixture/chat',
      OPENROUTER_EMBEDDING_MODEL: embeddingModel,
      PUBLIC_CHAT_INDEX_PATH: indexPath,
      PUBLIC_CHAT_UPSTREAM_CALLS_PER_DAY: '200',
    },
  };
}

export async function preparePublicChatListing(database: Database) {
  const title = 'Marina View Apartment';
  await database.property.update({
    where: { demoKey: 'avenor-demo-v1:marina-rental' },
    data: {
      title,
      ...propertySearchFields({ title }),
      description:
        'Fictional browser fixture for a two-bedroom rental in Dubai Marina.',
      bedrooms: 2,
      priceFils: 11_500_000n,
    },
  });
}
