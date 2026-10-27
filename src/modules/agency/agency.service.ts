import { AppError } from '../../shared/errors/app-error.js';
import type { AgencyRepository } from './agency.repository.js';
import { agencyCatalogSchema, agentSlugSchema } from './agency.schema.js';
import {
  publicAgencyDto,
  publicAgentDetailDto,
  publicAgentSummaryDto,
} from './agency.dto.js';

export function createAgencyService(repository: AgencyRepository) {
  function content() {
    try {
      return agencyCatalogSchema.parse(repository.readCatalog());
    } catch {
      throw new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'Public agency content is unavailable',
      );
    }
  }

  return {
    agency() {
      return publicAgencyDto(content().agency);
    },

    agents() {
      // UTF-16 code-unit comparison is deterministic across deployment locales.
      const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      const items = content()
        .agents.filter((agent) => agent.published)
        .sort((a, b) => compare(a.name, b.name) || compare(a.slug, b.slug))
        .map(publicAgentSummaryDto);
      return { items, total: items.length };
    },

    agent(slug: unknown) {
      const catalog = content();
      const parsed = agentSlugSchema.safeParse(slug);
      const agent = parsed.success
        ? catalog.agents.find(
            (profile) => profile.published && profile.slug === parsed.data,
          )
        : undefined;
      if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');
      return publicAgentDetailDto(agent);
    },
  };
}

export type AgencyService = ReturnType<typeof createAgencyService>;
