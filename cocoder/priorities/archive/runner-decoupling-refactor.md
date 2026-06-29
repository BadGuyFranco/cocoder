---
id: runner-decoupling-refactor
title: Runner decoupling refactor (non-orchestrated, session-chained)
---

> **Archived 2026-06-29 (founder) — archive confirmed.** Complete by its own done-when (all five
> conditions met, verification recorded); archived per 2026-06-29 priority audit as finished work.

> **EXECUTION CONSTRAINT — READ FIRST. This priority must NEVER be launched through the CoCoder
> runner, the Oz daemon, or the Oscar/Bob/Deb loop.** It mutates the very control plane those agents
> depend on (`runner.ts`, `blocker.ts`, `status.ts`, `commit-gate/*`, `prompts.ts`). A mid-flight
> self-edit breaks the running orchestration — it has, repeatedly. It is deliberately kept out of
> `cocoder/priorities/order.json` so it is never queued. Execute it ONLY as independent, hand-driven
> Claude Code sessions (like the audit session that authored it): one human-supervised single-writer
> session at a time, chained by the per-session protocol below. If you find yourself dispatching a Bob
> atom or writing a `directive-*.json` for this work, stop — that is the failure mode this constraint
> exists to prevent.

## Objective

Decouple the orchestration runner so that a single fix stops cascading across unrelated subsystems. The
control plane is not built wrong — the file-handoff contract, single-writer DB invariant, per-atom
verify/commit gate, and full dependency injection are sound — but `runner.ts` has accreted into a
~2000-line function that owns the loop, the live monitor, the commit-gate wiring, fault triage, the
status projection, resume/hold/stop, and four parallel state surfaces that must be hand-kept in
agreement. **Verified** when: (1) the four state surfaces (store event log, `DebStatus` feed, portable
run-history, `record.md`) are pure projections of one source (the event log) and cannot disagree by
construction; (2) the runner no longer infers any *semantic* state from terminal screen-scraping (only
liveness/idle); (3) there is ONE commit spine with one receipt and one scope rule; (4) `runner.ts` is
split into focused modules behind unchanged behavioral contracts; and (5) the full suite, typecheck, and
topology check stay green at every committed step. Boundary: **behavior-preserving** — this is a
structural refactor, not a feature change; any behavior change must be its own decision/ADR first.

## Why (the cascade this prevents)

run_231: the runner keyword-scraped Bob's terminal for "scope/authority" and matched its OWN echoed
`PROCEED … within your write-scope` dispatch → a fabricated `builder-blocked` fault → an un-quarantined
atom whose residue Deb's whole-tree repair gate then swept → a post-terminal "dead WRAP-UP READY" state.
One bad inference rippled through the fault funnel, Deb, the commit-gate, and three display surfaces. The
root is entanglement: contracts that look separate are one contract routed through one function.
(Pre-work landed in commit `bca1b27` made the blocker signal structured/echo-proof and quarantined
faulted atoms — see the ledger. This priority finishes the decoupling so the *next* fix can't cascade.)

## Workstreams (ordered by risk/leverage — do in order, one or part-of-one per session)

Each workstream is independently shippable, tests-first, and ends green + committed.

- **WS1 — Surface unification (highest leverage, low risk; ADDITIVE).** Make `status.ts` (DebStatus
  feed), `writePortableRunHistory`, and `record.ts` pure projections of the store event log. Remove the
  runner's imperative wait-condition setting wherever the projection can derive it. Method: build each
  projection, assert it equals the current surface on existing fixtures, THEN swap the imperative writes.
  Done-when: no surface is written by hand from runner locals; a faulted/held/stopped run's surfaces all
  derive from the same events and provably agree (regression test asserts agreement after each terminal
  status).

- **WS2 — Introduce/standardize the structured agent→runner progress channel (small).** Not just "stop
  scraping" — give every semantic signal a structured carrier so the terminal can stop being one. Audit
  every `readScreen`/frame consumer (`monitor.ts`, `agent-step.ts`, the Deb watcher, the Oscar nudge
  watchdog) and partition what each reads into two kinds: liveness/idle (legitimate) and semantic verdict
  (must migrate). The end state: the terminal is a DISPLAY surface plus a liveness/idle HEARTBEAT only —
  every SEMANTIC signal (done, blocked, progress) travels as a structured artifact the agent emits and the
  runner reads, never as frame text the runner interprets. The WS0 done/blocked markers
  (`<<<COCODER-ATOM-N-BLOCKED: reason>>>`, the done sentinel) and the loop-ledger are the precedents to
  extend; a missing channel (e.g. mid-atom progress) is ADDED as a marker, not inferred from the screen.
  Done-when: a test proves no terminal frame content can produce a fault or a state transition; AND any
  semantic signal still read off the screen has been migrated to a structured artifact — never replaced by
  a new screen-reading heuristic.

- **WS3 — One commit spine (medium).** Collapse the parallel commit paths — the in-run gate, Deb's
  inlined repair/escalation commit in `triageFault`, oscar-support, run-history — onto a single spine
  with one receipt and one scope-partition rule (`workspace-commit.ts` is the seed). Deb's repair must be
  structurally incapable of sweeping non-declared work (the quarantine-before-fault guard from `bca1b27`
  plus declared-files-only commits). Done-when: one module owns "write tracked files + return a receipt";
  all callers use it; the deb-repair-no-sweep test still holds.

- **WS4 — Test-hardening pass (prerequisite for WS5; no behavior change).** Convert over-pinned snapshot
  assertions (exact prompt strings, exact event orderings) into behavioral contracts that assert WHAT
  state results, not WHICH string produced it. Done-when: the runner suite no longer fails on
  cosmetic/structural edits that preserve behavior (spot-check by a no-op rename).
  - **De-flake the Deb-watcher stall family (named deliverable).** Make the recurring timer-race flakes
    deterministic — at least `Deb-backed watchdog nudges an idle Oscar`, `writes a live status feed so Deb
    can report concrete run state`, and `actionable stall Deb watch writes current lastDispatch before
    prompting Deb` (the family flagged since WS0: passes in isolation, fails intermittently under full
    parallel load). Root cause: they exercise timer-based stall logic against REAL timers while the
    orchestration code already injects its clock (`now`) — the tests just don't pin it, so stall timing
    races the suite's load. Done-when: that family runs deterministically (inject/pin the clock so stall
    timing is fixed, not wall-clock dependent) and the full suite is green across repeated full-parallel
    runs — restoring "green at every commit" as a clean signal instead of a known-noisy one.

