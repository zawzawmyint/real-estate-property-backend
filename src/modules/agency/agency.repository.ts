import { agencyCatalog } from './agency.catalog.js';

export function createAgencyRepository(
  readCatalog: () => unknown = () => agencyCatalog,
) {
  return { readCatalog };
}

export type AgencyRepository = ReturnType<typeof createAgencyRepository>;
