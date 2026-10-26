# Backend code grouping

Status: Verified.

## Goal

Make authored backend code easier to scan using blank lines between logical sections, following the property route style approved by the user.

## Scope and exclusions

- In scope: review authored TypeScript in `src/`, `scripts/` and `tests/`; separate declarations, setup, guards, work and results when they represent distinct groups; separate helper functions and object methods; document the convention.
- Exclude generated code, dependencies, build output, database files and fixture data. No renames, reordered statements, new helpers, dependencies or formatter rules.

## Behavior and contracts

Only whitespace may change in TypeScript files. Preserve all code tokens, comments, execution order, endpoints, middleware order, permissions, database writes and operational commands. Existing contracts remain authoritative.

## Acceptance criteria

- [x] Logical sections are visually grouped without separating every individual statement.
- [x] Every reviewed TypeScript file retains its original non-whitespace source content, comments and syntax.
- [x] Backend lint, formatting, typecheck, tests and build pass.
- [x] Contribution guidance and specifications record the convention and verified scope.

## Validation

Captured the original 47 authored TypeScript files before edits. The local verifier compared TypeScript AST leaf text, collected comments and non-whitespace source before/after; 40 files were regrouped and all comparisons matched. Representative route, middleware, service, repository, infrastructure, operator script and test sections were reviewed. `bun run check` passed lint, formatting, typecheck, 59 tests in 14 files and the build. No behavior tests beyond the existing suite or database changes were needed for whitespace-only edits.

## Risks and rollout

Too much spacing can obscure related work. Keep short related declarations and operations together and review the result. Restore original whitespace from the local snapshot if needed; no deployment or migration changes are required.
