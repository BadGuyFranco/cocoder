---
id: loop-packets
title: "Loop packets — loop-shaped dispatch as a first-class atom shape (dispatch language + planning only)"
scopeNarrowing:
  - packages/personas/base/**
  - docs/**
---

## Objective
Make **bounded iteration a first-class dispatch shape**: Oscar can dispatch a **loop packet** — an
atom whose builder grinds against a **deterministic, scripted exit criterion** under hard caps —
instead of burning Oscar↔Bob round-trips on every retry. Fable-class lead models and stronger
verification tooling make "iterate until the criterion passes" viable; today every iteration is an
expensive orchestrator round-trip. This priority changes **dispatch language and planning artifacts
ONLY** — zero orchestration-core changes (any core-support need is a surfaced **finding for the
founder**, never built here). **Verified when:** the loop-packet standard doc + the base `oscar.md`
amendment (when to choose loop-shape vs one-shot) are committed; atom-scoping/priority-authoring
guidance requires every atom to declare its **exit criterion** and **loop-amenability**; the
retrofit list over active priorities is founder-approved **per priority, not wholesale**; and ONE
pilot loop packet has run on a real atom with a **measured round-trip + wall-clock before/after**
against a comparable historical atom (the run DB holds the baselines). Then propose archive.
Boundary: the `scopeNarrowing` above is declared up front (the v2 descendant of the old
boundary-file-first rule); founder gates are NEVER inside a loop — anything gated exits the loop and
surfaces.

## The loop-packet contract (founder spec, 2026-06-10)

A loop dispatch must carry, in the directive body:

1. **Goal** — one line.
2. **Verifiable exit criterion** — a deterministic, *scripted* signal: named test command green,
   golden-output diff clean, benchmark threshold met, Quinn case PASS (once Quinn is staffed; test
   suites until then). **If the criterion cannot be scripted, the atom is NOT loop-amenable** — it
   stays a normal one-shot gated atom.
3. **Max iterations** (default 5) **and a wall-clock cap.** On cap-out without success: stop, report
   the atom **blocked** with the full iteration ledger, and never widen scope to force progress.
4. **Per-iteration self-critique** in the result evidence: what failed, what changed.
5. **Scope guard:** the loop may only touch files inside the atom's write boundary, and may only
   chase defects **observable in the failing criterion** — synthetic/hypothetical hardening exits
   the loop and surfaces to the founder (the run_45 scope-blowout lesson, generalized: diff the
   whole tree at verify; fail anything beyond the delegated atom).

The loop's criterion ends the *builder's* iteration — it does not replace the gate. Oscar's verify
(ADR-0011/0013) still gates the commit, exactly as for one-shot atoms.

## Phases

1. **Design** (builder researches, Oscar pressure-tests): inventory the current
   directive → monitor/sentinel → verify → commit mechanics; define the loop-packet template as
   **dispatch language only**. Deliverables: the standard doc — home decided by the portability test
   (ADR-0012; loop dispatch is general behavior, so expected home is the shipped base) — plus the
   base `oscar.md` amendment: when Oscar chooses loop-shape vs one-shot.
2. **Planning integration:** the create-priority flow (ADR-0010) and Oscar's atom-scoping guidance
   require every atom to declare its exit criterion and loop-amenability; new priorities get this by
   default.
3. **Retrofit audit:** walk the active `cocoder/priorities/*.md`, flag atoms that should be
   re-shaped as loop packets, and bring the founder ONE plain-English decision list — approval per
   priority, never wholesale.
4. **Pilot:** ONE loop packet on a real atom from an active priority, with a test suite as the exit
   criterion; measure round-trip count and wall-clock against a comparable historical atom. Report
   findings to the founder **before any wider rollout**.

## Constraints (translated to the current architecture)

- Dispatch language + planning docs only. Orchestration-core support needs are findings, not work.
- Runs stay on isolated run branches with the verified auto-merge (ADR-0015) — the current form of
  the old "staging-only" rule.
- Founder gates never live inside a loop.
- Base-touching deliverables (the standard doc, `oscar.md`) pass the ADR-0012 portability test at
  verify like any base change.

> Translation note (recorded so the spec's provenance is honest): the founder's brief used
> pre-reorg vocabulary — "PRIORITIES.md" → this flat stub (the directory listing is the index);
> "priority boundary file (Rule 20a)" → the `scopeNarrowing` frontmatter above; "orchestration/docs/"
> → home decided in Phase 1 by the portability test; "Rule 29 synthetic hardening" → the scope-guard
> clause above; "Decision Presentation" → a plain-English founder decision (shared standard #8).
