---
id: 0088
title: FOUNDER DECISION NEEDED surfacing drops the question body
type: bug
status: Closed
priority: none
owner: founder-session
created: 2026-06-30
---

# 0088 — FOUNDER DECISION NEEDED surfacing drops the question body

## Problem

When Oscar dispatches an `ask-founder-continue` directive, the run parks and the founder is shown only a
bare `FOUNDER DECISION NEEDED` header — the directive's `question` text (the decision plus the context
Oscar wrote) is never rendered. The founder cannot see what they are being asked to decide.

Repro: run_294 directive-7 carried a full A/B question with a four-rule recommendation; the founder
received only the header with none of the body.

## Diagnosis (Deb, verified against code)

The runner already STORES the full question — `runner.ts` emits `founder-decision-requested` with the
question/message, and resume-state.json + the event carry it. The loss is purely **downstream** in the
founder-facing projections:

- `packages/core/src/runner/status.ts` — `terminalWaitCondition` regresses held/awaiting-founder to a
  generic string (e.g. "run held; awaiting founder action"), dropping the body.
- `packages/daemon/src/oz-awareness.ts` — `OzAwarenessRun` has no pending-question field; summaries are
  built from run rows only.
- `packages/daemon/src/oz-chat.ts` — status/runSummary/runsSummary render only the status enum.
- `packages/daemon/src/oz-host.ts` — facts digest omits the pending question for awaiting-founder runs.
- `packages/ui/src/renderer/adapter.ts` — no `founder-decision-requested` render branch; the event is
  absent from `DECISION_EVENTS`, so generic run-held/run-end/commit events win as `lastEvent`.

This is all non-`.md` runtime/projection/UI code, so it crosses ADR-0041 §3.1's interference rail: the
founder is the disposition authority and Deb correctly declined to self-apply (needsFounder=true,
risk=medium). Fix routes through a normal runner/operator session.

## Proposed fix (owner-mapped)

1. `status.ts` — add a pending-founder-question projection from events (latest
   `founder-decision-requested` not superseded by resume/answer); use it for the held/awaiting-founder
   terminal `waitCondition`.
2. `oz-awareness.ts` — add optional `pendingFounderQuestion`/`pendingFounderNextAction` to
   `OzAwarenessRun`, populated for held/awaiting-founder runs.
3. `oz-chat.ts` — render `FOUNDER DECISION NEEDED` + the compact question body + the
   `founder-answer <runId> <answer>` command. Brief, but never omit Oscar's decision text.
4. `oz-host.ts` — include the pending question in Oz's facts digest for awaiting-founder runs.
5. `ui/adapter.ts` — render `founder-decision-requested` as a decision transcript line, add it to
   `DECISION_EVENTS`, and prefer the latest pending founder question as `lastEvent` over later generic
   terminal events.
6. Tests — pin the question body in the terminal Deb/status projection
   (`packages/core/tests/runner-founder-stop-resume.test.ts`), in awareness/status
   (`packages/daemon/tests/oz-awareness.test.ts`, `oz-chat.test.ts`), and in the UI
   (`packages/ui/tests/adapter.test.ts`).

## Verification plan

- Reproduce with run_294 events: status + UI output must include the question body, not just the header.
- `pnpm --filter @cocoder/core test -- tests/runner-founder-stop-resume.test.ts`
- `pnpm --filter @cocoder/daemon test -- tests/oz-awareness.test.ts tests/oz-chat.test.ts`
- `pnpm --filter @cocoder/ui test -- tests/adapter.test.ts`
- Root typecheck after the awareness/run contract change.

## Evidence

Oscar–Deb repair dialogue `repair-1782815163322-e4498e`:
- `local/oz/cocoder/repair-dialogues/repair-1782815163322-e4498e/deb-response.json`
- `local/oz/cocoder/repair-dialogues/repair-1782815163322-e4498e/oscar-evaluation.json`
- `local/oz/cocoder/repair-dialogues/repair-1782815163322-e4498e/founder-escalation.json`

## Resolution

Resolved by run run_296 (d7d8af1e9d34c21b06c1168b433e925dc6d5ba94) on 2026-06-30.

Fixed across the full owner chain: the stored founder-decision-requested question now reaches every founder-facing projection. Core adds pendingFounderQuestion (browser-safe @cocoder/core/founder-question) threaded into terminalWaitCondition for held/awaiting-founder; daemon carries it through the pure awareness snapshot and renders it in oz-chat status + oz-host facts digest with the founder-answer command; UI adapter renders the founder-decision-requested transcript line, adds it to DECISION_EVENTS, and prefers the still-pending question as lastEvent over later run-held/run-end/commit events. Pinned by tests in core (status + founder-stop-resume), daemon (oz-awareness, oz-chat), and ui (adapter).
