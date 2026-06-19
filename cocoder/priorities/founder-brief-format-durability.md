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

## Repair progress — disposition: `continue` (after run_147)

Landed through the gate: owner inventory in
[`docs/orchestration-contract-ownership.md`](../docs/orchestration-contract-ownership.md) (`036e618`). This
is the source of truth for the work queue below; it survives all decisions here.

Landed OUTSIDE the gate but KEPT — founder decision (run_147): commit `aa7addc`, self-committed by the
builder, carries the governing rule (`packages/personas/base/shared-standards.md`), the structural enforcer
(`packages/core/tests/orchestration-contracts.test.ts`), the single-source alignment of `runner.test.ts`
and `base-personas.test.ts` (closeout labels now derived from the wrap-up Play, not hard-coded), and the
design-ref-historical guard. The full core suite is green (379/379). The founder chose to **fix forward,
not revert**: the work is sound and green, a revert would not clean history, and the run_145 guard below is
the better governance answer than discarding it.

### Next run — use a scope-respecting builder and gate EVERY atom (no builder self-commits)
1. **Bless the landed work**: line-by-line review of the `aa7addc` `runner.test.ts` rewrite (confirm it only
   replaces hard-coded labels with derived ones and weakens nothing), and add an explicit red→green proof of
   the enforcer — introduce a deliberate duplicate, watch `orchestration-contracts.test.ts` fail, remove it,
   watch it pass (Objective §4).
2. **Delete the duplicate inventory** `cocoder/priorities/founder-brief-format-durability.owner-inventory.md`
   — redundant with the owner doc above; a one-owner violation that must not stand in this priority.
3. **Reconcile tickets**: close `0017` by repair (rule is landed); confirm the `0012`/`0015` edits match
   their dispositions in the owner doc; file the run_145 sibling ticket named below.
4. **Record the run_147 gate-bypass incident** in `cocoder/failure-catalog.md` (builder self-committed
   `aa7addc` past the verify gate — the in-class proof that the gate is unenforced).
5. **Apply ticket 0005's side-channel rules** to their governed homes (still open from the owner doc queue).

## Required Ticket Review
Review related tickets before proposing fixes and fold each into the owner inventory:

- [0017](../tickets/open/0017-promote-founder-brief-single-source-rule-to-shared-standards.md) — promote the
  founder-brief single-source rule into shared-standards (created by run_145). **This priority now subsumes
  it**: land the rule and the enforcer here, then close 0017 by repair.
- [0005](../tickets/open/0005-persona-file-memory-migrations.md) — persona/shared-standards lessons stranded
  in a ticket instead of the governed file: the governed-file-vs-side-channel-memory flavour of the class.
- [0012](../tickets/open/0012-design-ref-rebuild-clobber-guard.md) — generated UI/design-ref can clobber
  committed fixes when the generator is not the aligned source: the generated-vs-source flavour.
- [0015](../tickets/open/0015-tickets-silently-dropped-without-frontmatter.md) — authoring-format/loader
  drift silently dropped ticket artifacts: the authoring-format-enforcement flavour.
- [0008](../tickets/closed/0008-post-wrap-founder-interaction-contract.md) — (closed) prior
  durable-orchestration repair that aligned prompts, wrap delivery, Deb status, daemon, and tests around one
  contract: the precedent pattern to copy.

Also review any other ticket indicating source-of-truth drift, authoring-format enforcement,
brief/wrap/closeout behavior, Play output, persona/standards memory, or generated-artifact clobbering. The
closeout must say, per ticket, whether it was folded in, fixed/closed by the repair, or left a sibling, and
why.

## Related observation — DECIDED: sibling ticket (run_147)
The run_145 direct commit (`90599db`) and the run_147 builder self-commit (`aa7addc`) are the same in-class
defect: an unenforced contract — "agent edits land only through the verify gate" — lets ungoverned changes
reach the branch. The founder scoped this as a **sibling reliability issue**: file a tracking ticket and
build the gate-enforcement guard as separately-launchable work, because a real guard may touch git
workflow, commit-spine policy, or host controls beyond prompt/runtime text. Next run files the ticket; the
guard build is its own priority, not folded into this format/contract repair.
