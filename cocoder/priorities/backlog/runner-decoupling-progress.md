# Runner decoupling — progress ledger

Newest entry on top. Each independent session appends one entry, then hands back the next session's
prompt. Priority spec: `cocoder/priorities/backlog/runner-decoupling-refactor.md`. **Do not orchestrate
this work** — independent Claude Code sessions only.

## Next-session prompt template

When you finish a session, fill this in and paste it into your final message for the founder to copy into
a fresh session:

```
You are running ONE independent, non-orchestrated engineering session on the CoCoder repo at
/Volumes/NAS LOCAL/CoCoder (branch main). You are NOT inside CoCoder orchestration — do not use the
runner, the Oz daemon, the Oscar/Bob/Deb loop, or any directive/handoff files. Work directly in the repo
as a normal single-writer engineering session.

Read, in order:
  1. cocoder/priorities/backlog/runner-decoupling-refactor.md  (the priority + EXECUTION CONSTRAINT + per-session protocol)
  2. cocoder/priorities/backlog/runner-decoupling-progress.md  (the ledger; the top entry is where you start)

Your task this session: <WORKSTREAM + the exact next step from the top ledger entry>.

Follow the per-session protocol exactly: map owners/emitters/consumers/tests before editing; implement
tests-first; keep the suite green; verify with the listed commands; preserve unrelated dirty work; commit
ONLY this chunk; append a new ledger entry; and END by handing me a filled-in copy of this prompt for the
next session. Do not start the following chunk in this session.
```

---

## 2026-06-24 — WS1, step 1 (terminal projection seed + derivability test)

- **Workstream/step:** WS1 (Surface unification), step 1 — treat `renderDebStatus` as canonical and prove a
  terminal run's `DebStatus` is derivable from the event log alone; land the inventory + test before moving
  any writes.
- **Commit:** `9aa90e3` — "runner(status): WS1.1 — terminal DebStatus projection seed + derivability test".
- **Files:** `packages/core/src/runner/status.ts` (added `deriveTerminalProjection` + inventory comment),
  `packages/core/src/index.ts` + `packages/core/src/runner/index.ts` (re-export it),
  `packages/core/tests/status.test.ts` (new `deriveTerminalProjection — WS1 terminal projection seed`
  describe: 5 tests).
- **Map (owners/emitters/consumers/tests):**
  - *Owner/projection:* `renderDebStatus` in `status.ts` — pure over `store.listEvents`, but takes four
    run-state inputs imperatively.
  - *Sole emitter of those inputs:* `runner.ts` via `writeDebEvidence`/`refreshStatus`
    (`runner.ts:1128,1175`); ~10 call sites pass `(phase, activeAtom, activeTask, waitCondition)`.
  - *Terminal call sites:* `fail()` `runner.ts:1059` → `('faulted', atomIndex, null, prose)`. **`holdRun`
    (`runner.ts:1712`) and `stopRun` (`runner.ts:1672`) call `refreshStatus` NOT AT ALL** — they only record
    `run-held {park, atom}` / `run-stopped {atom}` + `run-end {status}`, so the status feed keeps a stale
    pre-terminal phase. That stale-feed gap is the WS1 prize for held/stopped.
  - *Consumer:* Deb's status feed (ADR-0016); `record.ts` / `writePortableRunHistory` are the sibling
    surfaces WS1 will also re-base on events.
  - *Tests:* `packages/core/tests/status.test.ts` (the renderDebStatus suite).
- **WS1 inventory (the work-list) — the four imperative inputs for a terminal run:**
  - `phase` — LOAD-BEARING (drives `oscar`, and `handoffs` via awaiting-directive/verifying). DERIVABLE from
    `run-end {status}` / `run-held` / `run-stopped`.
  - `activeAtom` — LOAD-BEARING (drives `verify` active-atom selection, `handoffs` file numbers, passthrough
    `json.activeAtom`). DERIVABLE from the terminal marker's `atom`, else last atom-bearing event.
  - `activeTask` — DISPLAY-ONLY pass-through (only `json.activeTask` + markdown); NOT derivable (free prose).
  - `waitCondition` — DISPLAY-ONLY pass-through (only `json.waitCondition` + markdown); NOT derivable (free
    prose). This is the "no runner-passed waitCondition the event log can't reproduce" edge the ledger named.
  - Non-run-state inputs (legitimately injected, not part of the move): `store`, `runId`, `priority`,
    `runDisplay`, `scopes`, `now`, `recentLimit`.
  - Coarseness logged: `stopped` has no dedicated RunnerPhase/OscarState → projection maps it to `'faulted'`
    (→ oscar `'blocked'`), the generic terminal-blocked state. A dedicated terminal OscarState is a later
    refinement, not this step.
