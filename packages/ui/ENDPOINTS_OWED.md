# Oz dashboard — ENDPOINTS OWED

The dashboard is built against the daemon's **existing** endpoints. Where a surface needed an endpoint
that does not exist yet, it was built against existing endpoints, stubbed cleanly, and recorded here.
Each item names the **surface** that needs it and the **seam** in this codebase where it plugs in with
**zero renderer change** when the endpoint lands.

| # | Endpoint(s) | Needed by | Seam (where it plugs in) | Status today |
|---|-------------|-----------|--------------------------|--------------|
| 1 | `POST /oz/messages` (+ `GET /oz/stream` SSE) | Oz chat — the command center (Dashboard) | `electron/chat.ts` `ozReply()` → swap for a daemon call behind `window.oz.chatSend`; renderer (`app/sections/OzChat.tsx`) unchanged | **Stub**: main-process Oz reply; real, working chat shell with GUI⇄Oz parity as the design goal |
| 2 | `GET /clis` ; `POST /clis/:id/test` ; `POST /clis` | CLIs section | `app/sections/CLIs.tsx` (disabled preview of list + status + Test + add form) | **Stub**: clearly-marked "pending endpoint" preview |
| 3 | `POST /workspaces/:id/priorities/reorder` (needs a position/order field) | Drag-reorder priorities (Dashboard) | `electron/store.ts` `setPriorityOrder` behind `window.oz.prioritiesReorder` — swap local store for the daemon call; `app/sections/Priorities.tsx` unchanged | **Working** via client-owned `order: string[]` in a local store |
| 4 | `POST /workspaces/:id/priorities` (create) | "Create a persona via a priority" (Personas) and priority creation | `app/sections/Personas.tsx` pending block; a future Priorities "+ new" action | **Stub**: marked pending |
| 5 | `POST /workspaces` ; `PUT/DELETE /workspaces/:id` (+ a `roots[]`/role model) | Workspaces roots & roles editor | `app/sections/Workspaces.tsx` disabled editor (Name · Path · Role, exactly one Primary) | **Stub**: today `/workspaces` is thin (id/name/path only) |
| 6 | `GET/PUT /settings` (+ the deferred C-S5 secret redaction) | Settings | `electron/store.ts` settings behind `window.oz.settingsGet/Set` — swap local JSON store for the daemon call; `app/sections/Settings.tsx` unchanged | **Working** as client-only local prefs (poll interval, default workspace) |
| 7 | extend `POST /runs` with `{task?}` | Ad-hoc "run without a priority" with free text | `app/sections/Priorities.tsx` ad-hoc button → currently launches the `adhoc-session` priority | **Working** via `adhoc-session`; no free-text field yet |
| 8 | extend personas assignment with `{mode, subAgents}` | Personas: visible/headless toggle + sub-agent hierarchy | `app/sections/Personas.tsx` (disabled "coming soon" controls); `PersonaAssignment` type in `electron/ipc-contract.ts` | **Stub**: needs a core change to the assignment model |
| 9 | `POST /runs/:id/stop` | Stop a RUNNING run (vs. only closing panes) | `app/sections/RunDrawer.tsx` controls — add a Stop next to Close; `app/client.ts` add a `stopRun()` | **Not built**: today only `POST /runs/:id/teardown` (closes panes, not a stop) |

## Notes on fidelity to daemon reality (wired to these, not assumptions)

- **Personas**: the `GET …/personas` response's `personas[]` is **empty**; the live data is the
  `assignments` map. The editor is built over that map and `PUT …/assignments` is a **full-map replace**
  (the whole map is sent every save, or personas would be dropped).
- **Oz is not in the personas response** — it is rendered as a persona (headless, in-app) with no
  assignment row.
- **Run ids are opaque** (mixed `run_17` / hex) and never parsed. **Status** ∈ {running, completed,
  pending-scope-decision, failed}. **Transcript is polled** (`GET /runs/:id`, ~poll interval from
  Settings, paused when hidden) — there is no SSE/WS yet.
- **Security**: all daemon HTTP is in the Electron main process — Bearer on every request, the
  `x-oz-csrf-token` on every mutation, loopback Host, and **no** `Origin` header (an absent Origin is
  allowed; a non-loopback one self-403s). Tokens never cross the IPC bridge or get logged.
- **TIER-3 read-only oversight**: the run drawer's Oversight section is a read-only projection of Deb's
  outputs + monitor signals. No `sendInput`/orchestration anywhere; the only writes are the run
  lifecycle ops this daemon owns (show / teardown / runs).
