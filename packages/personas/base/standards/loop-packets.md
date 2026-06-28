# Loop-Packet Dispatch Standard

Loop packets are for atoms where the builder should iterate against one deterministic signal until it
is green, capped, or blocked.

## When to use a loop packet

Use a loop packet only when the atom has a scripted exit criterion. A scripted criterion is a
deterministic command or artifact check: a named test command going green, a golden-output diff being
clean, a benchmark threshold being met, or an equivalent machine-readable signal.

If the success criterion cannot be scripted, the atom is not loop-amenable. Dispatch it as a normal
one-shot gated atom and let the orchestrator verify the result by judgment.

Founder gates are never inside a loop. Any step that needs founder approval, a product judgment call,
an authorization to widen scope, or a hard-to-reverse decision exits the loop and surfaces to the
founder.

## Contract

A loop-packet directive body must contain these five elements:

1. **Goal** — one line naming the outcome the builder is iterating toward.
2. **Verifiable exit criterion** — the exact scripted signal that ends builder iteration successfully:
   command, expected status, and any output/diff/threshold rule. The criterion must be deterministic
   enough that a fresh verifier can rerun it.
3. **Caps** — `maxIterations` defaults to `5` when omitted, and every loop must also name a
   wall-clock cap. On cap-out without success, stop, report the atom blocked with the full iteration
   ledger, and never widen scope to force progress.
4. **Per-iteration self-critique** — each iteration's result evidence records what failed and what
   changed before the next attempt.
5. **Scope guard** — the loop may touch only files inside the atom's declared write boundary, and may
   chase only defects observable in the failing criterion. Synthetic or hypothetical hardening exits
   the loop and surfaces to the founder. The full tree is diffed at verify; anything beyond the
   delegated atom fails the gate.

The loop's criterion ends only the builder's iteration. It does not replace the orchestrator's gate:
Oscar still verifies the actual diff, reruns the relevant checks, writes the verify verdict, and the
commit gate runs exactly as it does for a one-shot atom.

## Enforcement

For structured loop directives, the runner enforces the machine-readable loop contract:

- Delegate directives may include `loop.goal`, `loop.criterion`, `loop.maxIterations`,
  `loop.wallClockMs`, and `loop.writeBoundary`. `goal` and `criterion` must be non-empty strings;
  `maxIterations` defaults to `5`; `wallClockMs` is required; `writeBoundary` is an optional
  non-empty string list. A malformed `loop` fails loudly and is never treated as prose.
- The runner names a `loop-ledger-<atom>.jsonl` file. The builder appends one JSON line per completed
  iteration: `{ "iteration": number, "result": "green"|"red", "failed": string, "changed": string,
  "inScope": boolean }`. Each parsed entry is also recorded as a run event.
- Iteration and wall-clock caps are enforced by the runner. Cap-out blocks the atom, records the full
  parsed ledger, quarantines in-scope changes, commits nothing for that atom, and lets the run continue.
- Before accepting a loop atom's completion marker, the runner reruns `loop.criterion` in the active
  checkout.
  A non-zero result sends the builder back to iterate with a re-armed completion marker; only a green
  rerun can proceed to the normal verify gate.
- Ledger growth counts as monitor progress. A quiet screen with new loop entries is not treated as an
  idle stall; a static screen with no ledger growth still can be nudged.

Some parts remain builder-honored during the iteration itself: the truthfulness and quality of ledger
content and self-critique, staying inside the loop's intended scope while editing, and stopping when a
needed change exits the loop's mandate. The final diff and commit remain guarded at the orchestrator
verify gate and commit gate. A green runner criterion never bypasses verify.

## Ledger

The builder's completion evidence must include the loop ledger:

- Iteration number.
- Criterion command and result.
- What failed.
- What changed.
- Whether the next action stayed inside scope.

If the criterion is green, the builder prints the atom completion marker after reporting the ledger; the
runner still reruns the criterion before verify. If the criterion is still red at a cap, the builder
reports blocked with the ledger and does not keep editing.

## Example Directive Body

```json
{
  "kind": "delegate",
  "task": "LOOP PACKET\nGoal: Make the markdown link checker pass for the public docs.\n\nVerifiable exit criterion: `pnpm docs:check-links` exits 0 with no broken-link output. If this command is not available or cannot be made deterministic, stop and report the atom not loop-amenable.\n\nCaps: maxIterations=5; wallClockCap=30 minutes. On cap-out, stop and report blocked with the full iteration ledger; do not widen scope.\n\nWrite boundary: docs/** only.\n\nScope guard: Change only defects observable in `pnpm docs:check-links` output. Do not rewrite unrelated docs, adjust tooling, or make style cleanups. If the fix needs files outside docs/** or founder judgment, exit the loop and surface it.\n\nPer-iteration evidence: For each attempt, report the iteration number, command result, broken links still present, files changed, and why the next change follows from the failing output. When the command is green, run the normal relevant checks and print the atom completion marker. Oscar's verify gate still decides whether the atom commits."
}
```
