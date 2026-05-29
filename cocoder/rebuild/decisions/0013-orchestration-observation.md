# ADR-0013 — Orchestration + observation model: multi-atom loop + tiered monitoring

**Status:** Accepted (founder + Claude, 2026-05-29)
**Seam:** run-orchestration & observation (the run lifecycle)
**Refines:** [0004](./0004-process-architecture.md) (runner composition: one-shot → orchestrated loop) · **Composes with:** [0011](./0011-orchestrator-verify-gate.md) (verify-gate, now per atom) · **Realizes:** [0002](./0002-substrate-oz-and-cmux.md) C1 (durable run-state → resume) + [0003](./0003-data-model-hybrid.md) (run/session/work-item lifecycle supports continuation — fixes **F8**)
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
