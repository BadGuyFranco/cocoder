---
id: drift-audit
title: "Drift Audit reframe — build the propose→ratify→apply drift flow as an Oscar-driven priority (ADR-0026)"
---

> **Archived 2026-06-21 (founder).** Verified-when met: the engine (read-claims→reality→compare→report→
> apply, proof-tested) was run against the dogfood; the 25 findings traced to a concrete mismatch — two
> **wholesale v1-stale memory files** — and the founder-ratified fix **landed in `cocoder/**`** (rewritten
> to v2 reality). Running it then exposed and we fixed the detector itself ([ticket 0024]: no crash + precise
> path detection), so corrected governance now yields **0 findings**. The apply was a manual rewrite (the
> correct apply for wholesale-stale files; the tool's per-line `applyRatifiedDriftWrites` is built +
> proof-green for the incremental case). **Deferred-as-always:** agentic *pattern* drift (retired flows, not
> gone paths) → named follow-up [[agentic-pattern-drift-detection]].

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
**Disposition: `refine-before-apply` (founder session 2026-06-21).** The "25 findings" were regenerated and
turned out to be a *wholesale v1-staleness* of two memory files (`cocoder/memory/codebase-map.md` +
`tech-stack.md` — `.mjs` extraction, `packages/schemas`/Zod, tmux, Node 20, `oz-daemon`/`oz-dashboard`).
That **real drift is now fixed** by a manual rewrite to v2 reality (the correct apply for wholesale-stale
files; the tool's per-line apply would have been lipstick). Re-running the audit against the corrected files
then exposed two defects in the detector itself — **[ticket 0024](../tickets/open/0024-drift-audit-detector-false-positives-and-crash.md)**:
it **crashes on a same-line duplicate claim id**, and its path detector is **false-positive-prone** (flags
package names, `ADR-NNNN` refs, slash-lists, globs, negations, and unresolved `../` links — 16 false
positives against the corrected files).

**Next launch:** fix ticket 0024 first (detector precision + no-crash, pinned in the drift suite) so a
correct governance file yields ~zero findings — the **prerequisite for a trustworthy ratify→apply**. Until
then apply stays manual. **Still deferred:** agentic ADR-content drift (retired *patterns*, not gone paths) —
e.g. the dead ADR-0015 merge/landing machinery (`mergeFastForwardOnly`/`mergeInto`/`completeMerge`/… no live
caller) that path-detection will never catch.
