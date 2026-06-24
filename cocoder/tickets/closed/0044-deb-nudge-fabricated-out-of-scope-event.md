---
id: 0044
title: Deb nudge fabricated an out-of-scope-committed feed event that is absent from deb-status.json
type: bug
status: Closed
priority: oz-autonomy
owner: deb
created: 2026-06-23
closed: 2026-06-23
---

# 0044 - Deb nudge fabricated an `out-of-scope-committed` feed event

## Context

During run_212 (`oz-autonomy`, display run 68), after Oscar verified and the runner committed atom 3
(the proof harness, write scope `scripts/**`, commit `1f29cd6`), Deb's watchdog wrote a `deb-nudge.json`
to Oscar:

> Before issuing directive 4, reconcile the atom 3 commit receipt with the feed event
> `out-of-scope-committed`. Identify which path was committed out of Bob's atom-3 write scope
> (`scripts/**`) ...

with rationale:

> The status feed shows atom 3 verify-pass and commit, followed immediately by an
> `out-of-scope-committed` event. That is a concrete scope contradiction, not a normal fresh
> directive wait.

**The event does not exist.** Oscar reconciled against primary artifacts:

- `git show --stat 1f29cd6` — atom 3 committed **only** `scripts/proof-oz-autonomy.mjs`, exactly in
  scope. No out-of-lane path.
- `local/runs/run_212/deb-status.json` `recentEvents` — contains only `deb-status`,
  `deb-watch-dispatch`, `oscar-monitor-assessment`, and `oscar-nudge`. There is **no**
  `out-of-scope-committed` event anywhere in the feed Deb reads.
- `local/oz-audit.log` — no `out-of-scope-committed` entry for run_212.
- The real feed state at the time was a **normal fresh-directive wait** (`bob: done`, `verify: idle`,
  `oscar: stalled` — "awaiting Oscar's directive for atom 4") — exactly the condition Deb's rationale
  claimed it was *not*.

The only run_212 commit that carried out-of-scope paths was atom **0** (`96f98e4`), which swept
runner-owned run-history bookkeeping (`cocoder/counters.json` + `cocoder/runs/68-run_212/run.json`,
already dirty pre-atom) into the atom commit. That is expected, benign behavior of the default in-run
gate (ADR-0023/0007: scope is advisory; the spine never withholds) — not an atom-3 issue.

So Deb (a) **fabricated a feed event** that is not in the artifact it claims to read, and (b)
**misattributed** it to the one atom whose commit was clean. The false nudge cost an orchestration
round-trip and could have blocked a finished run on a non-issue.

## Acceptance

- Deb's nudge rationale must cite a **real** event that exists in `deb-status.json` / the store feed;
  a nudge referencing a named feed event the projection does not contain should be impossible to emit
  (or caught) — Deb reads facts from disk, it does not invent them (ADR-0017 information-source
  doctrine, ADR-0013 tier-3/tier-2 observation).
- If a genuine out-of-scope-commit signal is wanted in the feed, the runner should emit a real,
  named event for it from the in-run commit gate's `outOfLane` receipt — then Deb can reference it
  truthfully. Today no such per-atom feed event is emitted, which is why the reference was necessarily
  fabricated.
- A regression/guard that a Deb nudge whose rationale names a feed event is rejected/flagged when that
  event type is absent from the run's recent events.

## Notes

Related: [0042](../open/0042-deb-default-live-terminal-observation.md) (Deb observation surface),
[0043](../open/0043-bob-blocker-replies-unowned-after-runner-stall-nudges.md) (runner does not consume
structured blocker/observation replies). This is the same orchestration-observation reliability class.

Closed 2026-06-23: runner-owned Deb nudge delivery now rejects and records `deb-nudge-rejected` when a
Deb nudge message/rationale cites a named feed event absent from the current Deb status recent events.
Regression coverage pins the fabricated `out-of-scope-committed` case.
