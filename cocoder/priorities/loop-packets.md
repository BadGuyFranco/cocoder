---
id: loop-packets
title: "Loop packets — loop-shaped dispatch as a first-class atom shape (dispatch language + planning only)"
scopeNarrowing:
  - packages/personas/base/**
  - packages/core/**
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
5. **Enforcement build (founder amendment, 2026-06-10 — see below):** build the six core-support
   gaps from `docs/loop-packets-dispatch-inventory.md` in `packages/core`, dispatching each atom
   **loop-shaped** — these atoms ARE the pilot/test runs Phase 4 calls for.

## Objective amendment — founder, 2026-06-10 (run_48 follow-up)

The original "dispatch language ONLY / zero orchestration-core changes" boundary is **lifted by the
founder**: rather than parking the six NOT-BUILT enforcement findings as a future priority, this
priority now builds them, and the NEXT run on this priority runs them as the live loop test — the
loop mechanism builds its own enforcement, loop-shaped, and the measurements come from those very
atoms. (Originally slated for session 49; run_49 launched off pre-amendment trunk — these rulings
hadn't landed yet — and wrapped with 0 atoms, so the build run is the next launch after run_49.)

**Planned atoms** (each test-gated, criterion `pnpm --filter @cocoder/core test` green +
`pnpm typecheck` + `pnpm check:topology`; all loop-amenable except #6):

1. **Structured loop directive fields** — additive schema in `directive.ts` + validation; prose-only
   delegate directives keep working unchanged; a malformed loop directive is rejected loudly, never
   silently treated as prose.
2. **Runner-enforced caps** — maxIterations + a loop wall-clock cap distinct from the atom timeout;
   cap-out → blocked-with-ledger disposition, nothing committed. (Contains a design seam: how the
   builder signals iteration boundaries to the runner — if it needs founder judgment it exits and
   surfaces, never gets guessed inside a loop.)
3. **Iteration-ledger capture** — one machine-readable run event per attempt (command result,
   failure, change, scope note).
4. **Criterion rerun by the runner** — execute the scripted criterion before accepting the builder's
   completion sentinel; sentinel-without-green-criterion = not done.
5. **Loop-aware monitor** — distinguish loop progress from idle stall in `monitor.ts`.
6. **Docs sync** (one-shot — editorial judgment): the standard doc marks which contract elements are
   runner-enforced vs still builder-honored; the inventory doc's findings flip to BUILT.

**Amendment guard-rails** (from the ADR-0010 conflict scan):
- The runner's criterion rerun ends the *builder's* iteration only — Oscar's verify (ADR-0011/0013)
  still gates every commit; a green criterion never bypasses the gate.
- **Stale-daemon caveat:** the live daemon serves boot-time code — the build run proves enforcement
  by unit tests; *live* enforcement takes effect only after a founder daemon restart, and the live
  proof is an explicit follow-up, never claimed from a green build run.
- Six findings ≠ one big atom (the run_45 scope-blowout lesson): one tightly-scoped atom per gap,
  whole-tree diff at every verify.

## Constraints (translated to the current architecture)

- ~~Dispatch language + planning docs only. Orchestration-core support needs are findings, not
  work.~~ **Lifted by the 2026-06-10 founder amendment** for the six inventoried findings; core
  changes beyond those six remain out of scope.
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

**Disposition: `continue` — the NEXT run on this priority builds the six enforcement gaps as
loop-shaped atoms; those runs ARE the live test** (founder rulings landed 2026-06-10, run_48
follow-up; previously `blocked` since run_47). Phases 1–3 complete and committed. **run_48:** 0
atoms delegated, no commits — Oscar verified no rulings on disk and wrapped; the founder then ruled
in the post-wrap conversation (recorded below). **run_49:** launched off pre-amendment trunk (the
run_48 rulings were stranded on its unmerged branch), so it saw the stale `blocked` Status and
wrapped with 0 atoms; its Oscar then landed run_48's branch in the post-wrap conversation
(2026-06-10) and launched the build run. Known machinery snag for the build run's Oscar: the wrap-up
play edits `cocoder/PLAYBOOK.md` + `cocoder/SESSION_LOG.md` but its writeScope
(`packages/personas/base/plays/wrap-up.md`) omits both, so run_48 AND run_49 parked
`pending-scope-decision` at wrap — schedule one small one-shot atom to add those two files to the
play's writeScope (in this priority's scope: `packages/personas/base/**`).

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

**Founder rulings (2026-06-10, run_48 follow-up conversation):**
1. Retrofit verdicts — **APPROVED as audited** (8 "no retrofit" stand; the 1 "retrofit" was voided by
   the run_47 correction). Verdict recorded in `docs/loop-packets-retrofit-audit.md`.
2. Pilot / enforcement — **the Objective amendment above**: the six core-support findings are built
   IN this priority, dispatched loop-shaped, and those atoms are the live test that produces the
   measured round-trips + wall-clock (vs comparable historical atoms from the run DB). Oscar first
   proposed a separate `loop-packet-enforcement` priority sequenced after an `full-oz-dashboard`
   pilot slice; the founder corrected that framing same-day — the separate file was deleted and folded
   in here. (`full-oz-dashboard` still runs next on its own merits; it is no longer the loop pilot.)

**Verified-when ledger:** standard doc + oscar.md amendment ✅ committed · atom-scoping/authoring
guidance ✅ committed · retrofit list founder-approved ✅ (2026-06-10) · pilot run + measured ⬜
(the next run: the enforcement atoms, loop-shaped — record round-trips + wall-clock here) ·
enforcement atoms 1–6 ⬜ (the amendment). Then propose archive (live-enforcement proof after a
daemon restart is the explicit follow-up).
