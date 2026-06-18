---
id: workspace-segmentation
title: "Workspace segmentation — Oz watches across workspaces while work stays workspace-local"
---

## Objective
CoCoder makes the workspace boundary explicit and durable: **Oz is the cross-workspace watcher and
controller**, while each workspace owns its own priorities, tickets, durable session/run history,
numbering, and terminal labels. The dashboard must visually communicate that split, the orchestration
machinery must not assume a single active workspace, and a managed repo must remain portable to another
machine with CoCoder installed. **Verified when** the following are proven in the running app and/or
targeted tests, with an owner map for every workspace-scoped surface touched:

1. **Oz is visually separate from the workspace panel.** The dashboard no longer reads as if Oz lives
   inside one workspace. The workspace switcher/add control belongs to the workspace panel; that panel
   contains workspace-local sub-tabs for **Priorities**, **Tickets**, and **Runs/Sessions**. Search is
   either removed for now or moved inside the workspace panel. The workspace panel is widened by roughly
   50%. The Oz terminal panel matches its height, reads as a separate watcher/control surface, and owns
   controls such as refresh, live status, notifications, and theme. Oz chat has an explicit workspace
   target control above the chat input, including a **no workspace / global Oz** state; commands that
   require a workspace either use the selected workspace or stop with a clear target-needed response.
2. **Workspace-local state is actually local.** Priorities, tickets, sessions/runs, and their displayed
   numbers are scoped to a workspace rather than CoCoder globally. A workspace can have its own ticket
   numbers, priority ordering, run/session list, and launch history without leaking another workspace's
   identifiers or state.
3. **Durable history is portable with the repo.** The workspace's durable run/session record lives under
   that repo's `cocoder/` governance area (exact path and format decided by the owner map), so moving the
   repo to a new machine with CoCoder installed preserves the history needed to understand prior work.
   Machine-local live state such as process ids, sockets, cmux surface refs, transient status feeds, and
   caches remains in the install's `local/` zone and is never written to the repo.
4. **Concurrent workspace sessions are supported by design.** The architecture and implementation allow
   sessions in two different workspaces at the same time because they operate in different codebases.
   Any shared local storage, run IDs, status feeds, session-host names, locks, or daemon routes are
   audited and fixed so concurrent runs cannot collide.
5. **Terminal/session labels include the workspace.** Cmux/session labels include the workspace identity
   plus the launched target (priority/ticket/playbook/ad-hoc) and run/session id, so a human can tell at
   a glance which workspace and work item a terminal belongs to.
6. **No parallel workspace contract is introduced.** The final implementation names the source of truth
   for workspace identity, workspace-local numbering/state, portable run/session records, dashboard data
   loading, live run state, and session-host labels; consumers are aligned to those owners instead of
   adding one-off UI or prompt assumptions.

This priority intentionally shares visual territory with `oz-dashboard-ux` and `tickets-review`, but it
owns the broader workspace/Oz boundary. Existing card/modal/ticket behaviors stay with those priorities;
this priority only changes them where necessary to make the workspace segmentation coherent.

## Founder clarifications

- Internal run IDs may stay globally unique if that keeps teardown/deep links/storage simple; workspace
  local numbering can be a display ordinal or durable workspace ledger entry. Do not sacrifice reliable
  addressing just to make the internal ID pretty.
- Priority/ticket/session counters that represent workspace history should be owned by the workspace's
  `cocoder/` tree, not by CoCoder globally.
- The Oz controls listed above belong visually inside the Oz terminal panel because they are Oz/global
  controls, not workspace-tab controls.
