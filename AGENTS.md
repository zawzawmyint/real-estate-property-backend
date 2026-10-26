# Backend contribution instructions

Use [SKILL.md](SKILL.md) as the backend workflow entry point; it links the [backend development skill](.agents/skills/backend-development/SKILL.md) and project references.

Start with the [project specification](spec.md) for scope, boundaries and current status, then read the relevant feature spec before implementation. Keep the root spec synchronized after verified feature delivery.

This is an independent Express repository. Use Node 24.14.1 for runtime and Bun 1.3.14 for package management.

- Before feature code, write or update `specs/<feature-name>/spec.md`; see `specs/_template/spec.md`.
- Implement one feature slice at a time. Do not add speculative endpoints, models or infrastructure.
- Backend owns business logic, validation, permissions, persistence and API contracts. Frontend types will be generated from backend OpenAPI as business endpoints arrive.
- Keep routes thin and group related code under `src/modules/<feature>/`. Extract shared logic only for a current need.
- Use blank lines to separate logical sections such as setup, guards and validation, work or persistence, results, and named helper functions or object methods. Keep short related statements together, do not put a blank line after every statement, and preserve execution and middleware order.
- Agency business modules follow feature-local routes -> controller -> service -> repository -> Prisma. Routes attach named transport and access middleware in observable request-order; controllers handle HTTP input/output; services own business/resource permission rules and transaction coordination; repositories own database queries. Keep resource/state checks before upload body consumption. Pass transaction clients explicitly when needed. Use small functions/interfaces without generic base repositories or a DI container. Add files with real business behavior, never empty scaffolds.
- Use strict request schemas and explicit persistence mappers: never spread `req.body` or arbitrary runtime objects into Prisma write data. Preserve intentional `null`, `false` and `0` values while omitting only `undefined` fields.
- Better Auth's native handler/Prisma adapter and its auth/operator integration are deliberate exceptions to business-module layering. Do not rewrite credential/session endpoints into custom controllers/services/repositories. Health and public-media infrastructure are not agency business modules.
- Validate untrusted input. Do not return raw database records or private fields without an explicit response contract.
- Use the storage interface for public images. Never put private documents in the public storage root.
- Run `bun run check` and `bun run db:check` for foundation changes. Use meaningful regression checks for changed behavior.
- Reconcile specs, API documentation, environment examples and development instructions after verification. Do not tick acceptance criteria without evidence.
- Do not commit secrets, databases, uploads or generated files. Do not push without user authorization.

## Shared documentation maintenance

- Follow [workspace guidance](docs/shared/workspace-guidance.md). Track feature progress in [ROADMAP.md](ROADMAP.md) and tool adoption in [TECH_STACK.md](TECH_STACK.md).
- Edit shared documents in the frontend first, then synchronize the backend copies in the same delivery. Preserve repository-local links; do not create dependencies on a sibling checkout. Shared files are ROADMAP.md, TECH_STACK.md, docs/shared/* and docs/design/homepage-maroon-ivory-charcoal.png.
- Keep each repository's own feature specs authoritative. The homepage mockup records a design direction, not delivered behavior.