- **Tests/results:** `pnpm --filter @cocoder/core test status` → 18 passed (13 existing + 5 new);
  `pnpm --filter @cocoder/core test` → **554 passed** (was 549); `pnpm --filter @cocoder/core typecheck` →
  clean; root `pnpm typecheck` → clean (7 pkgs); root `pnpm test` → all green (personas 29, core 554,
  adapters 24, session-hosts 18, ui 161, cli 9, daemon 345); `node scripts/check-topology.mjs` → passed
  (same 2 pre-existing daemon test-helper warnings as WS0). The WS0-noted timer-flaky idle-Oscar-nudge test
  did not trip this run.
- **Residual risk:** `deriveTerminalProjection` is a SEED only — nothing in `runner.ts` consumes it yet, so
  no behavior changed and the held/stopped stale-feed bug still exists at runtime (now provably fixable).
  `record.ts` / `writePortableRunHistory` are still imperative and untouched. The unrelated dirty working
  tree (eslint adoption: `eslint.config.mjs`, `run.ts`, `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`,
  `runner.ts`, `oz-host.ts`, `proof-daemon-reload.mjs`, `tsconfig.eslint.json`) was preserved, NOT committed.
- **Exact next step (WS1, step 2):** Wire `deriveTerminalProjection` into the runner's terminal paths so
  `holdRun`/`stopRun`/`fail` no longer hand-feed `phase`/`activeAtom` — call `refreshStatus` in `holdRun` and
  `stopRun` (they currently don't) using the derived pair, and assert (test-first) the on-disk terminal
  `DebStatus` now matches the projection (closing the stale-feed gap). Keep `activeTask`/`waitCondition` as
  the only remaining imperative inputs for now (free-text labels). Verify with the same command set.

---

## 2026-06-24 — WS0 (pre-work, this audit session)

- **Workstream/step:** Root-cause fix that motivated this priority (not part of WS1–WS5; the baseline).
- **Commit:** `bca1b27` — "runner: structured builder-blocker signal + quarantine faulted atoms".
- **Files:** `packages/core/src/runner/blocker.ts`, `agent-step.ts`, `prompts.ts`;
  `packages/core/tests/blocker.test.ts`, `runner.test.ts`, `prompts.test.ts`.
- **What changed:** Blocker detection is now a structured, echo-proof per-atom marker
  (`<<<COCODER-ATOM-N-BLOCKED: reason>>>`) symmetric with the done sentinel — no more terminal prose
  keyword-scraping, so the runner can never classify its own echoed dispatch as a blocker. Faulted atoms
  are now quarantined before the fault reaches Deb, so a deb-repair commit cannot sweep builder residue.
- **Tests/results:** `pnpm --filter @cocoder/core test` → 549 passed; `pnpm --filter @cocoder/core
  typecheck` → clean; root `pnpm typecheck` → clean (7 pkgs); `node scripts/check-topology.mjs` → passed
  (2 pre-existing test-helper warnings, unrelated). Full `pnpm test` is green in isolation; one
  timer-flaky idle-Oscar-nudge test can fail under full parallel load (pre-existing, unrelated).
- **Residual risk:** `runner.ts` is still the entangled 2000-line owner; `status.ts` re-derives state with
  its own heuristics that can drift from the runner's phase; commit logic is duplicated across paths.
- **Exact next step (WS1, step 1):** In `status.ts`, treat `renderDebStatus` as the canonical projection
  and ADD a parallel projection assertion test proving the `DebStatus` for a faulted/held/stopped run is
  fully derivable from the event log alone (no runner-passed `waitCondition` that the event log can't
  reproduce). Identify every field currently fed imperatively by the runner vs. derivable from events;
  that inventory is the WS1 work-list. Land the test + inventory first, before moving any writes.
