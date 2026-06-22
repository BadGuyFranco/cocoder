---
id: 0028
title: Founder-facing run labels show the global runId (run_178) instead of the per-root run number (#1)
type: bug
status: Closed
priority: new-primary-root
owner: oscar run_177
created: 2026-06-22
---

# 0028 — Founder-facing run numbering should be per primary root

## Context
Job Hunt's very first onboarding run surfaced to the founder as **run_178**; the founder expected **#1**,
since run numbers are meant to be tied to the primary root. The data model already has both numbers:
- A **global** install-wide counter `run_${seq}` (`packages/core/src/store/sqlite-store.ts:146-149`,
  `run_counter` table) → `run_178`.
- A **per-root** `displayNumber` (`packages/core/src/runner/runner.ts:1118`), correctly `1` for this run;
  the portable run dir is `cocoder/runs/1-run_178/` and run.json carries `displayNumber: 1`.

The UI run list already renders the per-root number (`adapter.ts:238-239`: `displayName = "Run " +
displayNumber`). But many **founder-facing** surfaces still emit the global `run.id`:
- run record header `# Run ${run.id}` (`packages/core/src/runner/record.ts:27`),
- commit-message trailers `via CoCoder run ${run.id}` (`runner.ts:940,1078,1122`),
- oz-chat replies `${run.id} is ${run.status} …` (`packages/daemon/src/oz-chat.ts:401,412`),
- oz-host / context-pointer slug labels (`oz-host.ts:404`, `oz-context-pointer.ts:90`).

So the founder sees `run_178` in chat, the run record, and commit messages even though the canonical
per-root number is `1`.

## Proposal
Make founder-facing run labels use the **per-root display number** (e.g. "Run 1", or workspace-qualified
"job-hunt #1"), while keeping the global `run_${seq}` as the internal unique key (storage/joins/filenames
may keep it). Decide one founder-facing format and apply it consistently across the surfaces above; commit
trailers in particular should carry the per-root number (optionally alongside the global id for global
uniqueness, e.g. `run 1 (run_178)`), not the bare global id.

## Acceptance
- A fresh primary root's first run reads as **#1** (per-root) everywhere the founder sees it: run record
  header, oz-chat, run row, and commit-message trailers.
- The internal unique id is unaffected (no collisions across workspaces; storage/paths still resolve).
- A test pins that founder-facing run labels derive from `displayNumber`, not `run.id`.

## Refs
- Per-root number source: `runner.ts:1118` (`displayNumber`); UI already uses it: `adapter.ts:238-239`.
- Leaks to fix: `record.ts:27`; `runner.ts:940,1078,1122`; `oz-chat.ts:401,412`; `oz-host.ts:404`;
  `oz-context-pointer.ts:90`.
- Discovered: Job Hunt onboarding (run_178), founder run_177.

## Resolution

Resolved by run run_181 (b05027d10475421f111c80c50298543812bc0611) on 2026-06-22 (Atom G).

Founder-facing run labels now derive from the per-root `displayNumber` through a single shared owner (`runDisplayNumber`/`runDisplayName`/`coCoderRunReference` in core, plus the daemon `withPortableDisplayNumber` accessor) — reused by the run-record header, oz-chat replies, oz-host / context-pointer slug labels, the cmux group label, and the UI adapter (de-duped). Commit trailers read `run N (run_NNN)`, keeping the global `run_${seq}` parseable and intact as the internal key. A fresh root's first run reads as "Run 1" everywhere the founder sees it, with a run.id fallback when `displayNumber` is null; tests pin label derivation and the fallback.
