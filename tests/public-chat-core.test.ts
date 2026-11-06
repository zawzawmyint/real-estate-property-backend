import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  loadJsonFaqSearch,
  writeJsonFaqIndex,
  type FaqPassage,
} from '../src/modules/public-chat/public-chat.faq.js';
import { createOpenRouterProviders } from '../src/modules/public-chat/public-chat.providers.js';
import { createPublicChatService } from '../src/modules/public-chat/public-chat.service.js';

const viewing: FaqPassage = {
  id: 'viewing',
  title: 'Request a viewing',
  path: '/contact',
  text: 'Submit a property inquiry. An agent can confirm viewing times.',
};
const listings: FaqPassage = {
  id: 'listings',
  title: 'Browse listings',
  path: '/properties',
  text: 'Filter public listings by area, bedrooms and budget.',
};

describe('public chat service', () => {
  function setup() {
    const generation = {
      classify: vi.fn(async (): Promise<unknown> => ({ kind: 'faq' })),
      answerFaq: vi.fn(async (): Promise<unknown> => ({
        message:
          'An agent can confirm viewing times after you submit an inquiry.',
        sourceIds: ['viewing'],
      })),
    };
    const embedding = { embed: vi.fn(async () => [1, 0]) };
    const faqSearch = { find: vi.fn(async () => [viewing]) };
    const searchProperties = vi.fn(async () => []);
    const service = createPublicChatService({
      generation,
      embedding,
      faqSearch,
      searchProperties,
    });

    return { service, generation, embedding, faqSearch, searchProperties };
  }

  it('returns a FAQ answer with catalog source metadata only', async () => {
    const { service, generation, embedding, faqSearch, searchProperties } =
      setup();
    const question = 'Can I come see a home?';

    await expect(service.reply(question)).resolves.toEqual({
      kind: 'faq',
      message:
        'An agent can confirm viewing times after you submit an inquiry.',
      sources: [
        { id: 'viewing', title: 'Request a viewing', path: '/contact' },
      ],
      properties: [],
    });
    expect(embedding.embed).toHaveBeenCalledWith(question);
    expect(faqSearch.find).toHaveBeenCalledWith([1, 0]);
    expect(generation.answerFaq).toHaveBeenCalledWith(question, [viewing]);
    expect(searchProperties).not.toHaveBeenCalled();
  });

  it('skips generation on weak retrieval and withholds unverifiable citations', async () => {
    const { service, generation, faqSearch } = setup();
    faqSearch.find.mockResolvedValueOnce([]);
    await expect(service.reply('What about access?')).resolves.toMatchObject({
      kind: 'no_answer',
      sources: [],
    });
    expect(generation.answerFaq).not.toHaveBeenCalled();

    generation.answerFaq.mockResolvedValueOnce({
      message: 'Invented reply',
      sourceIds: ['fabricated'],
    });
    await expect(service.reply('Can I visit?')).resolves.toMatchObject({
      kind: 'no_answer',
      sources: [],
    });
  });

  it('clarifies an omitted rent period even when the model assumes yearly', async () => {
    const { service, generation, searchProperties } = setup();
    generation.classify.mockResolvedValue({
      kind: 'properties',
      filters: { purpose: 'rent', maxPriceFils: 1_000_000 },
    });

    await expect(service.reply('Rent under AED 10,000')).resolves.toMatchObject(
      {
        kind: 'clarify',
        message: 'Is your rental budget per month or per year?',
      },
    );
    expect(searchProperties).not.toHaveBeenCalled();
  });

  it('annualizes a stated monthly rent and preserves exact bedroom count', async () => {
    const { service, generation, searchProperties, embedding } = setup();
    generation.classify.mockResolvedValue({
      kind: 'properties',
      filters: { purpose: 'rent', maxPriceFils: 1_000_000, exactBedrooms: 2 },
    });

    await expect(
      service.reply('Rent a 2-bedroom for AED 10,000 per month'),
    ).resolves.toMatchObject({ kind: 'properties' });
    expect(searchProperties).toHaveBeenCalledWith({
      purpose: 'rent',
      maxPriceFils: 12_000_000,
      exactBedrooms: 2,
    });
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it.each([
    { purpose: 'rent', availability: 'rented' },
    { purpose: 'sale', minPriceFils: 1000, maxPriceFils: 10 },
    { purpose: 'rent', minBedrooms: 3, exactBedrooms: 2 },
  ])(
    'rejects invalid model filters before any listing read (%j)',
    async (filters) => {
      const { service, generation, searchProperties } = setup();
      generation.classify.mockResolvedValue({ kind: 'properties', filters });

      await expect(service.reply('Find a home')).rejects.toMatchObject({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
      });
      expect(searchProperties).not.toHaveBeenCalled();
    },
  );
});

describe('JSON FAQ index', () => {
  it('includes demo FAQ paraphrase scores and excludes unrelated scores', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agency-chat-index-'));
    const path = join(directory, 'index.json');
    try {
      await writeJsonFaqIndex(path, [viewing], 'embed-a', async () => [[1, 0]]);
      const search = loadJsonFaqSearch(path, 'embed-a');
      const atCosine = (score: number) => [score, Math.sqrt(1 - score ** 2)];

      await expect(search.find(atCosine(0.273))).resolves.toEqual([viewing]);
      await expect(search.find(atCosine(0.128))).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('ranks by cosine, refuses incompatible vectors, and preserves a valid index after a failed rebuild', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agency-chat-index-'));
    const path = join(directory, 'index.json');
    try {
      await writeJsonFaqIndex(
        path,
        [viewing, listings],
        'embed-a',
        async () => [
          [2, 0],
          [0, 1],
        ],
      );
      const search = loadJsonFaqSearch(path, 'embed-a');

      await expect(search.find([5, 0.1])).resolves.toEqual([viewing]);
      await expect(search.find([-1, -1])).resolves.toEqual([]);
      await expect(search.find([1])).rejects.toMatchObject({ status: 503 });
      expect(() => loadJsonFaqSearch(path, 'embed-b')).toThrow('incompatible');

      const original = await readFile(path, 'utf8');
      await expect(
        writeJsonFaqIndex(path, [viewing], 'embed-a', async () => [[0, 0]]),
      ).rejects.toThrow();
      await expect(readFile(path, 'utf8')).resolves.toBe(original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('OpenRouter adapters', () => {
  it('uses separate configurable models and charges each upstream call', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: '{"kind":"faq"}' } }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ index: 0, embedding: [1, 0] }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
      );
    const beforeCall = vi.fn();
    const { generation, embedding } = createOpenRouterProviders({
      apiKey: 'fixture-key',
      chatModel: 'chat-model',
      embeddingModel: 'embed-model',
      timeoutMs: 1000,
      beforeCall,
      fetchImpl,
    });

    await expect(generation.classify('Can I visit?')).resolves.toEqual({
      kind: 'faq',
    });
    await expect(embedding.embed('Can I visit?')).resolves.toEqual([1, 0]);
    await expect(embedding.embedDocuments(['FAQ 1', 'FAQ 2'])).resolves.toEqual(
      [
        [1, 0],
        [0, 1],
      ],
    );
    expect(beforeCall).toHaveBeenCalledTimes(3);
    expect(
      fetchImpl.mock.calls.map(([url, init]) => [
        url,
        JSON.parse(String(init?.body)).model,
      ]),
    ).toEqual([
      ['https://openrouter.ai/api/v1/chat/completions', 'chat-model'],
      ['https://openrouter.ai/api/v1/embeddings', 'embed-model'],
      ['https://openrouter.ai/api/v1/embeddings', 'embed-model'],
    ]);
  });

  it('hides provider response bodies and handles rate limits and timeouts separately', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('sensitive upstream detail', { status: 429 }),
      )
      .mockImplementationOnce((_url, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error('Expected an upstream timeout signal');
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      });
    const { generation, embedding } = createOpenRouterProviders({
      apiKey: 'fixture-key',
      chatModel: 'chat-model',
      embeddingModel: 'embed-model',
      timeoutMs: 10,
      fetchImpl,
    });

    await expect(generation.classify('Can I visit?')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Property assistant is busy; try again later',
    });
    await expect(embedding.embed('Can I visit?')).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Property assistant unavailable',
    });
    expect(fetchImpl.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  });
});
