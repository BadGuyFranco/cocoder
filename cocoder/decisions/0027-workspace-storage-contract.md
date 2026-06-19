# ADR-0027 - Workspace storage contract: portable history in `cocoder/`, machine-local coordination in shared `local/`

**Status:** Accepted (founder, 2026-06-18) — the workspace storage contract for the
`workspace-segmentation` priority. The founder explicitly approved both amendments below (history
portability + identity split) per ADR-0014; the ADR index and the forward-pointer banners on ADR-0003 and
ADR-0019 were landed together with this ADR (decisions HARD RULE — never land an amending ADR alone).
**Builds on:** [0008](./0008-repository-topology.md) (three storage zones; one shared install
`local/`), [0019](./0019-multi-root-workspaces.md) (install-local workspace registry and root roles),
[0003](./0003-data-model-hybrid.md) (hybrid files plus SQLite), [0023](./0023-workspace-commit-spine.md)
(direct-to-branch with one writer per workspace), and the
[`workspace-segmentation`](../priorities/workspace-segmentation.md) owner map.
**Amends:** [0003](./0003-data-model-hybrid.md) by moving portable workspace run/session history out
of sole SQLite ownership; [0019](./0019-multi-root-workspaces.md) by splitting workspace identity from
machine-local routing. It does not reverse [0008](./0008-repository-topology.md): machine-local state
still lives only in the install's shared `local/` zone.

## Context

The workspace-segmentation priority fixes a real boundary problem: Oz is cross-workspace, but
priorities, tickets, durable run/session history, display counters, launch context, and git guards must
be workspace-local. The owner map found the current split:

- workspace identity and roots are read from install-local `local/workspace/*.code-workspace`;
- portable run/session/work-item/commit/event history is currently intermixed with machine-local cmux
  refs and counters in `local/cocoder.db`;
- run artifacts are in install-local `local/runs/<runId>`;
- `run_counter` is global, while ticket numbering is derived from tracked ticket filenames;
- live coordination is process-local (`liveRefs`, `inFlight`, `stopControllers`, SSE hints) and must
  remain machine-local.

The priority also fixed four decisions:

1. Internal run IDs may stay globally unique for reliable teardown, deep links, artifacts, and live
   coordination.
2. Workspace-history counters belong to the workspace's tracked `cocoder/` tree, including ticket
   numbering and workspace-local run/session numbering.
3. There is one shared install `local/` zone; do not create per-workspace machine-local folders inside
   a repo. Namespace shared local state by workspace where needed.
4. Visual/global Oz controls belong to Oz, not workspace tabs. This ADR only covers storage; UI layout
   remains for later atoms.

## Decision

### 1. Workspace identity

**Source of truth:** `<workspace>/cocoder/workspace.json` (tracked JSON).

Shape:

```json
{
  "schemaVersion": 1,
  "id": "workspace-slug",
  "name": "Human name"
}
```

This file owns the portable workspace identity: stable id and display name. The install-local
registry remains the source of truth for **machine-local routing** only:
`<CoCoder>/local/workspace/<workspace-id>.code-workspace` keeps roots, roles, absolute/relative paths,
and display descriptions. The registry id must match `cocoder/workspace.json` when the primary root is
reachable; if the portable file is absent during migration, the registry id is the bootstrap fallback
and the migration writes `cocoder/workspace.json`.

Machine-local identity mirrors that stay in `local/cocoder.db`: `workspace.id`, `workspace.path`, and
`workspace.name` as routing/index cache. The DB is not the portable owner.

Consumers to align:

- `packages/daemon/src/registry.ts:21` `RegistryWorkspace`, `readWorkspaces()`, `findWorkspace()`;
- workspace-scoped daemon routes in `packages/daemon/src/routes.ts`;
- launcher input assembly in `packages/daemon/src/launcher.ts`;
- UI workspace loading in `packages/ui/src/renderer/live.ts` and `packages/ui/src/renderer/App.tsx`;
- `SqliteRunStore.upsertWorkspace()` as cache population, not identity ownership.

### 2. Portable durable run/session/work-item/commit/event records

