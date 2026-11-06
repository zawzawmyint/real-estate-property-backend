# Public property chatbot API contract

Status: Implemented and verified for the opt-in demo. This document owns the backend contract. The repository-local frontend OpenAPI snapshot is synchronized with the canonical operation with its local property-summary reference adaptation.

## Request

`POST /api/v1/public/chat` accepts anonymous, same-origin JSON. The only field is `message`, a string trimmed to 1–500 characters. Cap the JSON body at 8 KiB. Use the existing trusted ingress conventions for request origin and client identity. Each request is independent and performs no business writes.

## Response

HTTP 200 returns `kind`, `message`, `sources` and `properties`.

- `kind` is `faq`, `properties`, `clarify` or `no_answer`.
- `message` is a plain-text answer or prompt of at most 1,500 characters.
- `sources` contains zero to three `{ id, title, path }` records. Only `faq` can return sources and it must return at least one. Paths come from the FAQ catalog and point to allowlisted public site routes.
- `properties` contains zero to three [public property summaries](../property-management/contract.md). Only `properties` can contain listing results. An empty array for that kind represents no available matches.

Use the existing safe API error envelope. Reject invalid JSON or fields with 400, untrusted ingress with 403, oversized bodies with 413, an unsupported content type with 415, and exhausted application or upstream quota with 429. Return 500 for an unexpected internal failure and 503 when disabled, timed out, missing its valid index/key, or unable to validate an upstream response. The frontend offers the existing listings and Contact routes as fallback navigation. FAQ source paths are limited to `/contact` and `/properties`.
