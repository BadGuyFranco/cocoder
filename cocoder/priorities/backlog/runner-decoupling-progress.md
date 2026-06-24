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

## 2026-06-24 — WS1, step 2 (wire deriveTerminalProjection into the runner's terminal paths)

- **Workstream/step:** WS1 (Surface unification), step 2 — wire `deriveTerminalProjection` into `holdRun`/
  `stopRun` so the Deb status feed no longer keeps a STALE pre-terminal phase after a hold/stop (the
  WS1.1-documented stale-feed gap). `fail()` already refreshed; `holdRun`/`stopRun` never called
  `refreshStatus`. This is the ONE intended BEHAVIOR change in WS1.
- **Commit:** `4298987` — "runner(status): WS1.2 — derive terminal status feed phase in hold/stop".
- **Files:** `packages/core/src/runner/runner.ts` (import `deriveTerminalProjection`; add a `refreshStatus`
  call in `stopRun` and `holdRun` sourcing `(phase, activeAtom)` from
  `deriveTerminalProjection(store.listEvents(run.id))`, `activeTask=null` + a free-text `waitCondition`),
  `packages/core/tests/runner.test.ts` (new `WS1 step 2 — terminal status feed derives its phase from the
  event log (no stale phase)` describe: 2 tests — held + stopped).
- **Map (owners/emitters/consumers/tests):**
  - *Projection owner:* `deriveTerminalProjection` (`status.ts:105`) — pure over events. held → `awaiting-founder`,
    stopped → `faulted`; both map to oscar `blocked` via the phase→oscar table (`status.ts:220`).
  - *Feed emitter:* `refreshStatus` → `writeDebEvidence` (`runner.ts:1175/1128`) — writes `deb-status.json`
    (+ terminal snapshot) and records a `deb-status` event. Only fires for a Deb-backed run (`if (!debRef) return`).
  - *Terminal call sites fixed:* `stopRun` (`runner.ts:1672`), `holdRun` (`runner.ts:1712`). The new call is
    placed AFTER `projectAndCommitPortableRunHistory` + `io.writeRunRecord` (just before the `log`/`return`).
  - *Sibling surfaces (confirmed NOT shifted):* `writePortableRunHistory` (`store/portable/projection.ts:27`)
    serializes ALL events via `listEvents` — so the new terminal `deb-status` event would land in portable
    history if recorded earlier; placing the refresh AFTER the portable commit keeps that surface byte-identical.
    `record.ts` reads only `direct-mode` + `out-of-scope-committed` events (`record.ts:10,58`), so `record.md`
    is unaffected regardless of placement. Verified by event-ordering assertions in both new tests
    (`lastIndexOf('deb-status') > indexOf('run-end')`).
- **Behavior change (the intended one):** a held run's terminal feed was oscar `waiting` (stale
  `awaiting-directive`); a stopped run's was oscar `running` — both now correctly read oscar `blocked` with the
  terminal `activeAtom`. The tests pin the OLD stale values as the pre-fix baseline (red before the wire-up,
  green after). No other surface changed.
- **Determinism (WS1.1 rule honored):** the "matches the projection" assertion renders the canonical
  `renderDebStatus` from the SAME post-run store/run as the on-disk feed (one store → identical event `at`),
  and compares only the projection-controlled fields (`oscar`, `activeAtom`, `bob`, `verify`,
  `outstandingFaults`, `handoffs`) — excluding render-time `generatedAt` and the still-imperative free-text
  `waitCondition`/`activeTask`. No deep-equal of two independently-built `:memory:` stores.
- **Tests/results:** `pnpm --filter @cocoder/core test runner -t "WS1 step 2"` → 2 passed (both red before the
  runner edit: held `waiting`→`blocked`, stopped `running`→`blocked`); `pnpm --filter @cocoder/core test` →
  **556 passed** (was 554; +2 new); `pnpm --filter @cocoder/core typecheck` → clean; root `pnpm typecheck` →
  clean (7 pkgs); `node scripts/check-topology.mjs` → passed (same 2 pre-existing daemon test-helper warnings).
  Root `pnpm test`: all packages green (personas 29, core 556, adapters 24, session-hosts 18, ui 161, cli 9)
  EXCEPT one flaky daemon failure under full parallel load — `daemon-auto-reload.test.ts > daemon reload build
  failure is recorded without restarting` — which PASSES in isolation (`pnpm --filter @cocoder/daemon test
  daemon-auto-reload` → 5 passed) and exercises the dirty `scripts/proof-daemon-reload.mjs` (unrelated eslint
  dirt); it is NOT a regression from this core-only change (cf. WS0/WS1.1's known timer-flake note).
- **Residual risk:** `activeTask`/`waitCondition` remain the only imperative inputs to `renderDebStatus`
  (free-text labels — by design, NOT derivable). `record.ts` and `writePortableRunHistory` are still imperative
  surfaces (WS1 will re-base them on events in later steps). The unrelated eslint-adoption dirt
  (`eslint.config.mjs`, `run.ts`, `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`, `runner.ts`'s `SessionRef`
  import hunk, `oz-host.ts`, `proof-daemon-reload.mjs`, `tsconfig.eslint.json`) was preserved, NOT committed —
  runner.ts was staged hunk-by-hunk (`git apply --cached`) to exclude the `SessionRef` dirt hunk.
- **Exact next step (WS1, step 3):** Re-base ONE of the remaining imperative sibling surfaces on the event log.
  Recommended: `writePortableRunHistory` (`packages/core/src/store/portable/projection.ts`) — it already
  serializes the full event log per session, but the run-level summary fields (status/atoms/committedShas/
  outOfScope/selfCommitted) are passed in imperatively by the runner's `projectAndCommitPortableRunHistory`
  (`runner.ts:1609`) rather than derived from the `run-end` event. Build a derivation, assert it equals the
  current output on existing fixtures (the portable-projection tests), THEN swap the imperative inputs. Keep the
  feed-after-portable-commit ordering established here. Verify with the same command set.

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
- **Correction (progress-check follow-up, commit `885f839`):** WS1.1's "DebStatus rendered from the derived
  pair matches the canonical one" test was non-deterministic — it built two `:memory:` stores and
  deep-equalled the full `DebStatus`, but `recordEvent` stamps event `at` with real wall-clock (surfaced via
  `lastDirectiveAt`/`recentEvents[].at`), so the two stores drifted and the deep-equal flaked under parallel
  load (the "554 passed" self-report was a lucky run). Fixed by rendering both from ONE store/run. The core
  suite is now stable across repeated full runs. NOTE: a SEPARATE pre-existing flake remains —
  `runner.test.ts > Deb-backed watchdog nudges an idle Oscar …` (timer-sensitive, flagged in WS0, unrelated
  to this refactor); treat it as known background noise, not a regression, until it gets its own fix.
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
