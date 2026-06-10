# Contributing

CoCoder is solo-maintained early-stage OSS. Outside contributions are welcome; this document covers how to make them land.

## Before you open a change

1. **Read the orientation chain:** [`AGENTS.md`](./AGENTS.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), and the roadmap in [`cocoder/PLAYBOOK.md`](./cocoder/PLAYBOOK.md). Most "is this the right thing to build" questions are already answered there.
2. **Check existing work:** scan open [issues](https://github.com/BadGuyFranco/cocoder/issues), [PRs](https://github.com/BadGuyFranco/cocoder/pulls), and recent entries in [`cocoder/SESSION_LOG.md`](./cocoder/SESSION_LOG.md). The proposal you have in mind may already be in flight or deliberately deferred.
3. **For non-trivial changes, open a Discussion or Feature Request first.** Saves you from writing code that doesn't fit the current Sub-Playbook scope. Small bug fixes and obvious typo corrections can go straight to PR.

## How to make changes

1. **Fork + branch.** Branch names like `fix/short-description` or `feature/short-description` keep history scannable; this is a recommendation, not a hard rule.
2. **Match the existing style.** All packages are TypeScript: `packages/core/` (engine), `packages/adapters/`, `packages/session-hosts/`, `packages/daemon/` (Oz), `packages/cli/`, `packages/ui/` (dashboard), `packages/personas/` (shipped base) — inward-only deps, enforced by `scripts/check-topology.mjs`.
3. **Write tests where behavior changes.** `node:test` for `.mjs` packages, `vitest` for TS packages. Source-grep tests are not accepted as runtime tests — see [ADR-0004](./cocoder/zArchive/v1/decisions/0004-typescript-validation-toolchain.md) and the M4.26 / Q5 lineage in [`cocoder/SESSION_LOG.md`](./cocoder/SESSION_LOG.md) for the reasoning.
4. **Update docs in the same PR.** Anything that affects behavior described in `docs/`, an ADR, or the active Playbook needs the docs touched in the same change set. A future `cocoder lint` (v0.2) will enforce this automatically; today it's a review check.
5. **Run the local gate:**

   ```sh
   pnpm install
   pnpm -F schemas build
   pnpm -r test
   node packages/core/cli.mjs validate-contracts
   ```

   CI runs these plus the stale-reference gate (`rg 'cobuilder|COB_ORCH_'` / `rg '/Volumes/'` in shipped packages). All must be green before merge.

## Commit + PR conventions

- **Commit messages:** short imperative subject, optional body explaining *why*. Don't restate the diff. Reference the issue, ADR, audit finding, or Playbook task the change addresses.
- **One concern per PR.** Two unrelated fixes get separate PRs. Makes review fast and reverts safe.
- **PR template:** the auto-loaded `pull_request_template.md` lists the checklist. Skipping items is fine when not applicable; deleting the headings makes review harder.

## Boundaries

The following are never accepted in tracked files:

- `local/` contents or run artifacts (everything under `<install>/local/` and gitignored zones).
- Secrets, API keys, passwords, OAuth tokens — anywhere, including comments, examples, and tests. Use `*.example.*` files with placeholder values.
- Machine-specific absolute paths (`/Volumes/...`, `/Users/...`) outside `*.example.*` files.
- Upstream CoBuilder-private references (`cobuilder-build/`, `COB_ORCH_*`) in shipped packages, except where the leakage scanner itself is detecting them.

## Reviewing

- The maintainer (currently @BadGuyFranco) reviews every PR.
- Approval requires CI green + at least one round of review discussion if changes are requested.
- Reviews aim to merge in ≤7 days; if your PR sits longer, ping it.

## Reporting bugs and proposing features

Use the [Issues tab](https://github.com/BadGuyFranco/cocoder/issues). Templates for bug reports and feature requests load automatically. For questions and design discussions use [Discussions](https://github.com/BadGuyFranco/cocoder/discussions). For security reports follow [`SECURITY.md`](./SECURITY.md).

## Code of Conduct

By participating you agree to follow [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). It's short: be direct, respectful, focused on the work.
