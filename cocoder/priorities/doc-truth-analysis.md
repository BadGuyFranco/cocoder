---
id: doc-truth-analysis
title: Doc Truth Analysis
---
This priority's job is to do a comprehensive Doc review to ensure documentation is accurate (Architecture.md is of particular concern, but also having stale reference in ADRs or other documents should be reviewed) - you are NOT to just review the docs - you want to make sure that the docs match the code (and surface inconsistencies to fix in either direction) 

Our objective is clear, clean, correct and elegant docs.

## Objective

Every load-bearing claim in the repo's governed documentation is reconciled against the actual
code — ARCHITECTURE.md first (the priority's stated chief concern), then ADRs and other governed
docs — with each discrepancy resolved in the correct direction: the doc is fixed when the doc is
wrong, and a code/doc conflict is surfaced (ticket or founder decision) when the code is wrong.

Done when:
1. ARCHITECTURE.md and the reviewed ADRs/docs contain no claim that contradicts current code.
2. Every discrepancy found has a recorded resolution (doc corrected, follow-up ticket filed for a
   code fix, or founder decision surfaced) — none left silently unresolved.
3. The reconciled docs read clear, correct, and free of stale references (elegance standard).

Verification: a discrepancy inventory with zero unresolved items, and spot-checks of corrected
claims that trace to real code by file/path evidence.

> Objective drafted by Oscar from the founder's written priority intent (run_267). Founder owns this
> outcome and may refine it; phrasing is evidently derivable from the priority body above.

## Phase 1 status (run_267 — DONE, verified)

Reconciled to live code and verified: ARCHITECTURE.md (5 WRONG + 7 STALE fixed), ADR references
(8 broken/stale links fixed; ADR-9 left as already-self-marked historical), and 12 truth-critical
`docs/` files (13 discrepancies fixed, incl. orchestration.md run-model rewrite and the personas.md
Oz/Oscar/Bob/Deb/Quinn contradiction). Live worklists: `docs/architecture-truth-audit.md` and
`docs/docs-files-truth-audit.md` (every row carries verdict + resolution).

## Phase 2 — remaining doc surface (next session, no founder input needed)

- `cocoder/` governance docs (PLAYBOOK, AGENTS, glossary, failure-catalog, personas/standards/plays) —
  Oscar-lane (Bob cannot write these); audit against code and reconcile.
- Root `README` / `CONTRIBUTING` — audit for stale claims (note: open ticket 0037 already flags a
  stale CONTRIBUTING/PR-template rg-CI-gate).
- Design-intent briefs under `docs/` (oz-design-brief, oz-streaming-design, ui-dev-notes, research/) —
  audit for stale *path* refs only; do NOT flag aspirational design as "wrong".
- Cleanup to consider once the priority completes: whether the two audit worklist docs should be
  archived rather than kept permanently in `docs/`.

## Founder-directed code-or-doc follow-ups (founder decisions from run_267)

1. **`basePlaybooksDir()` dead export — DECIDED: remove it.** Founder directive: remove the dead
   export at `packages/personas/src/index.ts:12` (`packages/personas/base/playbooks/` is deleted).
   This is a CODE change (outside the doc lane) — file/run a small cleanup atom next session; confirm
   no remaining importer first (`grep -rn basePlaybooksDir`).

2. **`packages/core/src/playbooks/` p1–p6 modules — DECIDED: confirm, then clean up.** Founder
   directive: confirm these are orphaned (the only prior caller, the daemon executor branch, was
   deleted by ADR-0026) by enumerating live callers; then remove the genuinely dead modules and keep
   any with a real caller. Investigation BEFORE delete; CODE change outside the doc lane.

3. **Developer-mode routing gate — PENDING FOUNDER CALL.** Finding: `developer-mode` was a real v1
   CLI deny-gate (`--developer-mode` / `COCODER_DEVELOPER_MODE=1`, tested by the now-archived
   `developer-mode-belt.test.mjs`) that gated product-code writes. The v2 rebuild dropped it; **no
   `developer-mode` symbol exists in live `packages/`** (the only `devMode` hits are an unrelated UI
   design-ref mockup). v2 enforces the same product-code protection via per-run **write-scope +
   commit-gate hold-back**. ARCHITECTURE.md:390 and `docs/oz-improvement-routing.md:44` still say
   product routing requires "developer mode enabled" — stale v1 residue.
   - **Option A (recommended):** correct the docs to v2 reality (write-scope + commit-gate gating,
     dogfood/ADR-0012 framing); drop the "developer mode enabled" phrasing. No code.
   - **Option B:** re-introduce a v2 developer-mode flag as an explicit global product-write toggle.
     Net-new product work; only if a global kill-switch separate from per-run scope is wanted.
   Docs left unchanged pending this call.
