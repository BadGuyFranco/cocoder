---
id: deb-follows-oscar
title: "Deb follows Oscar - first-class tier-2 watcher"
---

## Objective
Make Deb a first-class, runner-driven watcher of Oscar for live runs, matching the ADR-0013 tier model:
the runner observes Oscar and run-health events on Deb's behalf, wakes Deb when there is something
actionable, and lets Deb recommend narrow Oscar-only nudges through the existing `deb-nudge.json` path.
**Verified when:** Deb can stay meaningfully informed across the full run lifecycle - directive wait,
Bob build, verify wait, wrap, and fault - without pane scraping, run-dir hunting, or founder prompting;
Oscar can receive runner-delivered, rate-limited Deb nudges to continue or clarify when Deb diagnoses a
minor/non-blocking issue; and tests prove the watcher is non-blocking, authority-safe, and does not
create a second orchestration lane. Boundary: this does not let Deb direct Bob, replace Oscar's verify
judgment, operate host processes, rescue a formally failed run, or change the commit spine.

**Scope note (founder decision 2026-06-22, ticket `0030`):** this priority is the *watcher + Oscar-only
nudge* half only. The Oscar-initiated repair dialogue — Oscar tasks Deb to research/propose a machinery
fix, Deb fixes it or hands the proposal back to Oscar to evaluate, runnable any time including after wrap
and never involving Bob — is split into its own priority `deb-oscar-repair-loop` and `ADR-0036`. Do not
add a `deb-investigate` directive kind or any escalation/fault path here.

## Context
ADR-0013 already defines Deb -> Oscar as the same monitor primitive one tier above Oscar -> Bob: Deb
monitors Oscar, may observe Bob to diagnose, and nudges only Oscar. ADR-0016 added Deb's status feed and
nudge channel, but the live behavior remains incomplete: Deb is spawned with `deb-status.json`, yet she
is not continuously awakened as a watcher. In practice Deb checks once when prompted, then goes quiet
until the founder or a formal fault dispatch wakes her.

Current implementation map:
- `packages/core/src/runner/monitor.ts` owns the reusable monitor primitive.
- `packages/core/src/runner/agent-step.ts` uses it for Oscar -> Bob during builder work.
- `packages/core/src/runner/runner.ts` has `awaitOscarWithNudgeWatchdog`, which monitors Oscar only
  while awaiting directive/verify and can deliver Oz/Deb nudge requests.
- `packages/core/src/runner/status.ts` owns `deb-status.json`, but it is a projection, not an active Deb
  watch loop.

Recommended design call: Deb should be event-awakened and non-blocking, not converted into a
self-polling agent that can stall the run. That matches ADR-0013's clarification that agents do not
observe panes directly; the runner is their eyes and hands.

Run_184 status: the watcher + Oscar-only nudge implementation was built and is test-green (full core
suite passing, incl. new Deb-watcher events, the non-blocking-when-silent guard, and the Oz/Deb
nudge-ordering test). It was NOT committed because the same diff also carried the now-split escalation
path (a `deb-investigate` directive that formally failed the run). On relaunch, the watcher half re-lands
as one verified atom **with the `deb-investigate`/fault escalation stripped out** — that behavior moves to
`deb-oscar-repair-loop`. The reproducible watcher diff touched: `docs/orchestration-contract-ownership.md`
(owner-map row), `packages/core/src/runner/{runner.ts,prompts.ts,status.ts}`, `packages/personas/base/deb.md`
(the `DEB WATCH` line), and `packages/core/tests/runner.test.ts`.

Founder model for the split repair loop (run_184, 2026-06-22): when Oscar hits an orchestration issue he
tasks Deb to research and propose a fix; Deb either applies an easy in-scope fix or hands the proposed fix
back to Oscar to evaluate, and Oscar directs the fix. It is Oscar↔Deb only (never Bob), can fire any time
including after wrap, and escalates to the founder for genuinely risky items. That is the existing manual
self-improvement pattern made autonomous — see `deb-oscar-repair-loop` + `ADR-0036`, not this priority.

## Required Inputs
- `cocoder/decisions/0013-orchestration-observation.md`
- `cocoder/decisions/0016-deb-scoped-repair-fallback.md`
- `docs/orchestration-contract-ownership.md`
- `packages/core/src/runner/monitor.ts`
- `packages/core/src/runner/agent-step.ts`
- `packages/core/src/runner/runner.ts`
- `packages/core/src/runner/status.ts`
- `packages/core/src/runner/prompts.ts`
- `packages/core/tests/monitor.test.ts`
- `packages/core/tests/runner.test.ts`
- `packages/core/tests/status.test.ts`
- `packages/core/tests/orchestration-contracts.test.ts`

## Proposed Atom Sequence
0. **Owner map first.** Extend `docs/orchestration-contract-ownership.md` with the Deb watcher contract:
   source of truth, live emitters, consumers, write/nudge path, and tests. Confirm no second watcher
   prompt, guide, or polling instruction is being created.
1. **Runner design slice.** Define one runner-owned Deb watch mechanism that reuses `runMonitor` and
   store events instead of persona polling. It should be event-driven or transition-driven where
   possible, with bounded cadence only where screen sampling is required.
2. **Runtime implementation.** Add the Deb watcher so Deb is informed during the whole run, including
   Bob-building periods, not only directive/verify waits. It must be non-blocking: a slow or silent Deb
   cannot stall Bob or Oscar unless an actual fault/triage contract requires Deb's verdict.
3. **Prompt/status alignment.** Update Deb prompt/status language so it describes active watch dispatches
   plus the existing status/nudge files. Keep `deb-nudge.json` as the single nudge path, and keep
   `target` fixed to `oscar`. (No escalation/repair language here — that lives in `deb-oscar-repair-loop`.)
4. **Tests and guard.** Extend existing tests, not parallel enforcers, to prove Deb watcher
   instantiation, evidence-bearing watch/status events, Oscar-only rate-limited nudges, no Deb path to
   Bob input, non-blocking behavior when Deb is silent, and no regression in Oscar -> Bob monitoring.
