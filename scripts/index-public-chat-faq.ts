import { readFile } from 'node:fs/promises';
import { parseEnv } from '../src/config/env.js';
import { writeJsonFaqIndex } from '../src/modules/public-chat/public-chat.faq.js';
import { createOpenRouterProviders } from '../src/modules/public-chat/public-chat.providers.js';

const env = parseEnv(process.env);
if (!env.OPENROUTER_API_KEY)
  throw new Error('Set OPENROUTER_API_KEY to index FAQs.');

const catalogPath = new URL(
  '../fixtures/public-chat/faqs.json',
  import.meta.url,
);
const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as unknown;
const { embedding } = createOpenRouterProviders({
  apiKey: env.OPENROUTER_API_KEY,
  chatModel: env.OPENROUTER_CHAT_MODEL,
  embeddingModel: env.OPENROUTER_EMBEDDING_MODEL,
  timeoutMs: 20_000,
});

const result = await writeJsonFaqIndex(
  env.PUBLIC_CHAT_INDEX_PATH,
  catalog,
  env.OPENROUTER_EMBEDDING_MODEL,
  embedding.embedDocuments,
);
console.info(
  `Indexed ${result.entries} public FAQ passages (${result.dimensions} dimensions).`,
);
