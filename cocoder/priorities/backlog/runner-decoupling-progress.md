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
