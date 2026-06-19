# Oz Hardening Owner Map

Owner map for `cocoder/priorities/oz-hardening.md`. Names the source-of-truth owners and the single
state/projection seam items 2 & 4 share. **Updated run_156:** items 2 (auto-compact) and 4 (auto status
pickup) are landed on `packages/daemon/src/oz-awareness.ts` `projectOzAwareness()`; items 1 and 3 remain.

## 1. Run-State Projection Source Of Truth

Name this once as the **Oz awareness state source**:

- Durable run/session/work-item/commit/event state lives in the `RunStore` port in `packages/core/src/store/types.ts` (`Run`, `Session`, `WorkItem`, `CommitLink`, `RunEvent`, `RunStore`). Its concrete durable store is `packages/core/src/store/sqlite-store.ts` (`openRunStore`, `SqliteRunStore`) over `local/cocoder.db`, with table ownership in `packages/core/src/store/schema.ts` (`SCHEMA_SQL`: `workspace`, `run`, `session`, `work_item`, `commit_link`, `event`, `run_counter`).
- The daemon receives that store through `packages/daemon/src/context.ts` (`OzContext.store`) and opens it in `packages/daemon/src/server.ts` (`createOzServer`, `store: opts.store ?? openRunStore(join(opts.cocoderHome, 'local', 'cocoder.db'))`). Standalone CLI runs use the same helper in `packages/cli/src/run.ts` (`openRunStore(join(root, 'local', 'cocoder.db'))`).
- Durable ticket state is file-backed, not DB-backed. The workspace ticket root is `cocoder/tickets/`; open tickets are `cocoder/tickets/open/*.md`. The owning loader is `packages/core/src/tickets/loader.ts` (`Ticket`, `loadTicket`, `readTickets`, `nextTicketId`). The daemon ticket read surface wraps it in `packages/daemon/src/priority-order.ts` (`readTickets`) to apply `cocoder/tickets/order.json` to open tickets only.
- Existing portable run history is a derived artifact, not the source of truth. `packages/core/src/store/portable/projection.ts` (`writePortableRunHistory`, `listPortableRunSessions`) derives from `RunStore` into tracked `cocoder/runs/**`.

**Landed (run_156):** `packages/daemon/src/oz-awareness.ts` `projectOzAwareness()` is the named projection
over priorities + `RunStore` runs + open tickets. Consumers: `oz-host.ts` `factsDigest` (compact/refresh
read path) and `oz-chat.ts` `status` (status read path). Do not add a parallel chat-memory summary contract.

## 2. Oz Message/Status Render Surfaces

### Daemon Oz Loop

- File: `packages/daemon/src/oz-chat.ts`.
- Owners: `handleOzMessage`, `executeOzCommand`, reply helpers (`launchReply`, `showReply`, `teardownReply`, `stopReply`, `supportCommitReply`, `nudgeReply`, `repairReply`, `authoringReply`, `refreshReply`, `runSummary`, `runsSummary`).
- Contract consumed: request body `{ text, workspaceId? }`; command contract `OzCommand`; output contract `OzChatResult` / `OzChatReply` / `OzChatAction`. **Landed (run_156):** `status` reads via `projectOzAwareness()`.

### Headless Oz Agent Loop

- File: `packages/daemon/src/oz-host.ts`.
- Owners: `tryHandleOzAgentTurn`, `runToolLoop`, `runTurn`, `buildPrompt`, `factsDigest`, `formatRun`, `parseToolLine`, `validateToolCall`.
- Contract consumed: effective Oz persona assignment from `resolveOzTarget`; prompt facts from `readPriorities(prioritiesDir(...))` and `ctx.store.listRuns({ workspaceId })`; tool handoff line `OZ_TOOL { ... }`; in-process transcript map `sessions`.
- **Landed (run_156):** `factsDigest` now builds from `projectOzAwareness()` (priorities, runs, open tickets).

### HTTP Status/Read Projection

- File: `packages/daemon/src/routes.ts`.
- Owners: `dispatchReads`, `listRuns`, `runDetail`, `listTickets`, `streamOzEvents`.
- Contract consumed: HTTP `GET /runs`, `GET /runs/:id`, `GET /workspaces/:id/tickets`, `GET /oz/events`; data from `ctx.store` plus ticket files through `readTickets(ticketsDir(ws.path))`. `runDetail` also adds `deepLinkable` by comparing stored sessions to `ctx.liveRefs`.

### UI Chat Rendering

- File: `packages/ui/src/renderer/sections/dashboard/OzChat.tsx`.
- Owners: `OzChatPanel`, `ChatMessageView`, `ChatTargetPicker`.
- Contract consumed: renderer `ChatMessage[]`, `Run[]`, `Workspace[]`, `onSend`, `onSelectRun`, `onDecision`, `ozTyping`, `chatTarget`, `chatTargets`, `onChatTargetChange`, and shell props (`theme`, `setTheme`, `conn`, `onRestartOz`). Current message body rendering is a single regex over `msg.body` into `dangerouslySetInnerHTML`; it is not a markdown renderer, streaming protocol, or thinking renderer.

