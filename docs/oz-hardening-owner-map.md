# Oz Hardening Owner Map

Owner map for `cocoder/priorities/oz-hardening.md`. This is a read-and-document artifact for the
durable-orchestration boundary: fix the owner first, then align consumers. The current code already
landed parts of items 2 and 4 in run_156; this map names the actual owners before the remaining Oz
chat-rendering and drag-to-ask work.

## 1. RUN-STATE PROJECTION SOURCE OF TRUTH

Durable run/session/work/commit/event state is the `RunStore` contract in `packages/core/src/store/types.ts:87`.
Its durable implementation opens SQLite through `openRunStore` in `packages/core/src/store/sqlite-store.ts:123`
over the schema in `packages/core/src/store/schema.ts:8`, whose tables include `workspace`, `run`,
`session`, `work_item`, `commit_link`, `event`, and `run_counter` (`packages/core/src/store/schema.ts:8`).
The daemon owns the live read handle through `OzContext.store` (`packages/daemon/src/context.ts:72`) and
opens it at `local/cocoder.db` in `createOzServer` (`packages/daemon/src/server.ts:116`).

Ticket state is file-backed, not DB-backed. Ticket files are loaded by `loadTicket` / `readTickets` in
`packages/core/src/tickets/loader.ts:53` and `packages/core/src/tickets/loader.ts:97`. The daemon read
wrapper is `packages/daemon/src/priority-order.ts:76`, which applies `order.json` to open tickets and
leaves closed tickets after them. The dashboard route reads those files through `listTickets` in
`packages/daemon/src/routes.ts:355`.

The shared projection owner for oz-hardening items 2 and 4 is explicitly:

`packages/daemon/src/oz-awareness.ts:19` `projectOzAwareness()`.

It projects priorities, `RunStore` runs, and ticket summaries into one `OzAwarenessSnapshot` with
`recentRuns`, `activeRuns`, and `openTickets` (`packages/daemon/src/oz-awareness.ts:6`). Item 2
refresh/compact reads and item 4 change-detection/status reads must share this owner. Do not introduce a
parallel chat-scrollback summary, prompt-only digest, or UI-local status contract.

## 2. OZ MESSAGE & STATUS RENDER SURFACES

Daemon Oz command loop: `packages/daemon/src/oz-chat.ts`.
It owns the HTTP chat result contract: `OzChatReply` is one `reply` string plus `command`, `ok`, and optional
`action` (`packages/daemon/src/oz-chat.ts:43`). `handleOzMessage()` parses `{ text, workspaceId? }`,
routes direct commands, and only falls through to the headless Oz agent for unknown command text with a
workspace (`packages/daemon/src/oz-chat.ts:104`). The `status` path reads `projectOzAwareness()` for run
and ticket summaries (`packages/daemon/src/oz-chat.ts:210`, `packages/daemon/src/oz-chat.ts:224`), then
returns a whole JSON reply.

Headless Oz agent loop: `packages/daemon/src/oz-host.ts`.
It owns natural-language Oz responses and tool turns. `tryHandleOzAgentTurn()` gates one in-flight turn per
workspace session (`packages/daemon/src/oz-host.ts:66`). `runToolLoop()` calls `runTurn()` until Oz either
answers or emits an `OZ_TOOL` line (`packages/daemon/src/oz-host.ts:107`). `buildPrompt()` rebuilds facts
from priorities, `ctx.store.listRuns()`, and `readTickets()` through `projectOzAwareness()`
(`packages/daemon/src/oz-host.ts:190`).

Daemon status/feed projection: `packages/daemon/src/routes.ts` and `packages/daemon/src/context.ts`.
`GET /runs` reads `ctx.store.listRuns()` in `listRuns()` (`packages/daemon/src/routes.ts:415`).
`GET /runs/:id` reads the run, sessions, work items, commits, events, run-dir files, and deep-linkability in
`runDetail()` (`packages/daemon/src/routes.ts:421`). `GET /oz/events` is an SSE refetch-hint stream
implemented by `streamOzEvents()` (`packages/daemon/src/routes.ts:459`) over `OzEventBus` and `emitOzEvent()`
(`packages/daemon/src/context.ts:28`, `packages/daemon/src/context.ts:68`).

Renderer chat surface: `packages/ui/src/renderer/sections/dashboard/OzChat.tsx`.
`OzChatPanel` renders shell controls, target picker, messages, typing affordance, quick prompts, and the
input (`packages/ui/src/renderer/sections/dashboard/OzChat.tsx:75`). `ChatMessageView` renders the message
body by applying one bold regex to `msg.body` and injecting HTML (`packages/ui/src/renderer/sections/dashboard/OzChat.tsx:9`,
`packages/ui/src/renderer/sections/dashboard/OzChat.tsx:20`). Attachments currently support run cards only
through the renderer `ChatMessage` shape (`packages/ui/src/renderer/model.ts:67`).

