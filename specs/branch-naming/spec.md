# Pull request branch naming

Status: Implemented and locally verified; GitHub-hosted run and required-check activation pending.

## Goal

Require consistent source branch names before pull requests can merge into main.

## Scope

Add an independent GitHub Actions check for pull requests targeting main. Allow feat/, fix/, refactor/, docs/, test/, chore/ and ci/, followed by lowercase alphanumeric words separated by single hyphens. Do not rename existing branches or prevent branch creation. Application behavior, dependencies and existing CI remain unchanged.

## User flow

Opening, synchronizing, reopening or editing a pull request into main runs the Branch name check. Valid names pass; invalid names fail with the required format and an example. A repository administrator must select this check as required in the main ruleset after it has run on GitHub.

## Contracts and access

Input: github.head_ref passed through the PR_BRANCH environment variable. Output: a successful or failed Branch name status. No API or persistence contract changes. The workflow uses pull_request, empty token permissions, no checkout, no secrets and no external actions. Fork branches receive the same validation without executing their code.

## Design

Own the workflow within this repository at .github/workflows/branch-name.yml. Use the Ubuntu runner's Node runtime for inline validation; do not install dependencies. Keep the check name identical in both repositories.

## Acceptance criteria

- [x] All seven allowed prefixes accept lowercase hyphenated descriptions.
- [x] Missing/unknown prefixes, empty descriptions, uppercase, underscores, extra slashes and malformed hyphens fail.
- [x] Workflow targets PRs into main and runs on opened, synchronize, reopened and edited events without path filtering.
- [x] Untrusted branch names are passed as data and no PR code is executed.
- [x] Both repositories document manual required-check activation and existing branch compatibility.

## Validation

Parse the workflow YAML and execute its actual inline validator against positive, negative and hostile input cases. Run repository checks and review the final diff. Hosted event delivery and ruleset enforcement require a GitHub PR run after publication.

## Rollout and risks

Publish the workflow, let Branch name run on a PR into main, then add that check from GitHub Actions to Protect main alongside existing CI. Existing feature/... and automation branch names are not exempt; rename them to an allowed prefix before merging. Removing the required-check setting and workflow rolls back enforcement. Local delivery does not activate repository settings.

## Implementation evidence

The actual inline workflow validator and parsed YAML contract passed 39 positive, negative and hostile-input cases in this repository. Both workflow copies are identical. Lint, typecheck, 23 test files / 94 tests, production build and database verification passed. Local checkout CRLF endings were normalized to the committed LF content for formatting verification. No GitHub-hosted run or required-check activation claimed.
