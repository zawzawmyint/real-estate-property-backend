# Public agency directory languages — delivered API delta

Status: Delivered 2026-11-02. Baseline authority: [public-contact-and-agents/contract.md](../public-contact-and-agents/contract.md), which now includes this additive field.

## Endpoint and shape

Anonymous `GET /api/v1/public/agents`, existing no-store JSON response and error envelopes:

```ts
type PublicAgentSummary = {
  slug: string;
  name: string;
  title: string;
  specialties: string[];
  languages: string[];
  portrait: { src: string; width: number; height: number } | null;
  isDemo: boolean;
};
type PublicAgentList = { items: PublicAgentSummary[]; total: number };
```

`languages` is an ordered copy of the validated public catalog array: 0–8 values, each trimmed plain-text string of 1–80 characters. Empty is `[]`, never `null`, invented English or an omitted field in the new backend response. No new query parameters or request body.

## Preserved behavior and privacy

Retain published-only filtering, name/slug ordering, maximum 24 profiles, `total === items.length`, valid empty 200 and invalid-catalog 503. Do not expose staff account fields, publication flags, biography, public direct channels or activity/lead data in summaries.

`GET /api/v1/public/agents/:slug` is unchanged on the wire: it already returns `languages`. `GET /api/v1/public/agency` and `POST /api/v1/public/inquiries` remain exactly as specified in the baseline contract. No assigned/preferred agent ID is introduced.

## Compatibility and contract synchronization

The field is additive; old clients can ignore it. Ship backend first. New frontend presentation should tolerate a temporarily missing/empty array by omitting the row, without detail fan-out or fabricated content.

The implementation updates `src/modules/agency/agency.dto.ts`, `docs/api/openapi.yaml` and the baseline backend contract. The frontend-local contract/OpenAPI snapshots and generated `src/lib/api/generated/public-agency.d.ts` are synchronized. This remains an additive contract note rather than a second independent inquiry contract.