**Source of truth:** tracked per-run directory:
`<workspace>/cocoder/runs/<display-number>-<run-id>/`.

Each run directory contains:

- `run.json` (JSON): `run.id`, `run.displayNumber`, `workspace.id`, `target.kind`, `priorityId`,
  `playbookId`, `ticketId`, `status`, `createdAt`, `endedAt`.
- `sessions.jsonl` (JSONL): one row per session with `session.id`, `session.displayNumber`, `runId`,
  `persona`, `startedAt`, `exitCode`.
- `work-items.jsonl` (JSONL): one row per work item with `id`, `runId`, `sourcePersona`,
  `targetPersona`, `task`, `writeScope`, `status`, `createdAt`.
- `commits.jsonl` (JSONL): one row per commit receipt with `id`, `runId`, `workItemId`, `commitSha`,
  `message`, `files`, `createdAt`.
- `events.jsonl` (JSONL): one row per portable event with `id`, `runId`, `type`, `at`, and
  `data`. Event `data` must contain only portable values. Machine-local paths/refs (`runDir`,
  `outPath`, cmux surface refs, local state paths) remain in `local/cocoder.db` or `local/runs` and
  are not written to the portable event stream.

Every field the owner map classified as workspace-portable now has a tracked home above. Machine-local
fields remain out of portable files:

- `session.session_ref` and `session.workspace_ref` stay in `local/cocoder.db`;
- obsolete `run.worktree_path`, `run.run_branch`, `run.integration_status`,
  `commit_link.kind`, `commit_link.merge_sha`, and `commit_link.trunk_parent` stay legacy/inert and
  are not migrated into portable history;
- machine-local event payload values stay in DB/run-dir artifacts only.

Consumers to align:

- `RunStore` and `SqliteRunStore` write/read paths in `packages/core/src/store/**`;
- runner writes in `packages/core/src/runner/runner.ts` and `packages/core/src/runner/agent-step.ts`;
- commit receipt writer `packages/core/src/commit-gate/gate.ts`;
- run record projection `packages/core/src/runner/record.ts`;
- daemon run list/detail routes in `packages/daemon/src/routes.ts`;
- Deb recurrence reads in `packages/core/src/runner/runner.ts`;
- UI run summaries/details in `packages/ui/src/renderer/live.ts` and adapters.

### 3. Run identity and workspace-local display numbers

**Internal run ID source of truth:** `local/cocoder.db` `run_counter` remains a machine-local global
allocator for stable internal ids (`run_135`, etc.) until a future explicit id allocator replaces it.
Internal ids stay globally unique because cmux teardown, deep links, run artifacts, and live
coordination rely on unambiguous addressing.

**Workspace-local display number source of truth:** `<workspace>/cocoder/counters.json` plus each
run's `run.json`.

`cocoder/counters.json` owns the next display number:

```json
{
  "schemaVersion": 1,
  "nextTicketNumber": 1,
  "nextRunDisplayNumber": 1,
  "nextSessionDisplayNumber": 1
}
```

When a run is created, CoCoder atomically allocates `run.displayNumber` from `nextRunDisplayNumber`,
writes it to `cocoder/runs/<display-number>-<run-id>/run.json`, then increments the counter. The
display number is durable history; the counter is only the allocator. If the counter is lost, it is
rebuilt as max existing display number + 1.

Session display numbers are allocated the same way and written into `sessions.jsonl`.

Consumers to align:

- run creation in `SqliteRunStore.createRun()` and daemon playbook run creation;
- cmux label construction in `packages/core/src/runner/runner.ts`;
- UI run displays in `packages/ui/src/renderer/**`;
- run-detail and teardown routes that currently address runs by internal id.

### 4. Workspace-local counters

**Source of truth:** `<workspace>/cocoder/counters.json` (tracked JSON).

This file owns all workspace-history counters:

- `nextTicketNumber` for `cocoder/tickets/open/<NNNN>-slug.md`;
- `nextRunDisplayNumber` for workspace-local run display ordinals;
- `nextSessionDisplayNumber` for workspace-local session display ordinals.