### UI Data/Refresh Projection

- Files: `packages/ui/src/renderer/App.tsx`, `packages/ui/src/renderer/live.ts`, `packages/ui/src/main/events-stream.ts`, `packages/ui/src/main/daemon-client.ts`, `packages/ui/src/main/chat-send.ts`.
- Owners: `loadWsData`, `loadRunDetail`, `sendOzMessage`, `App.refreshWorkspace`, `App.refreshRunDetail`, `App.enrichActiveRunDetails`, `App`'s `onOzEvent` effect, `startOzEventStream`, `ozChat`, `sendChatMessage`.
- Contract consumed: daemon routes `/workspaces/:id/priorities`, `/workspaces/:id/tickets`, `/runs?workspace=...`, `/runs/:id`, `/oz/messages`, and `/oz/events`. SSE events are sanitized to `OzEventHint` and cause workspace/run refetches in `App`.

## 3. Settings Surface

Single durable settings owner for "Oz Auto Compact at N Runs" should be the daemon settings type:

- Durable type/schema: `packages/daemon/src/settings.ts` (`Settings`, `DEFAULT_SETTINGS`, `saneSettings`, `sanePatch`).
- Persistence layer: same file, `settingsPath(cocoderHome)` -> `local/settings.json`; `readSettings`; `mergeWriteSettings`. HTTP access is `packages/daemon/src/routes.ts` (`GET /settings`, `PUT /settings`).
- Main-process bridge: `packages/ui/src/main/ipc-contract.ts` (`Settings`, `SettingsPatch`, `OzApi.settingsGet`, `OzApi.settingsSet`), `packages/ui/src/main/settings-sync.ts` (`getSettingsViaDaemon`, `setSettingsViaDaemon`, `daemonPatch`), `packages/ui/src/main/store.ts` (`getSettings`, `setSettings`) as local fallback cache.
- Preload/UI surface: `packages/ui/src/preload/preload.ts` (`settingsGet`, `settingsSet`); `packages/ui/src/renderer/App.tsx` (`settings`, `saveSettings`, `setTheme`, `setPanelRatio`); `packages/ui/src/renderer/sections/Settings.tsx` (`SettingsScreen`, `SettingsRow`, `Toggle`).

Current split: renderer settings include `preferences.theme`, `preferences.sound`, `preferences.sendOnEnter`, and `preferences.panelRatio` in `packages/ui/src/renderer/model.ts` (`Settings`, `DEFAULT_SETTINGS`). `settings-sync.ts` intentionally keeps `preferences` local.

**Landed (run_156):** `ozAutoCompactRuns: number` (default `3`, range `2..10`, clamped in `saneSettings`/`sanePatch`) is daemon-owned in `settings.ts`, round-trips through `/settings` and `daemonPatch`. Compaction trigger: `recordOrchestratedRun` in `oz-host.ts`, wired from `attachRunLifecycle` `run-settled` in `launcher.ts`.

## 4. Tests And Fixtures Pinning These Surfaces

- Run store and schema: `packages/core/tests/store.test.ts`; portable derived history: `packages/core/tests/portable-store.test.ts`, `packages/core/tests/portable-run-creation.test.ts`, `packages/core/tests/portable-migrate.test.ts`.
- Ticket loader/source: `packages/core/tests/tickets.test.ts`; ticket authoring contract check: `packages/core/tests/orchestration-contracts.test.ts`.
- Daemon read/status projection: `packages/daemon/tests/read-surfaces.test.ts` pins `GET /settings`, `GET /workspaces/:id/tickets`, `GET /runs`, `GET /runs/:id`; `packages/daemon/tests/events.test.ts` pins `GET /oz/events`.
- Daemon Oz loop: `packages/daemon/tests/oz-chat.test.ts`, `packages/daemon/tests/oz-agent-chat.test.ts`, and `packages/daemon/tests/mutations.test.ts` around `POST /oz/messages`.
- Runner status feed: `packages/core/src/runner/status.ts` (`renderDebStatus`) is pinned by `packages/core/tests/status.test.ts`.
- UI OzChat rendering: `packages/ui/tests/ozchat.test.tsx` currently pins run-card rendering/click behavior only.
- UI live refresh/status: `packages/ui/tests/live-app.test.tsx` pins live data loading, active-row enrichment, SSE-driven refresh, chat target routing, and panel ratio persistence. `packages/ui/tests/events-stream.test.ts` pins SSE parsing/forwarding. `packages/ui/tests/chat-send.test.ts` pins main-process chat forwarding to `/oz/messages`.
- UI settings: `packages/ui/tests/settings-sync.test.ts` pins daemon/local split and renderer-only preferences; `packages/ui/tests/app.test.tsx` pins the Settings screen as forms rather than raw JSON.
- Fixtures: `packages/ui/fixtures/*.json`, especially `runs.json`, `tickets.json`, `oz-messages.json`, `priorities.json`, `workspaces.json`; renderer seed at `packages/ui/src/renderer/seed.json`.

