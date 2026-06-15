---
type: bug
status: Closed
owner: founder
priority: new-primary-root
---

# Orchestration personas can't commit a founder-approved held-back file post-wrap (the D3 strand)

> **CLOSED 2026-06-15 — root-caused deeper than the symptom and the *constraint itself was removed.***
> The first attempt (a `expand` resolve disposition / proposed ADR-0024) was **process theater**: it added
> machinery + a new founder-ratification gate to work *around* a commit constraint that should never have
> existed. The founder's directive — *remove any constraint on Oscar/Oz/Deb/Bob committing anything at any
> time* — was applied at the root instead: **scope is now advisory** (ADR-0023, founder directive
> 2026-06-15). The commit spine NEVER withholds; out-of-lane edits are committed and FLAGGED, never held
> back. There is no held-back / `pending-scope-decision` state for anything to strand on, so the
> "decided but nothing lands" class is gone by construction — not patched, not worked around.

## Summary

When a run wrapped with out-of-scope changes **held back** for a founder decision, and the founder
approved landing them, there was **no committing actor** — the decision stranded. The original framing
treated the held-back state as legitimate and asked for a new commit *path* to release it.

## Resolution — remove the constraint, don't add a valve

The held-back/withhold behavior was the constraint. It is removed:

- `runCommitGate` (`packages/core/src/commit-gate/gate.ts`) commits the **whole** working tree; out-of-lane
  paths are recorded as a flag (`out-of-scope-committed`), never withheld.
- `commitScoped` / `gateCommitRepair` (Oz repair) likewise commit everything and flag out-of-lane.
- The runner no longer parks on out-of-scope; `pending-scope-decision` is retired from `RunStatus`.
- The `resolve` `discard`/`landed` actions remain only for the **opt-in isolation lane** (`pending-landing`,
  ADR-0023 §4); the `expand` disposition and proposed ADR-0024 were deleted.
- The only commit gate left is the automated **verify-on-product-code** (ADR-0023 §3): it runs before the
  spine commits and is self-clearing — it never parks awaiting a human.

Safety is "broad by default, git is the undo" + verify-before-commit for product code — not commit-blocking.

## Lesson (feeds the charter / failure catalog F21)

A constraint that contradicts a ratified principle is a bug to delete, not a feature to build exceptions
around. Adding ceremony (a new disposition + a ratification gate) to undo a constraint is theater — it
multiplies the very thing being removed. Fix the root.
</content>
