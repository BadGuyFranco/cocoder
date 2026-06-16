---
id: 0008
title: Wrapped Oscar is reachable but lacks a committed post-wrap action path
type: bug
status: Open
priority: governance-authoring-plays
owner: deb
created: 2026-06-16
---

# 0008 — Wrapped Oscar is reachable but lacks a committed post-wrap action path

## Context
Founder report during run_99: after Oscar wraps, the founder still expects to ask questions, make
decisions, and direct small governance follow-ups. That is the intended human contract: wrap-up is a
checkpoint, not teardown.

The immediate focus bug was fixed in `packages/daemon/src/launcher.ts`: `showRun` now prefers a live
Oscar pane after wrap instead of focusing the most recent live session (often Deb/Bob), with regression
coverage in `packages/daemon/tests/mutations.test.ts`.

## Remaining bug
The larger action path is still incomplete. After wrap, `runRun` breaks out of the loop, writes
`run-end`, and no runner-owned commit gate is watching Oscar. A live Oscar pane can answer questions
and help classify decisions, but file-changing founder-directed work after wrap does not yet have a
first-class committed path from Oscar.

This conflicts with the base Oscar persona, which says founder-directed Surface-A edits remain
committable after wrap-up delivery. The runtime surface still behaves like the older prompt contract:
questions are fine; file changes need a fresh committed path.

## Ask
Add a durable post-wrap founder-interaction contract:
- After wrap-up delivery, keep Oscar reachable for founder questions/decisions while the pane is live.
- Provide a runner/daemon-owned way for founder-directed governance edits made from that wrapped Oscar
  surface to commit through the spine, or explicitly route them to an existing committed path such as
  Oz repair/authoring Plays.
- Align the runtime status text, Oscar prompt text, daemon Show behavior, and tests so they all state
  the same contract.

## Boundary
This is orchestration/runtime behavior, not a product feature. It should not reintroduce run branches
or post-settle stranded commits.
