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

## Status

**Disposition: `blocked` on founder decisions** (run_47, 2026-06-10). Phases 1–3 complete and
committed; Phase 4 (the pilot) cannot start until the founder rules on the decision list below.

**Done (run_47, 4 atoms — `1356b5a`, `b8d29a1`, `ce04957`, `4c7fa51`):**
- Phase 1: loop-packet standard (`packages/personas/base/standards/loop-packets.md` — full five-element
  contract, not-loop-amenable rule, founder-gates-never-in-a-loop, Oscar-still-gates, worked example) +
  base `oscar.md` "Loop-shaped dispatches" section (when loop vs one-shot). Both pass the ADR-0012
  portability test (generic language).
- Phase 2: planning integration — base `oscar.md` now requires every scoped atom AND every planned atom
  in new-priority decomposition to declare its exit criterion + loop-amenability (unscriptable →
  one-shot).
- Phase 3: retrofit audit over the 9 active Playbooks (`docs/loop-packets-retrofit-audit.md`) + the
  dispatch-mechanics inventory with six NOT-BUILT core-support findings
  (`docs/loop-packets-dispatch-inventory.md`).
- Correction (Oscar): the audit's pilot pick (`cli-config-and-model-discovery` UI wire-up) was based on
  that Playbook's stale Status — the atom landed in run_42 (`d76cb5a`). Playbook fixed; audit carries a
  dated correction; no audited priority currently names a ready-made loop-amenable atom.

**Founder decisions outstanding (per priority, never wholesale):**
1. Retrofit verdicts — approve/reject each audit entry (8 are "no retrofit"; the 1 "retrofit" is
   voided by the correction).
2. Pilot selection — recommended: carve a test-gated slice from `full-oz-dashboard` (e.g. the persona
   mode/sub-agents runner-honoring gap, criterion `pnpm --filter @cocoder/core test` +
   `--filter @cocoder/daemon test`) and run it loop-shaped with measured round-trips + wall-clock vs a
   comparable historical atom from the run DB.
3. Core-support findings — the six NOT-BUILT enforcement gaps in the inventory doc (structured loop
   fields, runner-enforced caps, ledger capture, loop-aware monitor, runner criterion rerun): file as
   a future priority, or accept trust-the-builder for now.

**Verified-when ledger:** standard doc + oscar.md amendment ✅ committed · atom-scoping/authoring
guidance ✅ committed · retrofit list founder-approved ⬜ (decision 1) · pilot run + measured ⬜
(decisions 2, then a follow-up run on the chosen priority). Then propose archive.
