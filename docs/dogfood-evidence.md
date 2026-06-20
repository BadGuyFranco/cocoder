# Dogfood Evidence

**Status:** Pointer (v2)
**Last verified:** 2026-06-20

CoCoder is built through its own orchestration loop in the **dogfood workspace** — the tracked
`cocoder/` governance directory inside this very repo, which has the identical shape to any managed
repo's `cocoder/`. This page does not maintain its own narrative evidence log. Instead it points at
where current, verifiable evidence lives, so there is one source per fact.

> The earlier version of this page summarized v1 "Sub-Playbook" runs (run ids, PR numbers, a four-zone
> storage model with `cocoder/local/`). That content predates the v2 rebuild and has been removed rather
> than left to drift. The v1 evidence trail is preserved under `cocoder/SESSION_LOG_ARCHIVE.md` and
> `cocoder/zArchive/`.

## Where evidence lives now

| Evidence | Source |
|---|---|
| Real-path proofs — one runnable script per priority, each emitting a PASS/FAIL table over the *real* daemon/core suites and build gate | `scripts/proof-*.mjs` (e.g. `scripts/proof-plays.mjs`, `scripts/proof-drift-audit.mjs`, `scripts/proof-governance-authoring.mjs`, `scripts/proof-onboard-existing.mjs`, `scripts/proof-oz-surfaces.mjs`) |
| Automated tests | `packages/*/tests/` (vitest), run via `pnpm test` |
| Static gates | `pnpm typecheck` and `node scripts/check-topology.mjs` |
| Decisions of record | `cocoder/decisions/` (authoritative ADR index: `cocoder/decisions/README.md`) |
| Append-only work log | `cocoder/SESSION_LOG.md` (+ `cocoder/SESSION_LOG_ARCHIVE.md`) |
| Observed failures that earned guardrails | `cocoder/failure-catalog.md` |

The proof scripts are the v2 evidence primitive: each turns a priority's "Verified when" into a single
command with a PASS/FAIL table. They do not reimplement orchestration logic — they run the real suites
and check only the declared surfaces, then run the real build gate last. Green rows mean the behavior is
exercised end-to-end; a red row names the specific failing suite, missing test, or failed build to fix.

## Storage zones (current)

The dogfood exercises the **three storage zones** documented in
[ARCHITECTURE.md](../ARCHITECTURE.md) and [ADR-0008](../cocoder/decisions/0008-repository-topology.md):

1. **Install repo (tracked)** — `packages/`, `docs/`, `templates/`, and `cocoder/` (the dogfood
   workspace's own governance).
2. **`<CoCoder>/local/` (gitignored)** — the one machine-local zone, spanning all workspaces: the
   Oz-owned DB, run artifacts, secrets, and workspace definition files.
3. **Each managed repo's tracked `cocoder/`** — that workspace's governance.

There is no `cocoder/local/` zone.

## Oz observability

Oz is the cross-session control-plane persona; its operator surface is documented (not duplicated here)
in:

- [`docs/oz.md`](./oz.md)
- [`docs/oz-launch.md`](./oz-launch.md)
- [`docs/oz-security-checklist.md`](./oz-security-checklist.md)

`scripts/proof-oz-surfaces.mjs` and `scripts/proof-oz-awareness.mjs` are the runnable evidence for Oz's
surfaces.

## Honest limitation

This is internal dogfood evidence — the product building itself — not an external user study. Read the
proof scripts and test suites for the current state of any specific claim rather than relying on a
prose summary here.
