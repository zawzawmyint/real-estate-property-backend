import type { Logger } from 'pino';
import type { Env } from '../../config/env.js';
import type { createPropertyService } from '../properties/properties.service.js';
import type { PublicChatReplyHandler } from './public-chat.controller.js';
import { loadJsonFaqSearch } from './public-chat.faq.js';
import { createPublicChatUpstreamLimit } from './public-chat.limits.js';
import { createOpenRouterProviders } from './public-chat.providers.js';
import { createPublicChatService } from './public-chat.service.js';

export function configurePublicChat(
  env: Env,
  logger: Logger,
  searchProperties: ReturnType<typeof createPropertyService>['searchForChat'],
  fetchImpl?: typeof fetch,
): PublicChatReplyHandler | undefined {
  if (!env.PUBLIC_CHAT_ENABLED) return;
  if (!env.OPENROUTER_API_KEY) {
    logger.warn(
      'Property assistant unavailable because its API key is missing',
    );
    return;
  }

  let faqSearch: ReturnType<typeof loadJsonFaqSearch>;
  try {
    faqSearch = loadJsonFaqSearch(
      env.PUBLIC_CHAT_INDEX_PATH,
      env.OPENROUTER_EMBEDDING_MODEL,
    );
  } catch {
    logger.warn(
      'Property assistant unavailable because its FAQ index is invalid',
    );
    return;
  }

  const providers = createOpenRouterProviders({
    apiKey: env.OPENROUTER_API_KEY,
    chatModel: env.OPENROUTER_CHAT_MODEL,
    embeddingModel: env.OPENROUTER_EMBEDDING_MODEL,
    timeoutMs: 10_000,
    ...(fetchImpl ? { fetchImpl } : {}),
    beforeCall: createPublicChatUpstreamLimit(
      env.PUBLIC_CHAT_UPSTREAM_CALLS_PER_DAY,
    ),
  });
  return createPublicChatService({ ...providers, faqSearch, searchProperties })
    .reply;
}