Existing ticket files remain the durable ticket records. During migration, `nextTicketNumber` is seeded
from max ticket filename across `cocoder/tickets/open` and `cocoder/tickets/closed` + 1. After migration,
ticket creation reads and increments `cocoder/counters.json`; filename scans are a rebuild/backfill
fallback, not the allocator owner.

Consumers to align:

- ticket allocator `packages/core/src/tickets/loader.ts:103`;
- daemon ticket create route `packages/daemon/src/routes.ts`;
- Electron ticket create bridge `packages/ui/src/main/tickets-create.ts`;
- renderer ticket create flow `packages/ui/src/renderer/App.tsx`;
- future run/session display allocation in the runner and daemon launcher.

### 5. Role of `local/cocoder.db` after the split

**Source of truth:** `local/cocoder.db` remains machine-local coordination and query-index state.

It is rebuildable for portable history from tracked workspace files in this order:

1. discover workspaces from install-local `local/workspace/*.code-workspace`;
2. validate each reachable primary root against `<workspace>/cocoder/workspace.json`;
3. read `<workspace>/cocoder/counters.json` for workspace-local display allocator state;
4. replay `<workspace>/cocoder/runs/*/run.json`, then `sessions.jsonl`, `work-items.jsonl`,
   `commits.jsonl`, and `events.jsonl`;
5. reattach only current machine-local live refs from active daemon/cmux state. Historical cmux refs are
   not portable and are not recreated.

DB tables/fields that remain DB responsibility:

- `workspace.path` and registry mirrors for routing/indexing;
- `run.id` internal global allocator/index and query cache;
- `session.session_ref`, `session.workspace_ref`, live/deep-link and teardown refs;
- machine-local event payload details such as local paths, cmux refs, process-local state paths;
- `run_counter.next` for internal id allocation only;
- obsolete legacy fields retained only for old DB compatibility.

DB tables/fields that become cache/projection of portable files:

- portable portions of `run`, `session`, `work_item`, `commit_link`, and `event`;
- `workspace.id` and `workspace.name` as mirrors of portable identity.

Consumers to align:

- store schema/types/SQLite implementation in `packages/core/src/store/**`;
- daemon boot/orphan reconciliation and run list/detail reads;
- Deb recurrence lookup;
- UI polling and SSE-triggered refreshes.

### 6. Run directories

**Source of truth for machine-local working artifacts:** install-local, namespaced by workspace:
`<CoCoder>/local/runs/<workspace-id>/<run-id>/`.

Run directories stay machine-local because they contain prompts, captured stdout/stderr, transient
directive/verify handshakes, nudge files, Deb status projections, and local output paths. They must not
move into a repo or any per-workspace local folder under the repo. Existing `local/runs/<run-id>` is the
legacy pre-segmentation location and migrates into the namespaced shared-local layout.

Portable summaries from run dirs are copied into tracked history only through the files named above:
`pickup`/record content that is durable belongs in `events.jsonl` or a future portable field in
`run.json`; raw terminal output remains local.

Consumers to align:

- daemon context `runsRoot` in `packages/daemon/src/server.ts`;
- runner `join(runsRoot, run.id)` usage in `packages/core/src/runner/runner.ts`;
- runner IO in `packages/core/src/runner/io.ts`;
- run-dir reader in `packages/daemon/src/rundir.ts`;
- launcher pickup/nudge reads and writes in `packages/daemon/src/launcher.ts`.

## Migration outline

1. Add readers/writers for `cocoder/workspace.json`, `cocoder/counters.json`, and
   `cocoder/runs/<display-number>-<run-id>/...` behind existing ports; do not change runtime behavior in
   the ADR atom.
2. For each registered workspace, write `cocoder/workspace.json` from the registry id/name when absent.
   Validate existing files against the registry and stop on mismatch.
3. Seed `cocoder/counters.json` from current ticket filenames and current DB run/session history.
4. Export existing DB rows into per-run tracked directories. Include portable event data only; leave
   machine-local refs and paths in the DB.
5. Move existing machine-local run dirs from `local/runs/<runId>` to
   `local/runs/<workspaceId>/<runId>` or leave compatibility symlinks/read fallbacks until no active run
   references the old shape.
