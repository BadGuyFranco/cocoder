---
id: create-priority
label: Create priority
kind: headless
executionModel: prompt-only
triggerClass: persona-requested
purpose: Create one founder-approved priority file through the governance authoring lane.
allowedCallers:
  - oz
  - oscar
  - deb
requiredCheckpoints:
  - shared elegance checkpoint
writeScope:
  - cocoder/priorities/**
---

# Create Priority Play

This Play runs headless on its per-(persona, Play) assigned model.

Create exactly one priority file from the founder-directed invocation input. A priority is created **for a
stated reason** (founder direction, or orchestration acting on it) and is **placed in the active stack** —
there is **no "draft / awaiting ratification" state** (ADR-0035). The invocation must carry the explicit id,
title, and the founder's reason/go-ahead; do not invent a priority from nothing. **Open questions are not a
reason to withhold it** — if the Objective has unknowns, they become the priority's *first research gate* (a
priority may research and conclude "not needed → archive"); never mark it draft or hold it for them. Founder
ratification of the informed Objective and of any committing work happens at that first-run gate, not here.

Do this:

1. Validate the requested id, title, and Objective before writing:
   - `id` must match the dashboard create route contract: `^[a-z0-9][a-z0-9-]*$` and length at most 64.
   - `title` must be a non-empty string.
   - the body must contain the Objective as a real `## Objective` section (it may include open research
     questions as the priority's first gate — that is fine, not a blocker).
2. Refuse on id collision. Check `cocoder/priorities/<id>.md` case-insensitively against existing
   entries in `cocoder/priorities/`.
3. **Conflict/overlap check (ADR-0035) — the one halt before placing.** Measure the Objective against the
   Accepted ADRs (`cocoder/decisions/`) and the active + `backlog/` priorities (`cocoder/priorities/`):
   - **Overlap** (it shares the primary code/governance surface or objective of an existing priority): do
     NOT create a second priority. Return a recommendation to **fold it into that priority, with a one-
     paragraph plain-English reason why it belongs there**, for the founder to approve the merge.
   - **Conflict** (it contradicts an Accepted ADR's decision or another priority's stated boundary): do NOT
     create. Surface the contradiction — name the ADR/priority and the specific clash — for the founder to
     decide supersede / reframe / drop.
   - **Clean, or only soft/uncertain similarity**: proceed to place it. Halt only on a *clear* overlap or
     conflict; do not over-halt (an unnecessary halt is the founder-blocking anti-pattern, ADR-0029).
4. Compose the priority file using core `composePriorityMarkdown(input)`, the single owner of the
   priority markdown format. Use the same input values validated above; do not invent a second
   priority template.
5. Run the elegance checkpoint before writing: preserve the Objective and verification evidence, remove
   prose that does not carry weight, keep one owner for each rule/format, and order any implementation
   atoms so a future LLM-run builder can execute them systematically.
6. Write `cocoder/priorities/<id>.md` — placed in the active stack (no draft state).
7. Validate the written file round-trips through core `loadPriority` or `readPriorities`: the parsed
   id and title must match the invocation, `scopeNarrowing` must remain unset, and `objective` must
   be non-null.

Do not run git, commit, or edit `order.json`. After this Play returns, the dispatch spine reconciles
`order.json` automatically and commits the priority file plus registration together. There is no
orphan or draft state.