- **WS5 — Split `runner.ts` (highest risk; ONLY after WS4).** Extract: the atom-loop driver; the
  fault/triage funnel; the terminal-state projection reducer (from WS1); and the founder-closeout
  contract parser (into the Play layer). `runner.ts` becomes thin composition. Done-when: no module
  exceeds a reviewable size, behavior is unchanged, and the full suite stays green.

## Per-session protocol (how to run ONE session and chain to the next)

1. **Orient.** Read this priority, then the last entry in `cocoder/priorities/backlog/runner-decoupling-progress.md`.
   Run `git status --short` and preserve unrelated dirty work — never revert changes you did not make.
2. **Pick the next bounded chunk** (the smallest shippable step of the current workstream).
3. **Map before editing** (the durable-orchestration workflow): the source of truth, every emitter, every
   consumer, and the pinning tests for the behavior you are about to move. Write that map into your reply.
4. **Implement tests-first.** Keep the suite green throughout — never weaken or delete a test to pass;
   if a test pins the old behavior, rewrite it to pin the new *contract*, and say why.
5. **Verify and record exact commands/results:** focused tests → `pnpm --filter @cocoder/core test` and
   `pnpm --filter @cocoder/core typecheck` → when feasible root `pnpm typecheck`, `pnpm test`, and
   `node scripts/check-topology.mjs`.
6. **Commit ONLY this chunk's files** (leave unrelated dirt). Co-author trailer:
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
7. **Append a progress-ledger entry** (newest at top) to `runner-decoupling-progress.md`: date, workstream
   + step, commit sha, files, tests run + results, residual risk, and the **exact next step**.
8. **Hand back the next session's prompt.** End your final message with a fenced, ready-to-paste prompt
   for a FRESH session that continues from your ledger entry (use the template in the ledger). Stop there
   — do not start the next chunk in the same session; context-fresh single-writer sessions are the point.

## Global invariants (hold for every session)

- Behavior-preserving: the event log, run statuses, and founder-facing outcomes are unchanged unless an
  ADR/decision says otherwise. The refactor moves where state is *derived*, not *what* it is.
- Single writer: only the runner writes the store; agents read + emit artifacts (ADR-0003).
- Green at every commit: a session that cannot land green leaves the tree clean and hands back a prompt
  that says so — it does not commit a red step.
- Independent sessions only (see EXECUTION CONSTRAINT). Never route this work through the runner.
