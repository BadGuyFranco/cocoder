# ADR-0013 — Orchestration + observation model: multi-atom loop + tiered monitoring

**Status:** Accepted (founder + Claude, 2026-05-29)
**Seam:** run-orchestration & observation (the run lifecycle)
**Refines:** [0004](./0004-process-architecture.md) (runner composition: one-shot → orchestrated loop) · **Incorporates:** the per-atom verify-gate (formerly ADR-0011, merged here 2026-05-30) · **Realizes:** [0002](./0002-substrate-oz-and-cmux.md) C1 (durable run-state → resume) + [0003](./0003-data-model-hybrid.md) (run/session/work-item lifecycle supports continuation — fixes **F8**)
**Build:** the `oscar-orchestrates-bob` priority (tier 1, now). Deb = tier 2; Oz tier = `full-oz-dashboard`.

## Context

The Phase-1/2 runner is **one-shot**: Oscar writes one delegation → the runner waits for Bob's
done-file → Oscar verifies → commit → end. Two weaknesses showed up in a live run:

- **No live observation.** Nobody watches *how Bob is tracking* while he works — the runner only polls
  "pane alive?" and "done-file present?". The `readScreen` hook (live pane contents) exists end-to-end
  but is used only as a 1-line liveness probe. So Bob can finish something thin and end the run, and a
  brittle handoff depends on Bob correctly writing a done-file.
- **One atom, then over.** A real piece of work is many atoms; v1's "run can't continue, relaunch"
  (F8) was never fixed. Oscar should drive Bob through a *plan*, not a single task.

## Decision

### The run is an Oscar-orchestrated, multi-atom loop
Oscar drives Bob through a plan: **delegate an atom → continuously monitor Bob's live progress → verify
(ADR-0011, per atom) → next atom → …**. **Oscar decides when Bob has had "enough"** (context filling,
a natural breakpoint) and ends the run with a **wrap-up** — a pickup brief a fresh session resumes from
(continuation; ADR-0002 C1 / ADR-0003) plus the founder report. The run no longer ends because Bob
finished one small thing.

### The verify-gate, per atom — the commit runs only on Oscar's pass (was ADR-0011)
After the builder signals an atom done, the runner dispatches a `VERIFY` into Oscar's live pane and
**blocks**: Oscar reads the actual diff and runs the checks himself (evidence, not the builder's word —
global #3), then writes `{"verdict":"pass"|"fail","reason":…}`. **`pass` → run the commit-gate; `fail`
(or a dead / timed-out Oscar pane) → nothing is committed, the atom is rejected and recorded.** The
*enforcement* is deterministic at the machine boundary (no pass, no commit); the *judgment* (is the diff
good?) is Oscar's, model-driven and unconstrained — the D3 split: the spine enforces that the gate was
passed, never second-guesses it. This gates only *whether* the commit-gate runs; it does not change the
commit-gate's scope semantics (ADR-0007). Earned from a dogfood run where an unverified builder diff
broke a sibling package's tests and was auto-committed (a gate the spine can skip is not a gate).

### Observation is continuous, not artifact-blind
A reusable **monitor** reads its target's live progress (`readScreen` + run events), **judges how it is
tracking** (progressing / stuck / drifting / done), and **nudges** (`sendInput`) or escalates. This —
not a done-file — is the primary signal. Both hooks (`readScreen`, `sendInput`) already exist; this ADR
adds the loop that uses them.

### Tiered hierarchy, with one authority rule
The same monitor primitive, applied at three tiers:
- **Oscar → Bob:** monitor **and** orchestrate (the multi-atom loop above).
- **Deb → Oscar:** monitor Oscar, **nudge Oscar**; may *observe* Bob to diagnose, but **never
  orchestrates Bob**.
- **Oz → Oscars (across sessions):** monitor Oscars; may *observe* Bobs/Debs; does not orchestrate them.

**Authority rule (the invariant):** *you direct only your immediate primary; you may observe deeper, but
never direct across a tier you don't own.* This is what prevents two agents orchestrating Bob at once.

**Clarification (2026-06-12, from the `oscar-orchestrates-bob` dogfood; recorded at the founder's
memory-migration sweep):** `readScreen`/`sendInput` belong to the **SessionHost handles held by the
RUNNER process**, not to any agent — an agent sitting in a pane cannot observe another agent.
"Oscar monitors Bob" mechanically means *the runner runs the monitor loop on Bob's pane on Oscar's
behalf*; the agent's pane is where it reasons and reports, the runner is its eyes and hands.
Deb→Oscar and Oz→Oscar are the SAME primitive one tier up, simply instantiated (or not) per tier —
tiers differ only by which loops are wired and which monitors get a nudge sink (direct your
primary) versus none (observe deeper only), not by any fundamental barrier.

## Consequences

- **Fixes the three live failures comprehensively:** Bob can't end the run by finishing something small
  (Oscar runs the loop and decides "enough"); Oscar is always engaged (he *is* the loop, not waiting on
  a file); the wrap-up text falls out of Oscar's "enough" decision.
- **Run lifecycle becomes continuation-capable (F8):** the wrap-up pickup lets the next session resume —
  the multi-packet continuation v1 never got right.
- **Verify-gate composes in per atom** (ADR-0011); commit cadence (per atom vs at wrap-up) is
  implementation, decided in the build.
- **Reusable primitive:** Deb (tier 2) and Oz (tier 3) are the same loop one tier up — they reuse it,
  not reimplement it. Build tier 1 (`oscar-orchestrates-bob`) now; the others are their own priorities.
- **Large build on the core loop → adversarial review of the implementation plan before code.**
