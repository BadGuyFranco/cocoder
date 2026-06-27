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

## Phase 2 status (run_269 + run_270 — DONE)

Reconciled to live code and verified: root `README` / `CONTRIBUTING` / PR template / issue template;
design-intent briefs (`docs/oz-design-brief`, `oz-streaming-design`, `oscar-deb-repair-dialogue-design`,
`founder-brief-format-durability`); eight remaining truth-critical `docs/` files (path refs and stale
claims in `oz.md`, `oz-launch.md`, `oz-hardening-owner-map`, `loop-packets-dispatch-inventory`,
`fault-injection-live-proofs`, plus worklist rows in `docs-files-truth-audit.md`); and `cocoder/`
governance docs audited (PLAYBOOK, AGENTS, failure-catalog, standards/plays deltas, personas/AGENTS.md)
— all clean. The two stale path refs in `cocoder/personas/AGENTS.md` were closed in
[run_270 / ticket 0069](../tickets/closed/0069-personas-agents-stale-archive-and-v1-leftover-refs.md).

## Remaining before archive

Nothing blocking. Optional cleanup (not blocking archive): whether the two audit worklist docs under
`docs/` should be archived rather than kept permanently. Open ticket **0037** flags a stale CONTRIBUTING
rg-CI-gate — separate from this priority's governed-doc surface and tracked as its own ticket-fix.

## Founder-directed code-or-doc follow-ups (founder decisions from run_267)

1. **`basePlaybooksDir()` dead export — DONE in run_268.** Removed from `packages/personas/src/index.ts`;
   zero callers repo-wide; typecheck green.

2. **`packages/core/src/playbooks/` p1–p6 modules — DONE in run_268.** Orphan investigation confirmed a
   closed dead subgraph; 23 modules + 11 orphaned tests deleted; `recon.ts` (`inventoryRepo`) kept as
   sole live export for drift/read-reality tooling.

3. **Developer-mode routing gate — DECIDED (Option A) and DONE in run_267.** Founder chose "document
   what is true now." Corrected `ARCHITECTURE.md:390` and `docs/oz-improvement-routing.md:44` to the v2
   reality (product writes gated by per-run write-scope + commit-gate hold-back; no developer-mode
   toggle) and removed the stale "developer mode enabled" phrasing. Audit row 52b marked resolved. No
   code change. Context retained below:
   Finding: `developer-mode` was a real v1
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
