---
id: 0070
title: Runnerless handoff discoverability + capture 0069 governed-write failure (follow-up to 0069)
type: task
status: Closed
priority: none
owner: founder-session
created: 2026-06-26
---

# 0070 — Runnerless handoff discoverability + capture 0069 governed-write failure (follow-up to 0069)

## Context
Follow-up to ticket 0069 (closed). 0069's headline bug (misleading "already in flight" 409) and its
runnerless launch affordance + runnerless flagging are done and shipped. Two acceptance items from 0069
were deliberately NOT closed inside that ticket and are carried here.

## Remaining work

### 1. Pending runnerless handoff is not discoverable before its first run record lands (AC-3 second half)
When a founder clicks "Create handoff" for an `independent-of-runner` priority, the daemon writes a
handoff artifact under `local/runnerless-handoffs/<workspaceId>/<id>.md` and emits an
`emitOzEvent(... type: 'runnerless-handoff', status: 'handoff-created')` (packages/daemon/src/launcher.ts:475-519).
Verified: that event has ZERO consumers and no status surface lists pending handoffs — the founder only
sees a transient toast. After the toast clears there is no way to see that a handoff is outstanding and
awaiting a runnerless launch until its first run record lands in the store.

Build a status surface that lists pending runnerless handoffs (those with a handoff artifact under
`local/runnerless-handoffs/<ws>/` and no corresponding run record yet) so they are discoverable and
actionable from Oz/dashboard. This is net-new daemon + UI work; per 0069's own scope-split guidance it
may warrant promotion to its own founder-approved priority rather than a single atom.

### 2. Capture the exact governed-write / request-deb-repair failure hit while filing 0069 (AC-4)
The founder reported that an Oz governed write / repair failed while creating the original ticket, but
the exact command and error text were never captured, so it could not be triaged. Capture the verbatim
command + error and determine whether it is a regression or the by-design active-run refusal of the
Oscar->Deb repair path (`request-deb-repair` still refuses during an active run by design; ticket 0063
made create/close/repoint/reorder + priority-create accept-and-queue, but not repair). If it is a
regression, file or fold in the fix.

## Acceptance
- A pending runnerless handoff is visible in Oz/dashboard from creation until its first run record lands.
- The exact governed-write/repair failure command + error from filing 0069 is recorded and triaged
  (regression vs by-design); a regression, if found, is fixed or has its own ticket.

## Notes
- Relevant code: packages/daemon/src/launcher.ts:475-519 (handoff artifact + event),
  packages/daemon/src/routes.ts:916 (POST /runs/independent-handoff), packages/ui/src/renderer
  (status surfaces), ADR-0043 (runnerless execution shape).
- 0069 delivered: AC-1 (un-masked 409 in both doLaunch and doLaunchTicket), AC-2 (handoff affordance),
  AC-3 first half (runnerless flag/badge/button).
</content>
</invoke>

## Resolution

Resolved by run queued-authoring (no code change) on 2026-06-26.

Resolved: pending runnerless handoffs now have a daemon/dashboard status surface; the 0069 governed-write failure was captured and triaged as the older headless TTY failure class, not the by-design active-run repair refusal.
