---
id: orchestration-audit-and-refactor
title: "Orchestration: ADR audit, behavior-pinning tests, bounded refactor"
---

> **Founder-ratified 2026-06-20.** Successor to `orchestration-pipeline-simplification` (archived:
> analysis + first slice done). That run proved the
> runtime largely already converged onto one commit spine (ADR-0023) and one authoring composer
> (`composePriorityMarkdown`); the duplicate-runtime-path well is mostly dry. The complexity the founder
> still feels is **conceptual surface**, not duplicate code: the ADR accretion graph you must chase to
> answer "how does X work," the persona/role count, and the breadth of the Play taxonomy. This priority
> targets that, and — critically — builds the behavior-pinning test net FIRST so any collapse is provably
> safe, not asserted-safe.

## Objective
Make CoCoder's orchestration **understandable and provably stable** by (a) linearizing the orchestration
architecture so any agent or the founder can answer "how does commit / launch / repair / authoring work"
from **one** canonical place without chasing a chain of superseding ADRs, (b) pinning the actual
orchestration behaviors as black-box tests so the system's real contract is captured independent of its
current implementation, and (c) executing **one** bounded, test-protected refactor that reduces conceptual
surface — retiring or merging the single highest-confidence over-modeled concept.

This is NOT a hunt for duplicate runtime paths (ADR-0023 already drained that well). It is a reduction of
**concepts, ADRs-to-chase, and vocabulary**, with a regression net underneath it.

**Verified when:**
1. A single canonical **orchestration architecture map** exists (extending `ARCHITECTURE.md` /
   `docs/orchestration-contract-ownership.md`, not a new doc) that linearizes the two tangled stories —
   the commit-spine lineage (0015→0021→0022→0023→0024→0025) and the persona/observation lineage
   (0013→0016→0017→0026) — into a current-state description, and an ADR index marks every superseded ADR
   so the live graph an agent must read shrinks to the accepted set.
2. A **behavior-pinning test harness** (built with Talia) captures the real orchestration contracts as
   black-box tests — commit/landing, launch guard, verify gate, repair authority boundaries, authoring —
   green against current `main`, so a later refactor that preserves behavior keeps them green and one that
   breaks behavior fails them. Extends existing suites (`packages/core/tests/**`,
   `scripts/proof-orchestration-enforcer.mjs`), not a parallel harness.
3. Each guarded distinction from the predecessor owner map gets a one-line **load-bearing verdict**:
   *real* (collapsing loses behavior/evidence/reversibility/a safeguard — keep) or *suspect* (no safeguard
   lost — candidate to collapse via a new ADR). The verdict is evidence-backed, not assumed-from-"an-ADR-exists".
4. **One** suspect distinction is actually collapsed this priority — owner, files, new ADR (reversing an
   Accepted ADR requires a new founder-approved ADR), and green behavior-pinning tests proving no
   regression. The top candidate to evaluate first is the **Play taxonomy breadth** (trigger class ×
   execution model × write-authority, five named classes — ADR-0010's 2026-06-19 amendment): confirm
   whether all three axes and five classes are load-bearing or over-modeled for the small real Play set.
5. Every remaining suspect distinction exits as a named, sequenced follow-up — never an unowned intention.

## Founder Judgment Calls (surface before refactor)
- **Two repair engines.** Oz repair (idle, cross-session, control-plane; never touches a live Bob — ADR-0017
  tier 3) vs Deb repair (in-run escalation; advises Oscar only — ADR-0016). Architecturally distinct, but
  it is a real *product* question whether you want both. Map first; the founder decides if a merge is on
  the table (would need a new ADR).
- **How aggressive on the Play taxonomy.** Reduce axes/classes, or keep and document.

## Boundary
Audit and tests first; exactly one bounded refactor. May edit governance, docs, ADRs, and tests freely;
may touch runner/daemon/persona code ONLY for the one ratified refactor slice, protected by the
behavior-pinning tests. Do not reverse an Accepted ADR without a new founder-approved ADR. Elegance
standard is mandatory: fewer concepts, not a new lane to describe the old ones.

## Required Inputs
- `ARCHITECTURE.md`
- `docs/orchestration-contract-ownership.md` — predecessor owner map; extend it.
- `docs/oz-improvement-routing.md` — the Routing Guide shipped by the predecessor priority.
- ADRs 0010, 0012, 0013, 0016, 0017, 0023, 0024, 0025, 0026.
- `packages/core/src/runner/`, `packages/core/src/plays/`, `packages/daemon/src/launcher.ts`,
  `packages/daemon/src/oz-chat.ts`, `packages/personas/base/`
- `cocoder/priorities/archive/orchestration-pipeline-simplification.md` — predecessor; absorb its dispositions.
- Open tickets 0020/0021/0022 — predecessor follow-ups.
- Open ticket 0023 — `archive-priority` Play has no out-of-run dispatch surface (authoring-surface
  reachability defect found this run; fix is owner-preserving, not a second archive path).

## Proposed Atom Sequence
0. **Launch housekeeping + architecture linearization.** First run the `archive-priority` Play on the met
   predecessor `orchestration-pipeline-simplification` (it could not be archived post-wrap in run_165 —
   ticket 0023). Then produce the canonical current-state map and mark superseded ADRs. Docs only beyond
   the governed archive.
1. **Behavior-pinning test harness (with Talia).** Black-box tests over the real contracts, green on `main`.
2. **Load-bearing verdicts.** One-line evidence-backed real/suspect verdict per guarded distinction.
3. **One bounded refactor.** Collapse the top suspect (Play taxonomy first candidate) behind a new ADR,
   tests staying green. Other suspects → sequenced follow-up files.
4. **Closeout.** What got simpler, what stayed (and why it is load-bearing), the next launchable slice.
