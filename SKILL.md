---
name: backend-entry
description: Use when starting backend work in this repository and choosing the relevant project implementation guidance.
---

# Backend entry

Start here for backend work. [AGENTS.md](AGENTS.md) owns project rules and required checks; feature specifications own requirements.

## Read the project context

1. Read the [project specification](spec.md) and affected [feature spec](specs/README.md).
2. Use the [spec template](specs/_template/spec.md) for new behavior.
3. Check [ROADMAP.md](ROADMAP.md) and [TECH_STACK.md](TECH_STACK.md) for implemented versus planned scope.

## Choose the workflow

- **Backend implementation:** Read [backend-development](.agents/skills/backend-development/SKILL.md) for module boundaries, middleware, selected write fields, readable grouping and verification.
- **Architecture and contracts:** Consult [architecture](docs/architecture.md) and the backend-owned [OpenAPI contract](docs/api/openapi.yaml).
- **Local setup, database and integration checks:** Follow [development](docs/development.md).

Use existing property/auth examples selectively; future features need their own permissions and contracts. Express owns business rules and persistence. Better Auth retains its native integration.

This root file is a repository entry linked from AGENTS.md. The discoverable skill lives under `.agents/skills`; this file does not replace its metadata or grant additional execution permissions.