6. Re-point consumers one owner at a time: identity, counters, portable history, run dirs, then DB
   rebuild/index behavior.
7. Keep forward/backward compatibility during rollout: old DB-only runs still render; new file-backed
   runs write both portable files and DB index until the rebuild path proves green. New code must never
   write portable history only to DB.

## Consumer alignment checklist

- Workspace identity: `registry.ts`, workspace CRUD routes, launcher workspace lookup, UI workspace
  loader/tab state, DB workspace mirror.
- Priority/ticket reads: remain in `cocoder/priorities` and `cocoder/tickets`; ticket allocator moves
  to `cocoder/counters.json`.
- Priority ordering: remains `cocoder/priorities/order.json`.
- Durable run/session history: `RunStore`, runner, commit gate, run record, run detail/list, Deb
  recurrence, UI adapters.
- Live state: remains `OzContext.liveRefs`, `inFlight`, `stopControllers`, cmux `#sessions/#groups`;
  consumers must not read portable files as liveness truth.
- Status feeds: durable status from `run.json`/DB projection; Deb live feed remains run-dir projection;
  dashboard refresh reads DB/index or portable-backed projections.
- Event hints: SSE remains daemon-local but every run event hint must carry `workspaceId`; renderer
  fallback to active workspace is temporary compatibility, not the contract.
- Git locks/dirty guards: keep per-workspace `inFlight` and primary-root dirty guard; later multi-root
  write work must add per-root guards before allowing concurrent writes inside one workspace.
- cmux/session labels: include portable workspace id/name, target kind/id, internal run id, and
  workspace-local display number.

## Concurrency note

The chosen layout removes the owner-map collision points by construction:

- DB writer lock: portable history writes are per-workspace tracked files; the DB is a rebuildable
  machine-local index/coordination cache, not the only durable store. Short DB writes may still serialize
  process-local indexes, but two workspace runs no longer depend on the DB as the sole history owner.
- Run-id space: internal ids remain globally unique for coordination; display numbers are allocated per
  workspace in `cocoder/counters.json`, so the dashboard can show workspace-local numbering without
  sacrificing reliable addressing.
- Run dirs: machine-local artifacts are namespaced under `local/runs/<workspace-id>/<run-id>`, so
  workspace-local display numbers cannot collide on disk.
- SSE/event streams: every lifecycle hint for workspace work must carry `workspaceId`; clients refresh
  that workspace, not the active tab by fallback.
- Git guards: a run still locks its workspace's primary checkout through `inFlight[workspaceId]`.
  Different workspaces have different primary roots, so they may run concurrently. A single multi-root
  workspace remains serialized until per-root write locks are explicitly designed.
- cmux labels/groups: group keys must be namespaced by workspace id plus internal run id; labels include
  workspace identity and target kind/id so humans can distinguish concurrent workspaces.

## Conflict audit

- **ADR-0003 conflict, explicitly amended:** 0003 says run history is install-local and SQLite is the
  source of truth. This ADR changes only the portable workspace-history portion: SQLite remains the
  machine-local coordination/index owner, while tracked `cocoder/runs/**` becomes portable history.
- **ADR-0019 conflict, explicitly amended:** 0019 says `local/workspace/*.code-workspace` is the
  workspace SSOT. This ADR narrows that to machine-local routing/root definitions. Portable identity is
  owned by `cocoder/workspace.json`.
- **ADR-0008 preserved:** no machine-local state is placed under repo `cocoder/`; shared local state
  remains under the install `local/` and is namespaced by workspace where needed.
- **ADR-0023 preserved:** direct-to-branch and single-writer-per-workspace remain. This ADR adds
  workspace-portable receipts; it does not add a second commit path.
- **ADR-0014 reconciliation DONE (2026-06-18):** the ADR index (`README.md`) carries the 0027 row and
  notes the amendments on the 0003/0019 rows, and forward-pointer `Amended by` banners were added to
  ADR-0003 and ADR-0019 in the same change. This ADR is indexed current truth.
