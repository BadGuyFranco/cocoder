---
id: harden-documentation-process
title: Harden the documentation process so docs cannot silently drift from code
---

> **Archived 2026-06-28 (founder) — All three objective conditions verified on live tree: CI
> doc-reference gate (drift-doc-reference-gate + drift-resolve-doc-references tests), four-type
> doc-type taxonomy and worklist-archive convention in docs/freshness-policy.md, and
> architecture-truth-audit.md + docs-files-truth-audit.md moved under docs/archive/. No bound open
> tickets. Items 7-9 out of scope per priority boundary.** Founder confirmed archive (run_286).

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
   permanently in `docs/`; as the seed migration, the convention is applied to
   `docs/architecture-truth-audit.md` and `docs/docs-files-truth-audit.md`.

The hardening must itself be elegant (shared elegance standard): reuse existing seams (CI, lint,
front-matter), add no heavyweight new machinery, and keep one owner per rule. **Boundary:** this
priority builds the *process/guardrails*; it does not re-audit doc content (that is Doc Truth Analysis).

**Done when:** the reference check runs in CI and fails a deliberately-planted broken reference; the
doc-type taxonomy is applied to the governed doc set; the worklist-archive convention is documented in
one owner doc; `docs/architecture-truth-audit.md` and `docs/docs-files-truth-audit.md` have been moved
under that convention; and the whole process is described in a single owner location (not duplicated).

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
   **→ A convention to archive worklists on priority completion, plus a seed migration that moves these
   two files under the new convention.**

5. **One-owner drift.** The same contract is sometimes documented in multiple homes; the shared
   standards repeatedly warn against this, but nothing detects a second copy of a documented contract.
   **→ Enforce one-owner for documented contracts where feasible.**

6. **Doc-update-with-code is review-only, with no reviewer.** CONTRIBUTING says "update docs in the same
   PR," but CI "cannot prove that relationship" and CoCoder is agent-built with no human PR review.
   **→ Consider a mechanism linking a truth-critical code change to a doc-touch obligation.**

7. **A governed doc with no owning write-lane cannot have its correct fix committed (run_271).** During
   Phase 3, the correct `README.md` six→seven-packages fix (it omitted `@cocoder/personas`) was produced
   three times and **held back as uncommitted dirt every time**, because root `README.md` is in neither
   the builder's write scope (`packages/**`, `templates/**`, `docs/**`, `ARCHITECTURE.md`, …) nor Oscar's
   support scope (`cocoder/**`, `docs/**`, `ARCHITECTURE.md`). A verified-true correction with no owning
   lane silently cannot land. **→ Every governed doc must fall inside some run's committable write-lane
   (extend a scope to cover root docs, or give root `README`/`CONTRIBUTING` an explicit owning lane).**

8. **Code can silently reverse an accepted ADR with nothing turning red (run_271).** Commit `ccd3ae9`
   (2026-06-25) made verified-atom commits pass `commitOnlyScope: true` (hold back out-of-lane files),
   contradicting ADR-0023 Amendment 2's stated rule that out-of-lane paths are "committed and flagged,
   never withheld" — an ADR-gated reversal with no new ADR. No check asserts code against ADR-pinned
   invariants, so the divergence sat undetected until this manual audit. This is the **inverse** drift
   direction from items 1–3 (code drifts from doc, not doc from code). **→ Consider pinning load-bearing
   ADR invariants as named tests/assertions so a silent ADR reversal turns something red.**

9. **A proof harness asserting current behavior rots silently when it is not in CI (run_271).**
   `scripts/proof-direct-spine.mjs` still asserts the retired "committed and flagged" spine behavior and
   now **exits 1**, but it is run on demand, not in CI, so its failure announced nothing — the audit
   found it, not tooling. A harness whose job is to prove current behavior is itself a current-truth
   artifact and rots like any doc. **→ Behavior-proof harnesses that assert current truth should be
   covered by the reference/CI check (or retired), not left to drift.**

## Disposition — `archive-confirmation` (run_285/run_286, 2026-06-28)

All three objective conditions are built and verified: `pnpm test` runs a CI doc-reference gate that
turns red on newly broken markdown links, ADR ids, or package names; the four-type doc taxonomy is
applied across the governed set; and the worklist-archive convention is documented in
[`docs/freshness-policy.md`](../../docs/freshness-policy.md) with
`docs/architecture-truth-audit.md` and `docs/docs-files-truth-audit.md` moved under
`docs/archive/`. Pre-existing content drift and inventory items 7–9 (root README/CONTRIBUTING write-lane,
ADR-0023 commit-scope divergence, rotting proof harness) are explicitly out of scope per the priority
boundary. Run_286 (display 145) re-verified the live tree with zero build atoms; founder confirmed
archive (`please archive`). Do not relaunch for build work.
