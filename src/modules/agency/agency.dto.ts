import type { AgencyContent, AgentContent } from './agency.schema.js';

export function publicAgencyDto(agency: AgencyContent) {
  return {
    name: agency.name,
    isDemo: agency.isDemo,
    phone: agency.phone,
    email: agency.email,
    address: agency.address,
    officeHours: agency.officeHours.map((row) => ({
      days: row.days,
      hours: row.hours,
    })),
    timeZone: agency.timeZone,
    mapUrl: agency.mapUrl,
  };
}

export function publicAgentSummaryDto(agent: AgentContent) {
  return {
    slug: agent.slug,
    name: agent.name,
    title: agent.title,
    specialties: [...agent.specialties],
    portrait: agent.portrait
      ? {
          src: agent.portrait.src,
          width: agent.portrait.width,
          height: agent.portrait.height,
        }
      : null,
    isDemo: agent.isDemo,
  };
}

export function publicAgentDetailDto(agent: AgentContent) {
  return {
    ...publicAgentSummaryDto(agent),
    introduction: agent.introduction,
    biography: [...agent.biography],
    languages: [...agent.languages],
    publicPhone: agent.publicPhone,
    publicEmail: agent.publicEmail,
  };
}
