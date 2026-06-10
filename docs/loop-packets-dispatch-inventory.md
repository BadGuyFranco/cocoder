# Loop-Packets Dispatch Inventory

This inventory records how loop-shaped dispatches fit the current runner without changing orchestration
core code.

## Current Dispatch Mechanics

1. **Directive JSON.** The runner waits for `local/runs/<runId>/directive-<n>.json` in
   `packages/core/src/runner/runner.ts` (`directivePath` is built in the main loop, then passed to
   `io.awaitDirective`). `packages/core/src/runner/io.ts` implements `awaitDirective` by polling the
   file through `pollFile`, and `packages/core/src/runner/directive.ts` accepts only two directive
   shapes: `{"kind":"delegate","task":"..."}` and `{"kind":"wrapup","pickup":"..."}`.
2. **Builder dispatch.** For a delegate directive, `runner.ts` creates a work item from
   `directive.task`, records a `delegation` event, then sends `buildBuilderDispatch(directivePath,
   atomIndex)` from `packages/core/src/runner/prompts.ts` into the builder pane. The builder launch
   prompt in the same file tells the builder to read the directive JSON and treat its `task` field as
   the atom.
3. **Monitor and sentinel.** `runner.ts` calls `runMonitor` from
   `packages/core/src/runner/monitor.ts`, wiring `readScreen`, `isAlive`, `nudge`, and the per-atom
   done sentinel from `atomSentinel`. `makeHeuristicJudge` treats the atom as done only when the
   sentinel appears on a line by itself; otherwise the monitor can report `dead`, `timeout`, or stuck
   samples.
4. **Verify-gate JSON.** When the monitor returns done, `runner.ts` sends `buildVerifyDispatch` to the
   orchestrator and waits for `local/runs/<runId>/verify-<atom>.json`. `packages/core/src/runner/io.ts`
   parses only `{"verdict":"pass"|"fail","reason":"..."}` for this gate.
5. **Commit on pass.** On `fail`, `runner.ts` records rejection and quarantines in-scope changes. On
   `pass`, it calls `runCommitGate` in `packages/core/src/commit-gate/gate.ts`, which partitions
   changed files by write-scope, commits only in-scope files, records the commit link, and surfaces
   out-of-scope files instead of committing them.

## Where Loop-Shaped Dispatch Lives Today

A loop-shaped dispatch lives entirely inside the delegate directive's `task` body today. The directive
schema has no structured loop fields, and the runner does not parse a goal, exit criterion, iteration
cap, wall-clock cap, ledger, or loop-specific write boundary. The builder self-manages iterations from
the prose task, prints the normal completion marker only after its loop condition is met, and the
orchestrator verifies the result through the existing verify-gate.

The existing runner still provides outer safety rails: the monitor has an atom-level timeout, the
session liveness check can fail fast, the run has max-atom and max-consecutive-reject backstops, and the
commit gate checks the whole changed tree against the atom's write-scope.

## Findings For The Founder

- **Structured loop directive fields: NOT BUILT in this priority.**
  The core would need schema support if it should distinguish `goal`, `criterion`, caps, ledger, and
  loop write boundary from ordinary prose instead of trusting the builder and verifier to read the task.

- **Runner-enforced iteration caps: NOT BUILT in this priority.**
  The runner currently sees only the atom start and the final sentinel, so it cannot count builder loop
  attempts or stop exactly at `maxIterations`.

- **Runner-enforced loop wall-clock cap separate from atom timeout: NOT BUILT in this priority.**
  The monitor has an atom-level timeout, but there is no loop-specific wall-clock cap with a blocked
  ledger disposition distinct from the existing builder timeout failure.

- **Structured iteration-ledger capture: NOT BUILT in this priority.**
  Evidence is currently freeform pane output and run events; the core does not capture one machine-
  readable row per loop attempt with command result, failure, change, and scope note.

- **Monitor awareness of loop progress versus idle stall: NOT BUILT in this priority.**
  `runMonitor` samples screen content and the heuristic judge detects the done sentinel or unchanged
  frames; it does not understand loop iterations, command failures, or convergence toward the scripted
  criterion.

- **Criterion rerun by the runner: NOT BUILT in this priority.**
  The orchestrator already reruns checks during verify, but the deterministic runner does not execute
  the loop criterion itself before accepting the builder's completion marker.
