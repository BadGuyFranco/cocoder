# Loop-Packets Dispatch Inventory

This inventory records how loop-shaped dispatches fit the current runner and which loop guarantees are
now enforced by core code.

## Current Dispatch Mechanics

1. **Directive JSON.** The runner waits for `local/runs/<runId>/directive-<n>.json` in
   `packages/core/src/runner/runner.ts` (`directivePath` is built in the main loop, then passed to
   `io.awaitDirective`). `packages/core/src/runner/io.ts` implements `awaitDirective` by polling the
   file through `pollFile`. `packages/core/src/runner/directive.ts` accepts prose delegates,
   structured loop delegates, and wrapups; malformed loop objects fail fast instead of polling to
   timeout as "not ready".
2. **Builder dispatch.** For a delegate directive, `runner.ts` creates a work item from
   `directive.task`, records a `delegation` event, then sends `buildBuilderDispatch(directivePath,
   atomIndex, loopLedgerPath?)` from `packages/core/src/runner/prompts.ts` into the builder pane. For a
   loop directive, that dispatch also names `loop-ledger-<atom>.jsonl` and the one-JSON-line-per-
   iteration contract. The builder launch prompt in the same file tells the builder to read the
   directive JSON and treat its `task` field as the atom.
3. **Monitor and sentinel.** `runner.ts` calls `runMonitor` from
   `packages/core/src/runner/monitor.ts`, wiring `readScreen`, `isAlive`, `nudge`, and the per-atom
   done sentinel from `atomSentinel`. `makeHeuristicJudge` treats the atom as done only when the
   sentinel appears on a line by itself; otherwise the monitor can report `dead`, `timeout`, or stuck
   samples. For loop atoms, `runMonitor` also reads the parsed ledger, enforces iteration and
   wall-clock caps, and treats ledger growth as progress even if the screen is unchanged.
4. **Verify-gate JSON.** When the monitor returns done, `runner.ts` sends `buildVerifyDispatch` to the
   orchestrator and waits for `local/runs/<runId>/verify-<atom>.json`. For loop atoms, the runner first
   reruns the structured criterion through `execCriterion`; a non-zero result nudges the builder back
   with a re-armed marker instead of dispatching verify. `packages/core/src/runner/io.ts` parses only
   `{"verdict":"pass"|"fail","reason":"..."}` for the verify gate.
5. **Commit on pass.** On `fail`, `runner.ts` records rejection and quarantines in-scope changes. On
   `pass`, it calls `runCommitGate` in `packages/core/src/commit-gate/gate.ts`, which partitions
   changed files by write-scope, commits only in-scope files, records the commit link, and surfaces
   out-of-scope files instead of committing them.

## Where Loop-Shaped Dispatch Lives Today

Loop-shaped dispatch now has a structured runner path. A delegate may still be prose-only, but when it
carries `loop`, the runner validates `goal`, `criterion`, `maxIterations`, `wallClockMs`, and
`writeBoundary`; names a ledger file; captures parsed ledger entries as run events; enforces iteration
and wall-clock caps; reruns the criterion before verify; and monitors ledger growth as progress.

The builder still owns truthful ledger content, useful self-critique, and stopping when a needed change
leaves the loop's mandate. The orchestrator verify gate remains load-bearing: a green runner criterion
only permits verify dispatch; it never commits by itself.

## Findings For The Founder

- **Structured loop directive fields: BUILT in run_51 on 2026-06-10.**
  `packages/core/src/runner/directive.ts` validates `loop.goal`, `loop.criterion`,
  `loop.maxIterations` defaulting to `5`, required `loop.wallClockMs`, and optional
  `loop.writeBoundary`; `packages/core/src/runner/io.ts` fails fast on malformed loop directives.

- **Runner-enforced iteration caps: BUILT in run_51 on 2026-06-10.**
  `packages/core/src/runner/monitor.ts` detects iteration-cap outcomes from the ledger, and
  `packages/core/src/runner/runner.ts` turns cap-out into an atom-blocked continuation with no commit.

- **Runner-enforced loop wall-clock cap separate from atom timeout: BUILT in run_51 on 2026-06-10.**
  `monitor.ts` returns a distinct loop wall-clock outcome, and `runner.ts` preserves the loop deadline
  across criterion reruns before applying the same blocked-with-ledger disposition.

- **Structured iteration-ledger capture: BUILT in run_51 on 2026-06-10.**
  `packages/core/src/runner/loop-ledger.ts` parses `loop-ledger-<atom>.jsonl`, and `runner.ts` records
  one `loop-iteration` run event per newly seen entry.

- **Criterion rerun by the runner: BUILT in run_51 on 2026-06-10.**
  `runner.ts` exposes `execCriterion`, reruns `loop.criterion` before verify, records
  `loop-criterion-rerun`, and re-arms the completion marker when a rerun is red.

- **Monitor awareness of loop progress versus idle stall: BUILT in run_51 on 2026-06-10.**
  `monitor.ts` passes loop iteration counts to the judge, resets idle streak on ledger growth, and
  annotates loop stuck notes with iterations so far.

## Disposition (founder ruled 2026-06-10, run_48 follow-up)

The founder chose to **build these six findings, not park them — inside `loop-packets` itself**. Run
51 built the unit-tested enforcement path listed above.

Important live caveat: the running daemon serves boot-time code. This inventory claims unit-test-proven
enforcement in this worktree only; it takes live effect after the founder restarts the daemon. Live
proof after restart remains a follow-up and is not claimed by run_51.