Renderer/main refresh path: `packages/ui/src/renderer/App.tsx`, `packages/ui/src/renderer/live.ts`,
`packages/ui/src/main/daemon-client.ts`, `packages/ui/src/main/chat-send.ts`, and
`packages/ui/src/main/events-stream.ts`.
`App.onSend()` appends one user message, awaits one Oz message, and clears `ozTyping`
(`packages/ui/src/renderer/App.tsx:298`). `sendOzMessage()` awaits `oz.chatSend()` and maps it to one
renderer `ChatMessage` (`packages/ui/src/renderer/live.ts:86`). Main process `ozChat()` POSTs to
`/oz/messages` and preserves the daemon's reply string even for Oz-originated 4xx/5xx answers
(`packages/ui/src/main/daemon-client.ts:101`). SSE events are sanitized in `events-stream.ts`
(`packages/ui/src/main/events-stream.ts:8`) and debounced into `refreshWorkspace()` / `refreshRunDetail()`
in `App.tsx` (`packages/ui/src/renderer/App.tsx:215`).

## 3. STREAMING & THINKING CAPABILITY

Current answer: the Oz runtime does not expose incremental final-answer tokens, and it does not expose
separate reasoning/thinking tokens.

Evidence:

- `runTurn()` builds an adapter command, waits for `runHeadlessProcess`, then reads `result.output.trim()`
  as a complete reply (`packages/daemon/src/oz-host.ts:148`, `packages/daemon/src/oz-host.ts:168`,
  `packages/daemon/src/oz-host.ts:182`). Its output type is only `{ text, outPath }`
  (`packages/daemon/src/oz-host.ts:42`).
- `runToolLoop()` returns `chatResult(200, { reply: output.text, command: 'chat', ok: true })` after the
  full turn is complete (`packages/daemon/src/oz-host.ts:116`).
- The daemon HTTP route for `POST /oz/messages` reads JSON, awaits `handleOzMessage()`, and sends one JSON
  object through `sendJson()` (`packages/daemon/src/routes.ts:767`).
- The UI IPC contract has `ChatMessage { role, text, at }` and `OzChatReply { reply, ok, command, action? }`;
  neither contains token chunks, a stream id, or reasoning fields (`packages/ui/src/main/ipc-contract.ts:223`,
  `packages/ui/src/main/ipc-contract.ts:229`).
- Renderer `sendOzMessage()` awaits one `chatSend()` result, then produces one Oz message body
  (`packages/ui/src/renderer/live.ts:86`).

Therefore item 1's markdown rendering is wiring inside the existing single-message contract, but streaming
and show-thinking-if-available are net-new protocol plumbing unless the adapter layer grows a streaming /
reasoning-capable surface first. The UI should still model thinking as optional so runtimes that never emit
it degrade silently.

## 4. SETTINGS SURFACE

The durable settings owner is `packages/daemon/src/settings.ts`.

`Settings` includes `ozAutoCompactRuns` (`packages/daemon/src/settings.ts:4`), `DEFAULT_SETTINGS` sets it
to `3` (`packages/daemon/src/settings.ts:10`), and `saneOzAutoCompactRuns()` clamps it to `2..10`
(`packages/daemon/src/settings.ts:13`, `packages/daemon/src/settings.ts:16`). Persistence is the same file:
`readSettings()` reads the settings path returned by `settingsPath()` (`packages/daemon/src/settings.ts:12`,
`packages/daemon/src/settings.ts:40`) and `mergeWriteSettings()` writes that path atomically
(`packages/daemon/src/settings.ts:48`). HTTP access is `GET /settings` and `PUT /settings`
(`packages/daemon/src/routes.ts:502`, `packages/daemon/src/routes.ts:885`).

The IPC/main bridge is the existing settings channel in `packages/ui/src/main/ipc-contract.ts:243`,
`packages/ui/src/main/settings-sync.ts:11`, and `packages/ui/src/main/main.ts:41`. `settings-sync.ts`
keeps daemon-owned fields in `daemonPatch()` and keeps renderer preferences local (`packages/ui/src/main/settings-sync.ts:11`).
The fallback cache is `packages/ui/src/main/store.ts:79`. Preload exposes `settingsGet` and `settingsSet`
(`packages/ui/src/preload/preload.ts:30`).

The renderer owner is `packages/ui/src/renderer/model.ts:71` plus `SettingsScreen` in
`packages/ui/src/renderer/sections/Settings.tsx:85`. The UI already renders "Oz Auto Compact at N Runs" as
an advanced numeric input with min `2` and max `10` (`packages/ui/src/renderer/sections/Settings.tsx:143`).
`App.saveSettings()` persists `ozAutoCompactRuns` through `oz.settingsSet()`
(`packages/ui/src/renderer/App.tsx:286`).

