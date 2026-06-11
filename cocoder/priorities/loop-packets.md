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

**Disposition: `archive-candidate` (pending founder confirmation) — run_51 (2026-06-10) built ALL
six enforcement atoms loop-shaped + the wrap-up writeScope fix, 7/7 atoms verified and committed,
zero rejections.** The only remaining gap is the explicit follow-up the amendment already named: the
live-enforcement proof after a founder daemon restart (the daemon serves boot-time code, so run_51's
enforcement is unit-test-proven but not yet live). Never self-archive — founder confirms.

**Done (run_51, 7 atoms — `fe263cb`, `b1ce428`, `6da5334`, `ae8aa3a`, `1b5075f`, `a04051b`,
`bc5e5d7`):**
- Atom 0 (one-shot): wrap-up play writeScope now includes `cocoder/PLAYBOOK.md` +
  `cocoder/SESSION_LOG.md` (the run_48/49 `pending-scope-decision` parking bug).
- Atoms 1–5 (loop-shaped): structured `loop` directive schema with loud malformed-rejection
  (`directive.ts` + fail-fast in `io.ts`); runner-enforced iteration + wall-clock caps with
  blocked-with-ledger disposition (run continues, nothing committed); per-attempt `loop-iteration`
  run events (deduped, final-flushed); criterion rerun by the runner before sentinel acceptance
  (re-armed `R<n>` markers, fixed wall-clock budget, green still gates through verify); loop-aware
  monitor (ledger growth = progress, no false stall-nudges).
- Atom 6 (one-shot): standard doc gained an Enforcement section (runner-enforced vs builder-honored);
  inventory findings flipped to BUILT with the stale-daemon caveat.

**Pilot measurements (run_51 vs run DB baselines):** every loop-shaped atom completed in ONE
orchestrator round-trip (delegate → verify), zero rejections; per-atom wall-clock
(delegation → verify-pass) averaged ≈3.5 min (range 1.3–6.4 min; the heaviest, criterion-rerun
machinery, took 6.4 min). Comparable historical core-code unit: run_45's `POST /oz/messages` work
took TWO round-trips + a reject/re-scope ≈25.1 min (delegation-1 → verify-pass-2) for one unit of
work. Caveat recorded honestly: run_51 itself was driven by the pre-enforcement (boot-time) runner,
so these loop packets were dispatch-language/builder-honored — the contract alone already produced
the 1-round-trip/0-reject profile; runner enforcement adds the guarantees, provable live after
restart.

**Design-seam ruling (Oscar, run_51 — founder may veto):** iteration boundaries signal via a FILE
(`loop-ledger-<atom>.jsonl`, one JSON line per attempt), the house IPC pattern (directive/verify/
triage/nudge are all file artifacts) — classified design-homework, not founder judgment.

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
guidance ✅ committed · retrofit list founder-approved ✅ (2026-06-10) · pilot run + measured ✅
(run_51: 6 loop packets on real atoms, 1 round-trip/0 rejects each, ≈3.5 min avg vs run_45's
2-round-trip ≈25.1 min reject/re-scope unit — see Pilot measurements above) · enforcement atoms 1–6
✅ (run_51, unit-test-proven). **Archive proposed** — the one open follow-up is the live-enforcement
proof after a founder daemon restart (a structured-`loop` dispatch on a post-restart run showing
runner-recorded `loop-iteration`/`loop-criterion-rerun` events).
