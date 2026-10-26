# Backend development skill and entry

Status: Verified.

## Goal

Provide a backend workflow entry beside AGENTS.md and a discoverable development skill that follows the verified module architecture, write boundaries and code grouping style.

## Scope and exclusions

- Add `SKILL.md` beside `AGENTS.md` and `.agents/skills/backend-development/SKILL.md`; connect the entry from AGENTS.md.
- Reference existing project rules, specs, implementation examples, contracts and validation commands; record the user's logical blank-line grouping preference.
- Exclude application changes, new endpoints, dependencies, global skill installation, generated scaffolds, frontend edits and shared policy changes.

## Behavior and contracts

The root file is a repository entry document. The nested skill supplies discoverable `backend-development` metadata. AGENTS.md and feature specs remain authoritative. Preserve feature-local routes/middleware/controller/service/repository responsibilities, native Better Auth, live authorization, strict schemas, explicit write fields, safe response projections and backend-owned OpenAPI. Examples describe current property behavior without granting it to future features. Skills grant no extra external action permissions.

## Acceptance criteria

- [x] Root SKILL.md sits beside AGENTS.md and routes to the discoverable backend skill and authoritative references.
- [x] Skill metadata matches its directory and describes backend implementation scope.
- [x] Instructions cover readable grouping, thin routes, middleware ordering, service-owned permissions/transactions, explicit writes and native auth exceptions using real reference files.
- [x] Commands, local links and YAML metadata validate, and a realistic read-only scenario review exercises discovery and application.
- [x] Documentation records actual evidence and limitations; no application or API behavior changes.

## Validation

Baseline review confirmed the root entry and discoverable skill were absent. The completed files are `SKILL.md` and `.agents/skills/backend-development/SKILL.md`; `AGENTS.md` links both. The entry-to-skill review correctly applied thin routes, named middleware order, explicit write fields, actor identity for future ownership checks, and Better Auth's native boundary without inventing an ownership policy.

The local Node validator parsed both YAML front matters with Prettier's YAML parser, validated names and descriptions, confirmed 25 local Markdown links across the four related documents, and checked two documented package commands. Formatting checks passed for those documents. The bundled Python validator could not run because its `yaml` dependency is unavailable (`ModuleNotFoundError`); the Node validation is the recorded fallback. No application code, API contract, dependency or configuration changed, so application test and build reruns were unnecessary.

## Risks and rollout

Avoid duplicating full specifications or turning property-specific rules into universal feature requirements. Root entry files do not replace discoverable skill folders; new sessions may need to refresh skill discovery. Keep links and commands synchronized with delivered code. Rollback removes these documents and their AGENTS.md/index pointers without affecting runtime.
