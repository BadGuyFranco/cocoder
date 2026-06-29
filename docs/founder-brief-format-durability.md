---
doc-type: historical
---

# Founder Brief Format Durability

Repair status: shipped in commit `90599db`; this document is the diagnosis of record for the completed
single-source repair, not a proposal for future runner work.

## Evidence pack — six observed occurrences

I confirmed six real founder-brief / closeout-format drift occurrences from durable records and, where
still present, the original run artifacts:

1. **run_76 ended with un-runnable fault-injection homework.** The wrap told the founder to restart the
   daemon and run the Proof-4 checklist by hand (`local/runs/cocoder/run_76/wrapup-out.txt:13-15`). The durable
   catalog records this as F18: a run finished the build but left the founder with a doc/checklist pointer,
   not a runnable next action (`cocoder/failure-catalog.md:47`).
2. **run_77 repeated the same checklist handoff after run_76.** Its wrap again made the founder run the
   Proof-4 checklist and produce event evidence (`local/runs/cocoder/run_77/wrapup-out.txt:19-21`). The session log
   records the same live-proof checklist handoff for run_77 (`cocoder/SESSION_LOG.md:726-734`).
3. **full-oz-dashboard kept producing empty reaffirmation wraps instead of a runnable next step.** run_75
   was the fifth zero-atom reaffirmation and still told the founder to run a live ladder by hand
   (`local/runs/cocoder/run_75/wrapup-out.txt:1-3`, `local/runs/cocoder/run_75/wrapup-out.txt:13-19`). The catalog records
   the repeated run_68/70/74/75 stall under F18 (`cocoder/failure-catalog.md:47`).
4. **run_78 claimed landing truth before settlement.** Its `Committed` section said the atoms were
   "verified for landing" and "Nothing held back" (`local/runs/cocoder/run_78/wrapup-out.txt:21-23`), while the
   actual run record says `pending-landing`, integration `escalated`, not landed
   (`local/runs/cocoder/run_78/record.md:5-8`). F19 records the same false "verified for landing" / "Nothing held
   back" drift (`cocoder/failure-catalog.md:48`).
5. **run_79 named a next build run that was not launchable.** The wrap told the founder the next fresh
   build run should "launch a priority audit" (`local/runs/cocoder/run_79/wrapup-out.txt:17-19`) while the proof
   artifact it depended on was held back (`local/runs/cocoder/run_79/wrapup-out.txt:21-26`). F20 records the
   non-existent `priority-audit` handoff and founder-stuck outcome (`cocoder/failure-catalog.md:49`).
6. **run_94 emitted a `Run Handoff` box and options menu, not the canonical founder brief.** The wrap starts
   with `Priority worked`, `Disposition`, `This run`, and `Your move` fields
   (`local/runs/cocoder/run_94/wrapup-out.txt:1-9`) and ends with a multi-option `Founder Options` menu
   (`local/runs/cocoder/run_94/wrapup-out.txt:35-41`). The durable session log records run_94's design-ref
   rebuild-clobber source-of-truth finding and follow-up ticket (`cocoder/SESSION_LOG.md:470-476`), and F21
   records the same single-source drift class (`cocoder/failure-catalog.md:50`).

Evidence count: six confirmed occurrences. I did not invent any missing sixth item; every item above cites
a file opened and confirmed during this consolidation.

## Owner map

- Source of truth: `packages/personas/base/plays/wrap-up.md` owns the founder-visible closeout format.
  Its fenced contract names the exact labels and order, and its prose owns the content constraints for
  `What Changed`, `Run Status`, `What Remains`, `Recommended Next Step`, `Commit State`, `Teardown
  Readiness`, and final standing-by line (`packages/personas/base/plays/wrap-up.md:44-115`).
- Persona surface: Oscar is a consumer only. It points at the wrap-up Play and explicitly says not to
  invent a parallel shape (`packages/personas/base/oscar.md:162-164`).
- Runner prompt surface: Oscar's wrap-up directive mentions the wrap-up Play section contract instead
  of restating the labels (`packages/core/src/runner/prompts.ts:162-169`).
- Daemon launch surface: run input loads the effective `wrap-up` Play, including repo deltas, before
  handing it to the runner (`packages/daemon/src/launcher.ts:96-119`); launch coverage proves deltas are
  merged into that effective Play (`packages/daemon/tests/play-delta-launch.test.ts:61-78`).
- Runtime enforcement: the runner now parses the effective Play's fenced contract, validates the
  wrap-up output against that parsed contract, and renders its malformed-brief fallback from the same
  parsed labels (`packages/core/src/runner/runner.ts:182-197`,
  `packages/core/src/runner/runner.ts:244-335`, `packages/core/src/runner/runner.ts:1070-1108`).
- Pinning tests: base persona tests pin the Play as the canonical owner and Oscar as a deferring
  consumer (`packages/personas/tests/base-personas.test.ts:147-179`). Runner tests prove malformed
  output is blocked, old labels fail after a Play-label change, updated labels pass, and the observed
  drift classes are rejected (`packages/core/tests/runner.test.ts:855-980`).

## Enforcement-rule classes now covered

The historical evidence above proves the drift happened. This section is the forward-looking enforcement
view: the Play, persona prompt, runner validator, fallback brief, and tests could each preserve a different
copy of the expected shape, so the shipped runner now blocks these rule classes:

1. Missing or non-first `Founder Completion Brief` title.
2. Ledger/test-matrix detail in `What Changed`.
3. Optional or multi-choice action language in `Recommended Next Step`.
4. Long or multi-sentence `What Changed` summaries.
5. Percent-complete lifecycle claims in `Run Status`.
6. Overlong, implementation-labeled, or bare-priority `What Remains` / `Recommended Next Step` handoffs.

## Ticket review

- `0005` partially fixed (run_148): portable items 3-5 migrated to governed base files; repo-specific
  items 1-2 (`cocoder/personas/deltas/oscar.md`, `cocoder/AGENTS.md`) remain open.
- `0012` closed (run_148): design-ref marked historical (Option A); enforcer guards against re-describing
  it as the app source of truth.
- `0015` closed (run_148): loader defect already fixed; ticket reconciled by closure.
- `0017` closed (run_148): single-source orchestration rule promoted to `shared-standards.md` via `aa7addc`.
- `0008` folded in as precedent and remains closed. It showed the durable-orchestration repair shape:
  map every prompt/runtime/status surface, align the owner, and pin the contract with tests.

## Why the prior change drifted

The prior change was hard to make stick because the Play text was treated as the owner in prose while
the runner still kept its own section list, fallback brief, and validation messages. A future founder
change to the Play could leave the runtime accepting the old labels or emitting the old fallback. The
smallest durable rule is: when a founder-facing orchestration format is owned by a Play or governed
persona file, runtime validators and fallback emitters must parse or import that owner; they must not
copy the format into a second local contract.

## Follow-on (run_145, closed run_148)

The runtime repair above is complete and test-pinned. The single-source orchestration rule now lives in
the governed standard (`packages/personas/base/shared-standards.md`, `aa7addc`); ticket 0017 is closed.
The structural enforcer has a standalone red→green proof: `node scripts/proof-orchestration-enforcer.mjs`.