## 5. Coordination Note: OzChat Rendering vs Archived Workspace Segmentation

`workspace-segmentation` touched the same component area but a different responsibility:

- Panel layout/global controls are in `packages/ui/src/renderer/sections/dashboard/Dashboard.tsx`: `Dashboard` owns the two-column grid, `ResizeHandle`, `panelRatio`, `onPanelRatioChange`, workspace tabs, left-panel tabs, and passes shell controls into `OzChatPanel`.
- Oz terminal header/global controls are in `packages/ui/src/renderer/sections/dashboard/OzChat.tsx`: `OzChatPanel` receives `theme`, `setTheme`, `conn`, `onRestartOz`, `chatTarget`, `chatTargets`, and `onChatTargetChange`; it renders `OzGlobalControls` and `ChatTargetPicker`.
- Oz hardening item 1 should touch the message region inside `OzChatPanel`: `ChatMessageView`, the `messages.map(...)` list, `ozTyping`, and the input send path if streaming needs a per-message pending state.

Do not rework `Dashboard`'s grid, `ResizeHandle`, workspace tabs, or global controls while implementing markdown/streaming/thinking. The shared prop boundary is `OzChatPanel`'s message contract: extend `ChatMessage` deliberately if streaming/thinking require it, then adapt `sendOzMessage`/IPC once, not inside layout code.

## 6. Objective Item Mapping

1. Markdown/streaming/thinking:
   - UI owner: `packages/ui/src/renderer/sections/dashboard/OzChat.tsx` (`ChatMessageView`, `OzChatPanel`).
   - Message model/adapter owners: `packages/ui/src/renderer/model.ts` (`ChatMessage`), `packages/ui/src/renderer/live.ts` (`sendOzMessage`), `packages/ui/src/main/ipc-contract.ts` (`ChatMessage`, `OzChatReply`), `packages/ui/src/main/daemon-client.ts` (`ozChat`).
   - Daemon owner if streaming becomes protocol-level: `packages/daemon/src/oz-chat.ts` (`OzChatReply`) and `packages/daemon/src/oz-host.ts` (`runTurn`) currently return whole replies, not streams.

2. Compact-on-N-runs — **LANDED (run_156):**
   - Settings: `packages/daemon/src/settings.ts` (`ozAutoCompactRuns`).
   - Awareness read: `packages/daemon/src/oz-awareness.ts` `projectOzAwareness()`.
   - Trigger: `recordOrchestratedRun` ← `attachRunLifecycle` `run-settled` in `launcher.ts`.

3. Drag-to-ask pointer:
   - UI drag/drop owners: `packages/ui/src/renderer/sections/dashboard/Dashboard.tsx` (`PrioritiesPanel`, `TicketsTab`, `RunsTab`, `OzChatPanel` integration) and `packages/ui/src/renderer/sections/dashboard/OzChat.tsx` input/attachment area.
   - Pointer contract owners: `packages/ui/src/renderer/model.ts` (`ChatMessage.attachments` currently supports only `{ kind, runId }`), `packages/ui/src/renderer/live.ts` (`sendOzMessage`) and `packages/ui/src/main/ipc-contract.ts` if pointer metadata crosses IPC.
   - Daemon/Oz read owner: the shared awareness projection must resolve priority/run/ticket pointers by path/id; do not inject full file bodies into chat state.

4. Auto status pickup — **LANDED (run_156):**
   - Change detection: `emitOzEvent` consolidated in `context.ts`; `createTicket` in `routes.ts` emits `ticket-created`; run lifecycle emits via `launcher.ts` `attachRunLifecycle`.
   - HTTP stream: `routes.ts` `streamOzEvents` (`GET /oz/events`).
   - UI refetch: `events-stream.ts` + `App.tsx` `onOzEvent` → `refreshWorkspace` / `refreshRunDetail` (unchanged path; now receives ticket-created).
   - Ticket data: `projectOzAwareness()` includes open tickets from `readTickets`; closes run_131 ticket-0014 symptom.

Tickets:

- `cocoder/tickets/open/0013-daemon-auto-rebuild-after-runs.md`: not subsumed by item 4. Item 4 can detect/refetch state after a running daemon emits or receives a change signal; ticket 0013 is about rebuilding/reloading a stale daemon binary after code changes to `packages/daemon/**` or dependencies. It remains adjacent infrastructure.
- `cocoder/tickets/closed/0015-tickets-silently-dropped-without-frontmatter.md`: functionally subsumed by item 4's ticket-awareness acceptance only as a dependency already closed. The loader fix is in `packages/core/src/tickets/loader.ts`, pinned by `packages/core/tests/tickets.test.ts`; item 4 should rely on that loader and add event/refetch coverage, not reopen parser behavior.
