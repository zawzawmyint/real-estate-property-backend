import { z } from 'zod';
import {
  propertyTypes,
  purposes,
  type ChatPropertyFilters,
} from '../properties/properties.schema.js';
import type { PropertyService } from '../properties/properties.service.js';
import { publicChatUnavailable } from './public-chat.errors.js';
import type { FaqPassage, FaqSearch } from './public-chat.faq.js';

type PublicPropertySummary = Awaited<
  ReturnType<PropertyService['searchForChat']>
>[number];
type ChatSource = Pick<FaqPassage, 'id' | 'title' | 'path'>;

export type PublicChatReply = {
  kind: 'faq' | 'properties' | 'clarify' | 'no_answer';
  message: string;
  sources: ChatSource[];
  properties: PublicPropertySummary[];
};

export interface ChatGeneration {
  classify(message: string): Promise<unknown>;
  answerFaq(
    question: string,
    passages: readonly FaqPassage[],
  ): Promise<unknown>;
}

export interface EmbeddingModel {
  embed(text: string): Promise<number[]>;
}

type ChatDependencies = {
  generation: ChatGeneration;
  embedding: EmbeddingModel;
  faqSearch: FaqSearch;
  searchProperties(
    filters: ChatPropertyFilters,
  ): Promise<PublicPropertySummary[]>;
};

const maxPrice = 1_000_000_000_000;
const price = z.number().int().min(0).max(maxPrice);
const bedrooms = z.number().int().min(0).max(20);
const propertyFilters = z
  .strictObject({
    purpose: z.enum(purposes).optional(),
    type: z.enum(propertyTypes).optional(),
    location: z.string().trim().min(1).max(120).optional(),
    minBedrooms: bedrooms.optional(),
    exactBedrooms: bedrooms.optional(),
    minPriceFils: price.optional(),
    maxPriceFils: price.optional(),
  })
  .refine(
    (filters) =>
      (filters.minPriceFils ?? 0) <= (filters.maxPriceFils ?? maxPrice) &&
      (filters.minBedrooms === undefined ||
        filters.exactBedrooms === undefined),
  );
const classification = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('properties'), filters: propertyFilters }),
  z.strictObject({ kind: z.literal('faq') }),
  z.strictObject({ kind: z.literal('clarify') }),
  z.strictObject({ kind: z.literal('no_answer') }),
]);
const faqAnswer = z.strictObject({
  message: z.string().trim().min(1).max(1500),
  sourceIds: z.array(z.string().min(1).max(64)).max(3),
});

function noAnswer(): PublicChatReply {
  return {
    kind: 'no_answer',
    message:
      'I don’t have a verified answer. Please contact the agency for help.',
    sources: [],
    properties: [],
  };
}

function clarify(message: string): PublicChatReply {
  return { kind: 'clarify', message, sources: [], properties: [] };
}

function listingBudget(message: string, filters: ChatPropertyFilters) {
  if (filters.minPriceFils === undefined && filters.maxPriceFils === undefined)
    return filters;

  if (!filters.purpose) return clarify('Are you looking to rent or buy?');
  if (filters.purpose === 'sale') return filters;

  const monthly =
    /\b(?:monthly|pcm|per\s+month|a\s+month)\b|\/\s*(?:mo|month)\b/i.test(
      message,
    );
  const yearly =
    /\b(?:annual(?:ly)?|yearly|per\s+(?:year|annum)|a\s+year)\b|\/\s*(?:yr|year)\b/i.test(
      message,
    );

  if (monthly === yearly)
    return clarify('Is your rental budget per month or per year?');
  if (yearly) return filters;

  const min =
    filters.minPriceFils === undefined ? undefined : filters.minPriceFils * 12;
  const max =
    filters.maxPriceFils === undefined ? undefined : filters.maxPriceFils * 12;

  if ((min ?? 0) > maxPrice || (max ?? 0) > maxPrice)
    return clarify('Could you enter an annual rental budget in AED?');

  return {
    ...filters,
    ...(min === undefined ? {} : { minPriceFils: min }),
    ...(max === undefined ? {} : { maxPriceFils: max }),
  };
}

export function createPublicChatService({
  generation,
  embedding,
  faqSearch,
  searchProperties,
}: ChatDependencies) {
  async function replyFromFaq(question: string): Promise<PublicChatReply> {
    const vector = await embedding.embed(question);
    const passages = (await faqSearch.find(vector)).slice(0, 3);

    if (passages.length === 0) return noAnswer();

    const answer = faqAnswer.safeParse(
      await generation.answerFaq(question, passages),
    );

    if (!answer.success) throw publicChatUnavailable();

    const byId = new Map(passages.map((passage) => [passage.id, passage]));
    const sources: ChatSource[] = [];
    for (const sourceId of new Set(answer.data.sourceIds)) {
      const source = byId.get(sourceId);
      if (!source) return noAnswer();
      sources.push({ id: source.id, title: source.title, path: source.path });
    }

    if (sources.length === 0) return noAnswer();

    return {
      kind: 'faq',
      message: answer.data.message,
      sources,
      properties: [],
    };
  }

  return {
    async reply(message: string): Promise<PublicChatReply> {
      const result = classification.safeParse(
        await generation.classify(message),
      );

      if (!result.success) throw publicChatUnavailable();
      if (result.data.kind === 'faq') return replyFromFaq(message);
      if (result.data.kind === 'no_answer') return noAnswer();
      if (result.data.kind === 'clarify')
        return clarify(
          'Could you rephrase your question or include more details about the property you want?',
        );

      const { exactBedrooms, ...otherFilters } = result.data.filters;
      const filters = listingBudget(message, {
        ...otherFilters,
        ...(exactBedrooms === undefined ? {} : { exactBedrooms }),
      });
      if ('kind' in filters) return filters;

      const properties = (await searchProperties(filters)).slice(0, 3);

      return {
        kind: 'properties',
        message:
          properties.length > 0
            ? 'Here are the available properties that match your search.'
            : 'I found no available properties with those filters. Try another location or budget.',
        sources: [],
        properties,
      };
    },
  };
}
