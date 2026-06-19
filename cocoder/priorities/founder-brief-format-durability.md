---
id: founder-brief-format-durability
title: "Single-source orchestration contracts — diagnose and fix the multi-owner drift class"
---

## Objective
Diagnose and repair the underlying orchestration-design failure that founder-brief drift was only one
symptom of: **orchestration formats and contracts that have more than one owner — or one owner that nothing
enforces — drift apart and silently reintroduce old behavior.** A founder-requested change to any
orchestration contract (a closeout/brief format, an authoring Play, a runner/persona prompt, a status
projection, a persona/standards rule, a generated artifact, an authoring/loader format) must be small,
direct, and durable: every runtime surface that emits it derives from one owner, and an automated check
fails the moment a second copy of that contract appears.

The point of this run is to fix the **class**, not one format at a time, and to make recurrence
*structurally* impossible rather than relying on reviewers to notice the next copy.

Verified when a run:

1. Produces an **owner inventory** of orchestration formats/contracts that today have multiple homes or an
   unenforced single home. At minimum cover: the founder/closeout brief; Oscar/persona prompt restatements;
   runner prompt surfaces (`packages/core/src/runner/prompts.ts`); Deb/status projections
   (`packages/core/src/runner/status.ts`); persona & shared-standards rules carried as side-channel memory
   vs governed files; generated-vs-source artifacts (`design-ref/` vs `packages/ui/app`); and
   authoring/loader formats (ticket frontmatter). For each: the rightful single owner, every surface that
   re-encodes or can override it, and its state — `aligned`, `drifting`, or `already-fixed`.
2. For every **live** occurrence, removes the parallel contract so consumers parse, import, or derive from
   the one owner — or records an explicit, founder-approved deferral with a tracking ticket and the reason.
   No occurrence is left silently duplicated.
3. Promotes the **governing rule** into the governed standard
   (`packages/personas/base/shared-standards.md`, Durable Orchestration Changes), not a docs explainer,
   phrased to pass the ADR-0012 portability test (no repo nouns). Decide with the founder whether it also
   warrants a short ADR in `cocoder/decisions/`.
4. Adds a **structural enforcer** — a test or lint that fails when a format/contract owned by a Play or
   governed standard is re-encoded elsewhere (a TS constant, a prompt restatement, a status string, or a
   test fixture that hard-codes the labels instead of deriving from the owner). Prove it red→green:
   introduce a deliberate duplicate, watch the enforcer fail, remove it, watch it pass.
5. Closes out by naming which occurrences were fixed, which were deferred and why, the rule's new governed
   home, and exactly how the enforcer prevents the next occurrence — across product behavior, architecture,
   tests, documentation, and any founder decision still owed.

Boundary: this run MAY edit runner validators, runner/persona prompt surfaces, status projections,
`packages/personas/base/shared-standards.md`, and generated-artifact guards as needed to collapse multiple
owners into one and to add the enforcer. It is NOT a redesign of unrelated runner, commit-spine, or
dashboard behavior — only the ownership and enforcement of orchestration formats and contracts. A decision
already recorded in an ADR is not reversed except by a new founder-approved ADR.

## Reference: the exemplar is already shipped — generalize it, do not re-fix it
The founder-brief instance is fixed and verified (commit `90599db`; diagnosis of record in
`docs/founder-brief-format-durability.md`, including the six-occurrence evidence pack and owner map). It is
the pattern to copy: one owner (the wrap-up Play's fenced contract), the runtime parses/derives from it,
and an end-to-end test fails when an old format reappears. Use it as the template for every other
occurrence; do not re-diagnose or re-fix it.

## Repair progress — disposition: `continue` (after run_148)

Structural class repair is **complete and proven** through the verify gate. Owner inventory:
[`docs/orchestration-contract-ownership.md`](../docs/orchestration-contract-ownership.md) (`036e618`,
updated run_148). Governing rule + enforcer kept from run_147 fix-forward decision (`aa7addc`); red→green
proof harness `node scripts/proof-orchestration-enforcer.mjs` (`dfe5477`); ticket 0005 portable rules
migrated to base personas/standards (`d06ae45`); governance reconciled — duplicate inventory deleted,
tickets 0012/0015/0017 closed (`297f703`). The run_145/run_147 gate-bypass observation was reconsidered
and closed **not actioned** (ticket 0018; F23 removed) — see "Related observation" below.

### Remaining → then archive
**Ticket 0005 items 1-2** — the founder will run this in a fresh session scoped to reach the files.
- Item 2 (`cocoder/AGENTS.md` name disambiguation) is benign housekeeping.
- Item 1 (`cocoder/personas/deltas/oscar.md` — Oscar launching runs via the daemon) needs a
  host/process-safety judgment first and may be a deliberate **won't-do**, not a routine apply.

Once 0005 items 1-2 are resolved (applied, or closed won't-do), this priority is **archive-ready** —
nothing else in the single-source contract repair remains.

## Required Ticket Review
Review related tickets before proposing fixes and fold each into the owner inventory:

- [0017](../tickets/closed/0017-promote-founder-brief-single-source-rule-to-shared-standards.md) — **closed
  run_148** by repair (`aa7addc`).
- [0005](../tickets/open/0005-persona-file-memory-migrations.md) — items 3-5 migrated run_148; items 1-2
  remain open (repo-specific, outside Oscar support scope).
- [0012](../tickets/closed/0012-design-ref-rebuild-clobber-guard.md) — **closed run_148** (Option A:
  design-ref historical).
- [0015](../tickets/closed/0015-tickets-silently-dropped-without-frontmatter.md) — **closed run_148**
  (loader defect already fixed).
- [0018](../tickets/closed/0018-enforce-verify-gate-commit-contract.md) — **closed run_148, not actioned**:
  bypassed commits were correct/green/founder-kept (not a failure), and any enforcement reintroduces
  commit-withholding (ADR-0023 anti-pattern); F23 removed.
- [0008](../tickets/closed/0008-post-wrap-founder-interaction-contract.md) — (closed) prior
  durable-orchestration repair that aligned prompts, wrap delivery, Deb status, daemon, and tests around one
  contract: the precedent pattern to copy.

Also review any other ticket indicating source-of-truth drift, authoring-format enforcement,
brief/wrap/closeout behavior, Play output, persona/standards memory, or generated-artifact clobbering. The
closeout must say, per ticket, whether it was folded in, fixed/closed by the repair, or left a sibling, and
why.

## Related observation — DECIDED: not actioned (run_148)
The run_145 direct commit (`90599db`) and the run_147 builder self-commit (`aa7addc`) both put work on the
branch without passing the verify gate. Initially scoped (run_147) as a sibling reliability ticket, this
was **reconsidered and closed not-actioned (run_148, founder decision)**: both commits were correct, green,
and founder-kept — not a correctness failure — and any guard strong enough to enforce
routing-through-the-gate would have to block or strand a commit, reintroducing commit-withholding (the
ADR-0023 / F21 anti-pattern the rebuilds removed). A detection-only version is governance-of-governance
(F5). See [ticket 0018](../tickets/closed/0018-enforce-verify-gate-commit-contract.md) (closed) for the
full reasoning.
