---
id: workspace-segmentation
title: "Workspace segmentation — Oz watches across workspaces while work stays workspace-local"
---

## Objective
CoCoder makes the workspace boundary explicit and durable: **Oz is the cross-workspace watcher and
controller**, while each workspace owns its own priorities, tickets, sessions/runs, numbering, and
terminal labels. The dashboard must visually communicate that split, and the orchestration machinery
must not assume a single active workspace. **Verified when** the following are proven in the running app
and/or targeted tests, with an owner map for every workspace-scoped surface touched:

1. **Oz is visually separate from the workspace panel.** The dashboard no longer reads as if Oz lives
   inside one workspace. The workspace switcher/add control belongs to the workspace panel; that panel
   contains workspace-local sub-tabs for **Priorities**, **Tickets**, and **Runs/Sessions**. Search is
   either removed for now or moved inside the workspace panel. The workspace panel is widened by roughly
   50%. The Oz terminal panel matches its height, reads as a separate watcher/control surface, and owns
   controls such as refresh, live status, notifications, and theme.
2. **Workspace-local state is actually local.** Priorities, tickets, sessions/runs, and their displayed
   numbers are scoped to a workspace rather than CoCoder globally. A workspace can have its own ticket
   numbers, priority ordering, run/session list, and launch history without leaking another workspace's
   identifiers or state.
3. **Concurrent workspace sessions are supported by design.** The architecture and implementation allow
   sessions in two different workspaces at the same time because they operate in different codebases.
   Any shared local storage, run IDs, status feeds, session-host names, locks, or daemon routes are
   audited and fixed so concurrent runs cannot collide.
4. **Terminal/session labels include the workspace.** Cmux/session labels include the workspace identity
   plus the launched target (priority/ticket/playbook/ad-hoc) and run/session id, so a human can tell at
   a glance which workspace and work item a terminal belongs to.
5. **No parallel workspace contract is introduced.** The final implementation names the source of truth
   for workspace identity, workspace-local numbering/state, dashboard data loading, run records, and
   session-host labels; consumers are aligned to those owners instead of adding one-off UI or prompt
   assumptions.

This priority intentionally shares visual territory with `oz-dashboard-ux` and `tickets-review`, but it
owns the broader workspace/Oz boundary. Existing card/modal/ticket behaviors stay with those priorities;
this priority only changes them where necessary to make the workspace segmentation coherent.
