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

## Founder Ratified Decisions (run_166, 2026-06-20)
Both judgment calls above are now resolved by founder decision:
- **Two repair engines: KEEP BOTH.** The run_166 load-bearing verdict found Oz-repair vs Deb-repair
  `real` (distinct authority boundaries — Oz idle control-plane never touches a live Bob; Deb in-run
  triage never rescues the run). No merge.
- **Play taxonomy: REDUCE — reframe-and-reserve, do NOT delete.** The verdict found the taxonomy is the
  single over-modeled concept, but the founder confirms `tool/API-triggered` dispatch and `interactive`
  (browser control) **are committed future scope**, so the unused values are *forward-declared*, not dead.
  The ratified slice is therefore a **vocabulary/governance reframe, not a code deletion**:
  1. Amend ADR-0010 to describe the taxonomy as **three orthogonal axes** (`triggerClass`,
     `executionModel`, `writeScope` + the `kind` field) rather than "five named classes."
  2. Mark `tool/API-triggered` and `interactive` as explicitly **reserved / forward-declared** (named
     future use: API-triggered dispatch; interactive browser control) — declared in the contract,
     not yet exercised.
  3. Align any surface that restates the 5-class framing (ARCHITECTURE.md already uses axes — small).
  4. **Founder-approved manifest guard (in scope):** the per-persona Play manifest must NOT advertise
     reserved values to personas, so a persona cannot request a `tool/API-triggered` Play that no
     dispatch path honors yet (prevents a "looks supported, isn't" trap). This is the one behavior
     change in the slice; the Play behavior-pinning tests must stay green and gain coverage for it.
  No deletion of enum values. The reframe reverses ADR-0010's "five named classes" amendment via a new
  founder-approved ADR (this ratification authorizes it).

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
0. **[DONE — run_166]** Launch housekeeping + architecture linearization. Predecessor archived (90436db);
   canonical current-state map landed in `ARCHITECTURE.md` (abedaf9); ADR index already marked the
   superseded set.
1. **[DONE — run_166]** Behavior-pinning test net (Play taxonomy slice). Write-authority commit boundary
   pinned; the other three taxonomy behaviors were already pinned; 4 Play suites green (c61b929).
2. **[DONE — run_166]** Load-bearing verdicts. 10 of 11 distinctions `real`; Play taxonomy the one
   `suspect` (008db5b).
3. **[DONE — run_167]** Reframe-and-reserve the Play taxonomy per **Founder Ratified Decisions**
   above: atom 3a — ADR-0028 amending ADR-0010 (three axes; `tool/API-triggered` + `interactive`
   reserved/forward-declared); atom 3b — manifest guard so reserved values are not advertised to
   personas, plus surface alignment, with the Play behavior tests green and extended to cover the guard.
   No enum deletion.
4. **[DONE — run_167]** Closeout. Vocabulary → three axes; reserved values labeled honestly; Oz vs Deb
   repair kept distinct.

## Suggested Next Action
**Disposition: `archive-candidate` (run_167).** All five Verified-when criteria are met; the one ratified
refactor slice is built, test-protected, and committed. Remaining suspect distinctions exit as named
follow-ups (ticket 0020), not unowned intentions. Ticket `0023` closed run_168 (single archive dispatch
owner; orphan `/author` route removed).

**Founder gate:** confirm archive of this priority. **Next launch after archive:** `drift-audit` — atom 0
owner map confirming reuse-map symbols before P1 read-claims.
