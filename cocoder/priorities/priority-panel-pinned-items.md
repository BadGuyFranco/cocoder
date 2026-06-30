---
id: priority-panel-pinned-items
title: Pinned launcher panel + the ad-hoc / pinned-run model
scopeNarrowing:
  - cocoder/decisions/**
  - packages/daemon/**
  - packages/ui/**
  - packages/personas/base/plays/**
  - cocoder/personas/**
  - docs/**
---

## Objective

Replace the single pinned "Ad Hoc" row with a **pinned launcher panel** — three buttons across the top of
the priority stack — and settle the run model that all three share. This priority **merges** the former
`ad-hoc-session-architecture` decision-doc priority into the feature that consumes it, so the model is
decided and built as one body of work (founder decision, 2026-06-30).

The three pinned launchers (buttons, **not** queue items):

1. **Ad Hoc** — launch an Oscar/Bob/Deb session whose explicit first instruction is to *ask the founder
   what it wants done*. This is the existing `adhoc-session` runtime pseudo-priority; reconcile with it,
   do not duplicate it.
2. **Doc Review** — a Play that runs a deep, wide, multi-sub-agent review of **code, ADRs, and
   `ARCHITECTURE.md`** to repair conflicts, stale references, SSOT violations, and lapses in clarity,
   correctness, and elegance — so the north-star architecture docs accurately reflect the current repo.
3. **Process Review** — a Play that reviews **priorities and tickets** for conflicts, items that are
   actually complete, stale references, incomplete instructions, and lack of elegance.

Doc Review and Process Review carry **full-repair authority**: they commit their fixes directly through
the governed commit spine (ADR-0023), not report-only. But they are **founder-collaborative, not
autopilot** — along the way they must surface **true conflicts that need human judgment** to the founder
in plain English (the real disagreement, the options, a recommendation) so the founder decides the best
course, rather than silently picking a side. They auto-repair only the clear-cut, low-judgment fixes
(stale references, dead links, SSOT duplicates, obvious prose/correctness errors); anything that is a
genuine conflict or judgment call pauses for the founder. Because full-repair lets a review run rewrite
the north-star docs and governance, the model decision below must bound it.

This priority has two halves, sequenced **decision before implementation**:

### Half A — the model decision (ADR under `cocoder/decisions/`)

Land an ADR that generalizes today's single ad-hoc pin into a **pinned-launcher class** (Ad Hoc being one
instance) and settles, at minimum:

1. **The pinned-run model.** What a pinned launch *is* — how each of the three is launched, the scope and
   write-lane it gets, how Oscar/Bob/Deb are (or are not) involved, and how it terminates. Reconcile with
   the runtime `adhoc-session` pseudo-priority and `INTENTIONALLY_UNLISTED_PRIORITY_IDS`
   (`packages/daemon/src/priority-order.ts`), and decide whether `adhoc-session.md` remains the runtime
   definition or is absorbed (the audit flagged `ad-hoc-session-architecture.md` vs `adhoc-session.md` as
   overlapping-but-distinct — this ADR owns that reconciliation).
2. **Sequencing several pinned/ad-hoc runs.** Whether and how a founder runs multiple back-to-back in one
   workspace, what state (if any) carries between them, and the in-flight/queue semantics when no priority
   anchors them.
3. **Disposition + dashboard vocabulary.** Today the dashboard renders ad-hoc cards as **Needs decision**
   because such a run can wrap `awaiting-founder`; the founder considers that wrong — a pinned run is not a
   true priority and must not present as priority-style "needs decision" work. Decide the correct terminal
   vocabulary and dashboard treatment (e.g., a distinct pinned/ad-hoc wrap state vs. reusing
   `awaiting-founder`), with trade-offs, and apply it to all three pinned launchers uniformly.
4. **Full-repair guardrails + founder-in-the-loop.** How a Doc/Process Review run safely holds write
   authority over north-star docs and governance: it still rides the governed spine and Oscar's verify
   gate; **ADR reversals remain ADR-gated** (a review run may fix stale/incorrect prose and SSOT dupes,
   but never silently reverses an accepted ADR or rewrites a decision — that escalates to the founder);
   structural or judgment-heavy changes escalate rather than auto-commit. The ADR must define **how a
   true conflict is surfaced mid-run** — the plain-English question, options, and recommendation reach
   the founder, the run parks for the decision, and resumes with the answer — distinguishing the
   clear-cut fixes a review applies autonomously from the judgment calls it must hand to the founder.

### Half B — the implementation

Once Half A is approved: build the three-button pinned panel (hidden from the priority queue like the
current Ad Hoc row), wire the three launchers as standing pinned pseudo-priorities, author the **Doc
Review** and **Process Review** Plays (compose existing Plays — `deep-read`, `documentation`,
`code-review`, `priority-audit` — where they fit rather than inventing parallel machinery), and ship the
disposition/dashboard fix from Half A §3.

## Verified when

- An ADR covering Half A §1–§4 is delivered under `cocoder/decisions/` and founder-approved.
- The dashboard shows three pinned launcher buttons across the top of the priority stack; none of the
  three appears as a queue item; launching each starts the intended run.
- An ad-hoc / pinned run no longer renders as priority-style **Needs decision** (the §3 vocabulary is in
  effect), with a test pinning the new disposition.
- Doc Review and Process Review each run end-to-end and commit at least one real repair through the
  governed spine within their bounded authority; the repo's test Play is green for all shipped code.

## Notes

- Supersedes and absorbs the former `ad-hoc-session-architecture` priority (merged 2026-06-30).
- Motivating context: the ad-hoc wrap-disposition behavior observed on run_233 (`awaiting-founder`) and
  ticket 0051's run journal.
- Form-factor preference: three horizontal buttons across the top of the priority stack, not full
  priority rows — conform to that if feasible, and say so in Half A if it is not.
