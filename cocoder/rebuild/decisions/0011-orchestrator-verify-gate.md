# ADR-0011 — Orchestrator verify-gate: the commit runs only on Oscar's pass

**Status:** Accepted (founder + Claude, 2026-05-29)
**Seam:** S4 — Oz ↔ runner boundary (refines the launch composition)
**Builds on:** [0004](./0004-process-architecture.md) (runner · launch composition), [0005](./0005-personas-and-subtasks.md) (Oscar = read-only orchestrator/quality gate), [0007](./0007-write-scope-enforcement.md) (commit-gate)

## Context

The Phase-1/2 spine ran `await builder-done → commit-gate → run record`. Oscar produced the
delegation and was then **never signalled again** — there was no hook to bring the orchestrator back
into the loop after the builder finished. The commit-gate committed the builder's diff and closed the
run with no orchestrator verification in the path.

This surfaced in a real dogfood run (`run_cf83592be43f4028`, the `objective-presence-gate` priority):
Bob's change passed its own targeted checks and was committed automatically, but it **broke the
`@cocoder/daemon` test suite** (Bob added the Objective gate without updating the daemon's test
fixture). Nothing caught it until the founder asked the orchestrator to look. Oscar's persona names it
as the quality gate ("verify the diff before considering it done"), but the machinery committed before
Oscar ever looked — so the verification was post-hoc theater, not enforcement.

The operating premise (Shared Standards): **there is no human backstop.** A gate that the spine can
skip is not a gate.

## Decision

Insert an **Oscar verify-gate between builder-done and the commit-gate.** The commit runs **only** on
a `pass`.

- After the builder signals done, the runner dispatches a `VERIFY` message into Oscar's still-alive
  pane (`buildVerifyDispatch`) and **blocks** on `io.awaitVerification(verify.json, …)` — the same
  poll-with-fast-fail-on-dead-session pattern as `awaitDelegation` / `awaitBuilderDone`.
- Oscar writes `{"verdict":"pass"|"fail","reason":"…"}` to `verify.json` after reading the actual diff
  and running the checks itself (evidence, not the builder's word — global #3).
- `pass` → record `verify-pass`, run the commit-gate. `fail` → record `verify-rejected`, set the run
  `failed`, throw `VerificationFailedError`, **nothing is committed.** A dead Oscar pane or timeout
  fails the run the same way (no silent commit).
- Oscar's launch prompt now states the verify step up front, so the orchestrator expects the second
  dispatch rather than treating delegation as its final act.

The verdict is intentionally **binary presence-style enforcement at the machine boundary** — the
*judgment* (is this diff good?) is Oscar's, model-driven and unconstrained; the *enforcement* (no pass,
no commit) is deterministic in the spine. Same split as ADR-0010's Objective gate (D3): the system
enforces that the gate was passed; it does not second-guess the judgment.

## Consequences

- **The quality gate is now real, not aspirational** — the spine cannot reach a commit without Oscar's
  pass. The dogfood failure that motivated this (a builder breaking a sibling package's tests) is
  exactly what the gate now catches.
- **A `fail` aborts with nothing committed.** For the minimal slice there is no automatic fail→rework
  loop-back to the builder; a rejected run is re-launched. A rework loop is a future enhancement, noted
  not built (no silent cap — the rejection reason is recorded on the run).
- **Wall-clock cost:** the run now blocks on a second interactive step. Acceptable — the orchestrator
  was always meant to be in this path; the gate just makes the spine honor it.
- **`core` stays pure/testable:** `awaitVerification` is another injected `RunnerIO` method; the gate is
  unit-tested with fakes (pass → commit; fail → no commit, run failed).
- Boundary: this refines ADR-0004's composition only; it does not change the commit-gate's
  scope-enforcement semantics (ADR-0007) — it only gates *whether* the commit-gate runs.
