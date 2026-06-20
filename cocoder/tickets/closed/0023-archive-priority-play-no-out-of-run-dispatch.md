---
id: 0023
title: archive-priority Play has no out-of-run dispatch surface; founder-confirmed post-wrap archive is a dead end
type: bug
status: Closed
priority: none
owner: founder-session
created: 2026-06-20
closed: 2026-06-20
---

# 0023 — archive-priority Play is unreachable outside a run

## Context
In run_165, post-wrap, the founder confirmed archiving the met priority
`orchestration-pipeline-simplification` and asked Oscar to do it. Oscar's support scope includes
`cocoder/priorities/**`, and support-commit **created** the successor priority file directly (`efdbe0d`).
But when Oscar moved the met priority to `archive/`, the commit spine refused with a 409:

> post-wrap support edits cannot archive the active priority directly; use the archive-priority authoring
> Play after an archive-ready founder confirmation

That guard is correct in intent (archiving is governed by the one `archive-priority` Play — ADR-0025, so
there is no second raw archive path). The failure is that **the Play it points to has no dispatch surface
outside a run**: there is no `cocoder` CLI verb for it (`cocoder --help` lists only
`run / oz start / oz migrate-history / oz commit-support / oz teardown`) and no dashboard archive control.
So with the founder present post-wrap, the single legitimate archive path is unreachable, and a routine
governance action can only be done by launching a whole run.

## Root cause
Authoring Plays (`create-priority` / `edit-priority` / `archive-priority`, ADR-0025) are dispatched via
`requestAuthoringPlay` (`packages/daemon/src/launcher.ts`), which is only invoked from inside a run /
daemon route — not from any out-of-run founder surface. Meanwhile support-commit permits direct *creation*
of priority/ticket files but carves out *archiving the active priority*. The asymmetry — create allowed,
archive blocked, with no reachable Play — is the defect.

## Proposal
Give the single archive owner a reachable surface; do **not** add a second raw archive path (that would be
the duplicate-authoring-path anti-pattern this priority targets). Pick one owner-preserving option in the
successor priority's authoring-surface work:
- A thin CLI verb (e.g. `cocoder oz author <playId> <args>` / `cocoder oz archive-priority <id>`) that
  dispatches the existing `requestAuthoringPlay` — one path, now reachable post-wrap and out-of-run.
- Or have `oz commit-support` recognize an archive-the-active-priority intent and route it through
  `requestAuthoringPlay` instead of refusing, so the same support entry point reaches the one Play.

## Acceptance
- A founder-confirmed archive of a met priority can be completed outside a run through the one
  `archive-priority` Play (validation, archive convention, and `order.json` reconciliation all via that
  Play — no raw file move).
- `cocoder --help` (or the chosen surface) exposes the reachable path; an enforcer/test pins that archiving
  still has exactly one owner and no second authoring path appears.
- The create/archive asymmetry in post-wrap support-commit is resolved or documented as intentional with
  the reachable Play path named.

## Notes
Opened under `orchestration-audit-and-refactor` (now archive-candidate, run_167). Until fixed, archiving
a met priority is done by launching a run whose Oscar runs `archive-priority` as its first beat, or by
launching this ticket directly once ticket-fix dispatch is wired.

## Resolution
Closed by direct Deb repair on 2026-06-20:

- Added `cocoder oz archive-priority <priorityId> [--workspace <workspaceId>]` as a thin CLI dispatcher.
- Added `POST /workspaces/:id/authoring-plays/:playId`, which routes to the existing
  `requestAuthoringPlay` harness instead of moving files directly.
- Updated post-wrap support-commit refusal text to name the reachable CLI command.
- Updated the orchestration owner map and tests so the archive owner remains the `archive-priority` Play.