The runtime trigger is `recordOrchestratedRun()` in `packages/daemon/src/oz-host.ts:428`, which reads the
daemon setting and compacts the daemon-local Oz transcript counter. `attachRunLifecycle()` calls it on
`run-settled` (`packages/daemon/src/launcher.ts:282`, `packages/daemon/src/launcher.ts:315`). This is the
single counting owner; do not add a second UI-side or prompt-side compaction toggle.

## 5. DRAG-TO-ASK

Dashboard work items are represented as renderer view models in `packages/ui/src/renderer/model.ts`:
`Priority` (`packages/ui/src/renderer/model.ts:17`), `Ticket` (`packages/ui/src/renderer/model.ts:23`),
`Run` (`packages/ui/src/renderer/model.ts:34`), and `ChatMessage` (`packages/ui/src/renderer/model.ts:67`).

Priority cards live in `packages/ui/src/renderer/sections/dashboard/Priorities.tsx`. They are already
`draggable`, but only for queue reorder; no `DataTransfer` payload is set (`packages/ui/src/renderer/sections/dashboard/Priorities.tsx:24`).
The panel tracks only `{ from, over }` reorder state (`packages/ui/src/renderer/sections/dashboard/Priorities.tsx:117`).

Ticket cards live inside `TicketsTab` in `packages/ui/src/renderer/sections/dashboard/Dashboard.tsx:87`.
They are also `draggable`, but only for ticket-order reorder; no pointer payload is set
(`packages/ui/src/renderer/sections/dashboard/Dashboard.tsx:123`).

Run rows live in `RunsTab` in `packages/ui/src/renderer/sections/dashboard/Dashboard.tsx:176`. They are
clickable, not draggable (`packages/ui/src/renderer/sections/dashboard/Dashboard.tsx:203`).

The Oz terminal has no drop-target plumbing today. `OzChatPanel` owns the input area at
`packages/ui/src/renderer/sections/dashboard/OzChat.tsx:120`, but there are no `onDrop` / `onDragOver`
handlers in that component. Existing chat attachments only render run cards (`packages/ui/src/renderer/sections/dashboard/OzChat.tsx:21`)
and the model carries only `{ kind, runId }` (`packages/ui/src/renderer/model.ts:69`).

Implementation should add one lightweight pointer contract in the renderer model, for example
`kind`, `workspaceId`, `itemType`, `slug`, and `path`, then pass the pointer through the existing
`OzChatPanel` input/send seam. Priority pointers should refer to the workspace-relative priority markdown
file derived from the slug; ticket pointers should refer to the actual ticket file under the workspace ticket loader; run pointers should
refer to the durable run identity and, when available, portable run history. The daemon side should resolve
the pointer through the shared awareness/read owners, not by injecting full file bodies into chat state.

## 6. TESTS/FIXTURES THAT PIN THESE

Run store and portable history:
`packages/core/tests/store.test.ts`, `packages/core/tests/portable-store.test.ts`,
`packages/core/tests/portable-run-creation.test.ts`, and `packages/core/tests/portable-migrate.test.ts`.

Ticket source and authoring contract:
`packages/core/tests/tickets.test.ts` and `packages/core/tests/orchestration-contracts.test.ts`.

Daemon Oz loop and awareness:
`packages/daemon/tests/oz-chat.test.ts`, `packages/daemon/tests/oz-agent-chat.test.ts`,
`packages/daemon/tests/oz-awareness.test.ts`, and `packages/daemon/tests/mutations.test.ts`.

Daemon read/status/events/settings:
`packages/daemon/tests/read-surfaces.test.ts`, `packages/daemon/tests/events.test.ts`, and
`packages/daemon/tests/settings.test.ts`.

Runner status feed:
`packages/core/src/runner/status.ts` is pinned by `packages/core/tests/status.test.ts`.

UI chat/rendering/live/settings:
`packages/ui/tests/ozchat.test.tsx` currently pins run-card rendering/click behavior;
`packages/ui/tests/live-app.test.tsx` pins live load, event refresh, chat routing, and panel-ratio persistence;
`packages/ui/tests/events-stream.test.ts` pins SSE parsing/forwarding;
`packages/ui/tests/chat-send.test.ts` pins chat forwarding;
`packages/ui/tests/settings-sync.test.ts` and `packages/ui/tests/app.test.tsx` pin settings behavior.

