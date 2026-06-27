---
id: harden-documentation-process
title: Harden the documentation process so docs cannot silently drift from code
---

> Crafted by Oscar at founder direction (2026-06-27), from concrete gaps surfaced across the Doc Truth
> Analysis runs (run_267/269/270). Founder owns the Objective and may refine it (ADR-0010); the
> problem inventory below is what the audits actually observed and is meant to be extended by the
> Doc Truth Analysis Phase-3 process-observation pass.

## Objective

CoCoder has an **enforceable, low-overhead** documentation-truth process that prevents silent doc/code
drift — so the repo never again needs a multi-run manual audit to discover that load-bearing docs went
stale. Verified by:

1. **A reference-resolution check in CI** that fails when a governed doc's concrete references do not
   resolve against the live tree: internal markdown links, file/dir paths, ADR ids, CLI
   commands/flags, package names, and named code symbols. (A planted broken reference must turn CI red.)
2. **A doc-type taxonomy** — every governed doc is classified (current-truth / design-intent /
   owner-map / historical) with a freshness rule applied per type, so the check knows which docs MUST
   match code and which are aspirational or historical and must not be flagged as "wrong."
3. **An archive convention for one-shot audit worklists**, so audit artifacts do not accumulate
   permanently in `docs/`.

The hardening must itself be elegant (shared elegance standard): reuse existing seams (CI, lint,
front-matter), add no heavyweight new machinery, and keep one owner per rule. **Boundary:** this
priority builds the *process/guardrails*; it does not re-audit doc content (that is Doc Truth Analysis).

**Done when:** the reference check runs in CI and fails a deliberately-planted broken reference; the
doc-type taxonomy is applied to the governed doc set; the worklist-archive convention is documented in
one owner doc; and the whole process is described in a single owner location (not duplicated).

## What the audits noticed could be better (problem inventory — evidence-backed)

1. **No automated reference validation — drift accumulated silently.** Run_267 found ARCHITECTURE.md
   alone carried 5 WRONG + 7 STALE claims; later runs found renamed packages (`oz-dashboard` →
   `@cocoder/ui`), removed CLI flags (`--allow-integrity-errors` → `--allow-pre-run-integrity-errors`),
   moved run-dir paths (`local/runs/<runId>` → `local/runs/<wsId>/<runId>`), dead ADR filenames, and a
   doc claiming Oz "is not an LLM agent" long after the headless Oz agent shipped. None of this was
   caught by tooling. There *was* a stale-reference `rg` CI gate; it was removed in the v2 thinning
   (ticket 0037) and nothing replaced it. **→ Restore a better, structured reference check.**

2. **Brittle line-number anchors.** Owner-maps cited `file.ts:NN` anchors that silently drifted as code
   moved (run_269 had to strip stale anchors from `oz-hardening-owner-map.md`). **→ Prefer
   symbol/section anchors, or validate line anchors against current content.**

3. **No enforced doc-type discipline.** Docs freely mix aspirational design, owner-maps, current-truth,
   and historical record with no consistent label, so every audit had to *judge per claim* whether a
   mismatch was "wrong" or "intended-future/historical" (e.g. Proof-4 procedure, design briefs,
   superseded ADR references). `docs/freshness-policy.md` exists but is unenforced; only `oz.md`
   carries a "Last verified" stamp. **→ A doc-type taxonomy + freshness rule the check can act on.**

4. **Audit worklists live permanently in `docs/`.** `docs/architecture-truth-audit.md` and
   `docs/docs-files-truth-audit.md` are one-shot reconciliation artifacts with no archive home.
   **→ A convention to archive worklists on priority completion.**

5. **One-owner drift.** The same contract is sometimes documented in multiple homes; the shared
   standards repeatedly warn against this, but nothing detects a second copy of a documented contract.
   **→ Enforce one-owner for documented contracts where feasible.**

6. **Doc-update-with-code is review-only, with no reviewer.** CONTRIBUTING says "update docs in the same
   PR," but CI "cannot prove that relationship" and CoCoder is agent-built with no human PR review.
   **→ Consider a mechanism linking a truth-critical code change to a doc-touch obligation.**
