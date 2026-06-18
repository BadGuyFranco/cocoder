---
id: workspace-segmentation
title: "Workspace segmentation — Oz watches across workspaces while work stays workspace-local"
---

## Objective
CoCoder makes the workspace boundary explicit, portable, and concurrency-safe. **Oz is the
cross-workspace watcher/controller**; each workspace owns its own priorities, tickets, durable
run/session history, counters, and launch context. The dashboard must visually communicate that split,
and the machinery must support sessions in multiple workspaces without assuming one active workspace.

**Verified when** the running app and targeted tests prove all of the following, with an owner map
completed before implementation:

1. **Oz is visually separate from workspace work.** The workspace switcher/add controls belong to the
   workspace panel; that panel contains workspace-local tabs for **Priorities**, **Tickets**, and
   **Runs/Sessions**. Search is removed for now or moved inside the workspace panel. The workspace panel
   is roughly 50% wider. The Oz terminal panel matches its height and visibly owns Oz/global controls:
   refresh, live status, notifications, and theme.
2. **Oz chat has an explicit target.** A workspace picker sits above the chat input and includes a
   **no workspace / global Oz** state. Commands that need a workspace use the selected workspace or stop
   with a clear target-needed response.
3. **Workspace state is actually workspace-local.** Priorities, tickets, priority order, ticket numbers,
   run/session display numbers, run/session lists, and launch history are scoped to the workspace and do
   not leak across workspaces.
4. **Durable history travels with the repo.** A managed repo can move to a new machine with CoCoder
   installed and still show the workspace history needed to understand prior work. Durable run/session
   records and workspace-history counters live under that repo's tracked `cocoder/` tree. The exact path
   and format are decided by the owner map.
5. **`local/cocoder.db` is classified, not trusted blindly.** The SQLite DB remains valid for
   machine-local coordination and indexing, but it is not the sole owner of portable workspace history.
   Audit every table/field touched by runs, sessions, counters, events, and workspace routing. Classify
   each as either **machine-local operational state** or **workspace-portable history**. Portable history
   gets a tracked file owner under the workspace `cocoder/`; live state such as process ids, sockets,
   cmux surface refs, transient status feeds, stop controllers, and caches stays in the install's
   `local/` zone.
6. **Concurrent workspace sessions are supported by construction.** Sessions in two different
   workspaces can run at the same time because they operate in different codebases. Shared local
   resources, locks, run IDs, run directories, status feeds, event streams, daemon routes, and git
   working-tree guards are audited and fixed so different workspaces cannot collide.
7. **Terminal/session labels include the workspace.** Cmux/session labels include workspace identity,
   launched target type (`priority`, `ticket`, `playbook`, or `ad-hoc`), target slug/id, and run/session
   identity, so a human can tell at a glance which workspace and work item a terminal belongs to.
8. **No parallel workspace contract is introduced.** The final implementation names the source of truth
   for workspace identity, workspace-local counters, portable run/session records, dashboard data
   loading, live run state, and session-host labels; every consumer is aligned to those owners.

## Fixed Decisions

- Internal run IDs may remain globally unique if that keeps teardown, deep links, run artifacts, and
  live coordination reliable. Workspace-local numbering can be a display ordinal or durable workspace
  ledger entry; do not sacrifice reliable addressing to make the internal ID pretty.
- Workspace-history counters belong to the workspace's tracked `cocoder/` tree, not to CoCoder globally.
  This includes ticket numbering and whatever session/run numbering is shown as workspace-local.
- The install has one shared `local/` zone. Do not create per-workspace machine-local folders inside a
  repo. Namespace shared local state by workspace where needed, and keep portable history in the repo.
- Visual ownership matters: refresh/live/notifications/theme live inside the Oz terminal panel because
  they are Oz/global controls, not workspace-tab controls.

## Required First Step

Before changing UI or storage, produce the owner map. It must name the owner and consumers for:
workspace identity, workspace selection in chat, priority/ticket reads, ticket numbering, priority
ordering, run/session durable history, run/session live state, run IDs and display numbers, run
directories, status feeds, event hints, git locks/dirty-tree guards, and cmux labels.

This priority intentionally overlaps visual territory with `oz-dashboard-ux` and `tickets-review`, but
it owns the broader workspace/Oz boundary. Existing card/modal/ticket behavior stays with those
priorities; change those surfaces here only where workspace segmentation requires it.
