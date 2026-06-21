---
id: drift-audit
title: "Drift Audit reframe — build the propose→ratify→apply drift flow as an Oscar-driven priority (ADR-0026)"
---

> **Build-launchable.** [ADR-0026](../decisions/0026-onboard-existing-as-oscar-priority.md) is **Accepted**
> and established the reframe model (ordinary Oscar-driven priority — atoms calling engines directly, **not**
> a standalone phase-executor). The onboard-existing flow was already rebuilt this way (run_140/141); this
> priority does the **same reframe for the Drift Audit**, the third of ADR-0020's three onboarding
> situations. Split out of [`new-primary-root`](./new-primary-root.md) (founder, run_160) so it has a clean
> Objective for a multi-session build; new-primary-root keeps only its founder-gated live proofs.
>
> **Reuse-heavy:** most of the machinery exists from the onboard-existing rebuild. The genuinely new logic
> is P1 read-claims, P3 compare, and P4 report. Do an **owner map first** (atom 0) before any build edit.

## Objective
Build the **Drift Audit** as an ordinary Oscar-driven priority: for an already-managed `cocoder/` root,
read what the governance **claims**, read the codebase **reality**, **compare**, emit a **drift report +
draft amendments/tickets**, the **founder ratifies a subset**, and only then **apply**. The audit phases
(read-claims → read-reality → compare → report) are **forbidden from writing governance**; only the
founder-ratified apply step writes `cocoder/**`; never product code (ADR-0020 Decision 5; the
`cocoder/**`-only trust boundary enforced at the commit spine, ADR-0023).

**Verified when:** a Drift run against the **CoCoder dogfood** (the first target) produces a report whose
findings each trace to a concrete governance-vs-reality mismatch, and the founder-ratified subset lands in
`cocoder/**` — i.e. Objective verification (b) of the onboarding work. **Boundary:** no product-code
writes; no new executor/runner-mode (the reframe explicitly retires that — ADR-0026); reuse the
onboard-existing engines as library tooling rather than forking a parallel contract.

The retired baked-plan skeleton is frozen at `cocoder/zArchive/playbooks/drift-audit.md` (P1 read-claims
→ P2 read-reality → P3 compare → P4 report → P5 ratify ▸hard gate → P6 apply). It remains design
history; the live delivery path is this ordinary priority's engine logic + ordinary-priority wiring.

## Reuse map (from the onboard-existing rebuild — confirm exact symbols in atom 0)
| Drift phase | Source |
|---|---|
| P2 read-reality | **Reuse** `recon`/`recon-pass` (`inventoryRepo`, `runAgenticRecon`) + deep-read fan-out (`p2-fanout` `runDeepReadSource`/`combineSourcePair`, `p2-dispatch` `resolveDeepReadAssignments`/`createDeepReadTurn`) |
| P5 ratify / P6 apply | **Reuse** `p6-apply` (materialize staged → `cocoder/**`) + the `AuditWriteBoundary`/`AuditWriteBoundaryError` at `runCommitGate` (`cocoder/**`-only, refuse-not-flag) |
| Driver + founder gates | **Reuse** the ordinary Oscar↔Bob run loop + directive/verify/wrap/resume (ADR-0010/0013); the P5 ratify is a normal Oscar wrap/verify beat, **not** an in-loop executor gate |
| **P1 read-claims** | **NEW** — pure reader of the target's `cocoder/` governance (memory/codebase-map, ADRs, priorities, standards, scopes) → claims inventory |
| **P3 compare** | **NEW** — claims-vs-reality diff → drift findings, each traceable to a concrete mismatch (stale maps, ADRs describing retired patterns, priorities referencing gone code, drifted scopes, undocumented subsystems) |
| **P4 report** | **NEW** — emit a drift report + amendment/ticket drafts (artifacts ONLY; never rewrite governance in place) |

## Proposed atom sequence (multi-session; forced green-at-every-commit; each delicate atom its own session)
0. **Owner map** — classify every onboard-existing engine as REUSE-AS-IS / ADAPT / NEW for Drift, with
   file:line evidence, and define how Drift runs as an ordinary priority (atoms call engines directly;
   gates = wrap/verify beats). Mirror run_140's `docs/onboarding-rebuild-ownermap.md`. (docs/, no product edit.)
1. **P1 read-claims engine** — pure, deterministic governance reader → `claims` inventory; refuse-on-malformed.
2. **P2 read-reality wiring** — drive `recon` + deep-read fan-out to a reality inventory (reuse, don't fork).
3. **P3 compare** — claims-vs-reality diff → traceable drift findings (non-gameable; empty inputs → empty).
4. **P4 report** — drift report + amendment/ticket drafts as artifacts (no governance writes).
5. **P5 ratify + P6 apply** — founder ratifies a subset; apply via the commit spine with the audit
   write-boundary (a path outside `cocoder/**` is REFUSED, not flagged).
6. **Runnable proof + live dogfood Drift** — a `scripts/proof-drift-*.mjs` (style of `proof-onboard-existing.mjs`)
   for the invariants, then the live dogfood Drift run (Objective verification (b)).

## Context & Evidence
- ADR-0026 reframe + the onboard-existing rebuild (run_140/141) are the template: engines kept as tooling,
  executor + phase protocol retired, founder gates as ordinary beats, `auditWriteBoundary` frontmatter on
  the onboarding priority (absent ⇒ ordinary behavior). See `new-primary-root.md` rebuild decomposition.
- **The first Drift Audit was already run by hand** — the 2026-06-14 ADR-reset + priority-audit session
  (read-claims → read-reality → compare → propose → ratify → apply) validated these exact phases. This
  build systematizes a proven flow, not an unproven one.
- New Primary + Drift adopt the same scaffold-seeded-priority delivery model as onboard-existing (ADR-0020
  §7 amendment, run_140): the shipped Drift onboarding priority would live at
  `packages/personas/base/priorities/` and be scaffold-seeded into a target — but that is an OUTPUT of this
  build, distinct from this build priority.

## Suggested Next Action
**Disposition: `continue` (run_163).** Build complete since run_161 — no build atoms this run; re-verified
`node scripts/proof-drift-audit.mjs` green and live dogfood still yields **25 verified stale-path findings**
(Objective verification (b) report half).

**Next launch:** founder ratifies a subset of the 25 dogfood findings and chooses apply materialization
(new amendment/ticket records under `cocoder/**` vs precise in-place edits to stale governance files), then
one ratify→apply atom lands them via `applyRatifiedDriftWrites`. Regenerate the report with
`node scripts/run-drift-audit.mjs "/Volumes/NAS LOCAL/CoCoder" /tmp/drift-report`. **Deferred (not blocking):**
agentic ADR-content drift (retired *patterns*, not just gone paths) — needs deep-read reality enrichment, out
of scope here.