Fixtures:
`packages/ui/fixtures/runs.json`, `packages/ui/fixtures/run-detail.json`,
`packages/ui/fixtures/tickets.json`, `packages/ui/fixtures/oz-messages.json`,
`packages/ui/fixtures/priorities.json`, `packages/ui/fixtures/workspaces.json`, and
`packages/ui/src/renderer/seed.json`.

## 7. COORDINATION & ADJACENT GAPS

`workspace-segmentation` is archived (`cocoder/PLAYBOOK.md:208`) and owned the Oz/workspace panel boundary:
workspace panel tabs, panel ratio, Oz panel global controls, and workspace-vs-chat target separation
(`cocoder/priorities/archive/workspace-segmentation.md:15`,
`cocoder/priorities/archive/workspace-segmentation.md:67`). In current code, `Dashboard` owns the grid,
`ResizeHandle`, `panelRatio`, tab strip, workspace tabs, and passes shell props into `OzChatPanel`
(`packages/ui/src/renderer/sections/dashboard/Dashboard.tsx:23`,
`packages/ui/src/renderer/sections/dashboard/Dashboard.tsx:225`,
`packages/ui/src/renderer/sections/dashboard/Dashboard.tsx:267`). `OzChatPanel` owns the chat contents,
header controls, target picker, typing state, quick prompts, and input (`packages/ui/src/renderer/sections/dashboard/OzChat.tsx:75`).

For item 1, touch chat rendering quality inside `OzChatPanel`: `ChatMessageView`, message list, typing /
streaming message state, and input send state. Do not rework the `Dashboard` grid, workspace tabs,
`ResizeHandle`, panel-ratio persistence, or global controls.

Ticket `cocoder/tickets/open/0013-daemon-auto-rebuild-after-runs.md` is not subsumed by item 4. Item 4 can
make a running, current daemon emit and consume state-change hints; ticket 0013 is about rebuilding and
reloading a stale daemon process after code changes to the daemon package or dependencies
(`cocoder/tickets/open/0013-daemon-auto-rebuild-after-runs.md:13`). It remains adjacent infrastructure.

Ticket `cocoder/tickets/closed/0015-tickets-silently-dropped-without-frontmatter.md` is functionally
subsumed only as a dependency that is already closed. Its root cause was loader lossiness
(`cocoder/tickets/closed/0015-tickets-silently-dropped-without-frontmatter.md:29`); the current loader
tolerates no-frontmatter tickets and warns on malformed files (`packages/core/src/tickets/loader.ts:40`,
`packages/core/src/tickets/loader.ts:88`). Item 4 should rely on that loader, not reopen ticket parsing.

The run_131 symptom was "newly committed ticket 0014 did not appear in Oz" (`cocoder/priorities/oz-hardening.md:56`).
Run_156 records that `ticket-created` events and the shared awareness projection close that symptom
(`cocoder/SESSION_LOG.md:24`). The remaining risk is not ticket parsing; it is ensuring all future status
read paths keep using `projectOzAwareness()` and the existing SSE/refetch path.

## 8. PROPOSED ATOM SEQUENCE

1. Decisions/taxonomy check.
Exit criterion: update this owner map only if the priority or source changed; otherwise explicitly carry
forward `projectOzAwareness()` as the shared owner and `settings.ts` as settings owner. Loop-amenable: yes,
read-only.

2. Shared projection engine preservation for items 2 and 4.
Exit criterion: tests prove `factsDigest`, Oz `status`, and ticket-created/event-refresh paths still consume
`projectOzAwareness()`; no second awareness contract appears. Loop-amenable: yes.

3. Render quality for item 1.
Exit criterion: `OzChat.tsx` renders markdown safely for headings, lists, fenced code, inline code, and links;
single-shot replies still work; optional thinking blocks render only when present. If streaming is added, the
protocol extension starts at daemon/main IPC contracts, not inside layout code. Loop-amenable: yes, but split
streaming protocol from markdown if the diff grows.

4. Streaming/thinking plumbing for item 1.
Exit criterion: daemon, main IPC, renderer model, and `OzChatPanel` support incremental reply updates and
optional reasoning chunks, with graceful absence when adapters provide none. Loop-amenable: likely no; keep
as a focused protocol atom.

5. Drag-to-ask pointer for item 3.
Exit criterion: priority, ticket, and run rows set one pointer payload; `OzChatPanel` accepts drops and shows a
visible slug/path attachment; send path passes pointer metadata; Oz resolves by reference through the shared
read owners. Loop-amenable: yes if split UI payload from daemon resolution.

6. Proof.
Exit criterion: targeted tests plus a bounded running-app proof demonstrate markdown, streaming or explicit
single-shot fallback, show-thinking-if-available, compact/status accuracy, auto pickup, and drag-to-ask. Do
not claim launchability from unit/type/build checks alone. Loop-amenable: no; proof should be one bounded pass.
