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

## Phase 3 status (run_271 — DONE; founder resolved the decision → code-fix run next)

All five planned atoms completed and verified. Live reconciliation artifact:
[`docs/phase3-cross-doc-reverification.md`](../docs/phase3-cross-doc-reverification.md) (22-row inventory;
18 doc-side fixes landed; 2 CODE-WRONG conflicts flagged, not edited). Normative surface
(`packages/personas/base/**`) audited clean after 2 STALE-CLI fixes. Clarity/elegance pass deduped
commit-spine and product-routing ownership without changing facts. Process gaps 7–9 appended to
[`harden-documentation-process`](./harden-documentation-process.md). Audit worklists bannered
reconciliation-complete and deferred to the worklist-archive convention (not ad-hoc archived here).

**Disposition: `continue` — needs a verified code-fix run.** The founder resolved the commit-spine call
(Option B, 2026-06-27): the `commitOnlyScope` hold-back is a confirmed code regression from ADR-0023.
Doc reconciliation is otherwise complete, but archive-readiness now requires the code-fix pass specified
below (restore always-commit-and-flag, revert the docs Atom A bent toward the bug, confirm the proof
harness and ADR-0007/0023 consistency). Open ticket **0037** (stale CONTRIBUTING rg-CI-gate) is separate
from this governed-doc surface.

### Founder decision (RESOLVED — Option B, founder 2026-06-27)

**Decision: the live `commitOnlyScope: true` atom hold-back is a confirmed REGRESSION from ADR-0023, to
be fixed in code.** ADR-0023 Amendment 2 stands as written: the spine commits everything the actor
changed; out-of-lane paths are committed and FLAGGED, never withheld. Founder rationale (binding):
there is no human reviewer in an agentic system — "always save and flag" is the only safe rule, which is
exactly why the always-commit decision was made; the README being dropped three times is proof the
hold-back guard is over-engineered (a README should never be "out of scope"); and a priority's declared
write-scope is **only a suggestion** because the true scope is not fully known when the priority is
written, so enforcing it by *withholding* files inverts the intent. Oscar's earlier Option-A lean
("document what the code does") had the direction backwards: the doc/ADR was right, the code regressed.

This makes Atom A's surrounding doc edits (ARCHITECTURE commit-spine section, `docs/glossary.md`
write-scope entry, `docs/fault-injection-live-proofs.md`, `docs/orchestration-contract-ownership.md`,
`docs/oz-improvement-routing.md`) **wrong** — they described the buggy hold-back as current truth and
must be reverted to the always-commit-and-flag truth once the code is restored.

### Next pass — a verified CODE-fix run (NOT post-wrap doc support)

This is product code under `packages/**`, so it needs a fresh verified build run (Bob builds, Oscar
verifies per atom), not a Surface-A doc patch. Ordered spec:

1. **Code:** restore commit-everything-and-flag for verified-atom commits — remove/neutralize
   `commitOnlyScope: true` at `packages/core/src/runner/agent-step.ts:260,488` so the atom lane commits
   the whole changed set and flags out-of-lane paths (the `commitScoped` behavior). Make write-scope
   advisory (flag), never enforced by withholding. Run the runner/commit-spine suites green.
2. **Docs:** revert the Atom A edits listed above back to the ADR-0023 "always commit, flag, never
   withheld" claim. The `README.md` six→seven-packages fix lands automatically once the code is restored.
3. **Proof:** `scripts/proof-direct-spine.mjs` should pass with no edit once the code is fixed (it was
   asserting the correct behavior all along); confirm it exits 0.
4. **ADR consistency:** confirm ADR-0007 (write-scope advisory) and ADR-0023 (always-save) agree with
   each other and with the restored code — the founder's stated concern that the ADRs are right and
   correctly implemented.

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
