---
id: 0066
title: Founder decisions should not force premature run wrap
type: bug
status: Closed
priority: governance-authoring-ssot
owner: founder-session
created: 2026-06-26
---

# 0066 — Founder decisions should not force premature run wrap

## Context
Run 101 / run_245 for ticket 0065 stopped after Atom 1 even though Bob had context and the remaining accepted path was runnable. Oscar treated the remaining ADR-0027 layout choice as a run-ending founder gate and wrapped with `awaiting-founder`.

The founder clarified on 2026-06-26 that founder decisions can happen mid-run and should not automatically force wrap. In this case the run should have asked for the decision in context, accepted the answer, and continued with the next atom. Wrapping was premature.

This is distinct from a real stop condition where no founder is reachable, the answer changes scope beyond the run, or continuing would be unsafe.

## Acceptance
- When Oscar reaches a founder decision during an active run, the default behavior is to ask the founder in-context and continue after the answer, not wrap solely because a decision is needed.
- The runner/Oscar contract distinguishes `founder decision needed now` from `stop and wrap for founder decision`; only the latter ends the run.
- The next-directive gate can pause for a founder answer and then accept a follow-up directive/atom without losing the run, builder context, or commit spine.
- Wrap-up validation rejects or flags premature `awaiting-founder` wraps when a concrete in-priority atom remains after a founder answer.
- A regression test covers the run_245 shape: a committed preparatory atom leaves a founder choice plus a runnable second atom; Oscar asks, receives the answer, delegates Atom 2, and only wraps after ticket completion or a true blocker.

## Notes
- Trigger example: ticket 0065 / run_245, after commit 8fe2047.
- Related surface: Oscar NEXT prompt, runner handling for founder questions, wrap disposition vocabulary, and Deb nudge/watch timing.
- This is likely an easy-to-medium orchestration contract fix if the runner already has a pause/resume question lane; it becomes bigger if no mid-run founder-question mechanism exists yet.

## Resolution

Resolved by run run_246 (no code change) on 2026-06-26.

Mid-run founder decisions use the ask-founder-continue runner contract instead of premature wrap; run_245 regression pinned; Oscar/wrap-up guidance reconciled.
