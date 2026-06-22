# ADR-0035 — Priority creation: always placed or halted; no "draft" state; conflict-halt at authoring

**Status:** Accepted (founder-directed, 2026-06-22).
**Amends:** [0010](./0010-taxonomy-and-authoring.md) — the authoring lifecycle. ADR-0010's product
structure stands; this changes *when* the founder approves a priority's Objective and removes the "draft /
awaiting-ratification" limbo.
**Builds on:** [0026](./0026-onboard-existing-as-oscar-priority.md) (founder gates are ordinary Oscar
beats, not a separate pre-run protocol) and [0029](./0029-founder-trusted-pre-run-snapshot.md) (don't
manufacture founder-blocking gates).

## Context
Priorities were sometimes created in a **"DRAFT — awaiting founder ratification of the Objective"** state
(the two Grok drafts; `orchestration-loop-quality`). That state is a **limbo** — and limbo is exactly the
orphan-prone, "where did the thing I asked for go?" trap. The framing is wrong for two reasons the founder
named (2026-06-22):

1. **A priority is created for a reason** — by the founder or by orchestration acting on founder direction.
   It should get a place in the active stack, not sit in a holding pen.
2. **Open questions are not a reason to withhold it.** If a priority has unanswered questions, *answering
   them is the priority's first gate* — a priority may legitimately run, research, and conclude **"this
   doesn't need doing → archive."** That outcome is cheap and valid, not a failure.

The real failure the old model also missed: priorities that **collide** with existing governance. The two
Grok drafts overlapped (should have been one — they became `model-layer`); `priority-architecture-contract`
conflicts with ADR-0029's founder-vs-agent boundary. Nothing caught these at authoring time; they
accumulated for a later manual audit.

## Decision

**1. No "draft" state.** A created priority is **placed in the active stack** (`cocoder/priorities/` +
`order.json`) — or it is **not created** (halted, §3). There is no third limbo state. The founder still
controls *launch order*, so "placed" never means "auto-runs."

**2. Uncertainty is the priority's first gate, not a pre-creation hold.** An Objective may legitimately be
"research X, then decide whether to do Y — including concluding no-op and suggesting archive." The research
beat is cheap/read-only. **Founder ratification of the informed Objective and of any committing work happens
at that first-run gate, not before creation.** This preserves ADR-0010's intent (the founder approves what
gets *built*) without the limbo, and matches ADR-0026 (founder gates are ordinary run beats).

**3. The sole pre-creation gate — conflict/overlap halt.** Before placing a new priority, check its
objective against the existing **Accepted ADRs + active/backlog priorities**:
- **Overlap** (shares the primary code/governance surface or objective of an existing priority) → **HALT;
  recommend folding it into that priority**, with a **plain-English reason why it belongs there**; the
  founder approves the merge (or chooses to split it off anyway). Default recommendation is *merge*.
- **Conflict** (contradicts an Accepted ADR's decision or another priority's stated boundary) → **HALT;
  surface the contradiction**; the founder decides supersede / reframe / drop. (No "add-to" — it is a
  genuine collision, not a home-finding.)
- **Soft/uncertain** → place it and let the run sort it out. Halt only on a *clear* overlap or conflict —
  over-halting would recreate the founder-blocking anti-pattern (ADR-0029).

This is an **agent→reality boundary check** (a new artifact measured against the real governance set to
prevent duplicate/conflicting surface), not governance-of-governance (F5). It formalizes, at the source,
the dedup/grounding pass that was being done by hand.

**4. Applies to both authoring paths** — the founder hand-authoring a priority file, and orchestration via
the `create-priority` Play. The Play implements the check; the founder path follows it as the documented
norm (shared standards).

## Consequences
- No more draft limbo; every created priority is reachable (placed) or explicitly halted-and-surfaced.
- Collisions are caught at creation (merge/supersede decided up front), not accumulated for an audit.
- A priority that researches and concludes "not needed → archive" is a valid, cheap outcome.
- Founder control is preserved by *launch-order control* + the *first-gate ratification*, not by a
  pre-creation hold.
- Existing "DRAFT — awaiting ratification" banners (`model-layer`, `orchestration-loop-quality`) are
  reframed: they are placed in the active stack; their first gate is research + founder-ratify.

**Verified when:** the `create-priority` Play performs the conflict/overlap check (overlap → recommend
merge with reason; conflict → surface; clean → place), no priority carries a "draft/awaiting-ratification"
state, and the priority-authoring tests pin the new behavior.
