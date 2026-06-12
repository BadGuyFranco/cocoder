# Oz dashboard — ENDPOINTS OWED

The dashboard is built against the daemon's **existing** endpoints. Where a surface needed an endpoint
that does not exist yet, it was built against existing endpoints, stubbed cleanly, and recorded here.
Each item names the **surface** that needs it and the **seam** in this codebase where it plugs in with
**zero renderer change** when the endpoint lands.

| # | Endpoint(s) | Needed by | Seam (where it plugs in) | Status today |
|---|-------------|-----------|--------------------------|--------------|
| 1 | `POST /oz/messages` (+ `GET /oz/events` SSE) | Oz chat — the command center (Dashboard) | `electron/daemon-client.ts` `ozChat()` behind `window.oz.chatSend`; `electron/events-stream.ts` consumes refetch hints; renderer (`app/sections/OzChat.tsx`) unchanged | **SERVED** end-to-end: `POST /oz/messages` is wired to the daemon command parser; SSE refetch hints landed run_59 (`GET /oz/events` daemon commit da24ba8; UI consumption commit 2b9c29d). The daemon publishes Bearer-gated coarse hints (`run-created`, `run-settled`, `stop-requested`, `run-resolved`, `run-torn-down`) from `OzContext`'s typed `OzEventBus` with retry hint, 15s heartbeat, and disconnect cleanup; the UI main process reuses the daemon-client Bearer session (tokens never cross the bridge), forwards sanitized `onOzEvent` pushes through preload, debounces them into the same workspace/run-detail refresh paths polling uses, keeps polling as fallback, and never connects in fixtures mode. Evidence: daemon 130 green, UI 84 green, root typecheck clean |
| 2 | `GET /clis` ; `POST /clis/:id/test` ; `POST /clis` | CLIs section | `app/sections/CLIs.tsx` consumes the live list + real Test; Add remains a disabled future-registration surface | **PARTIAL**: `GET /clis` and `POST /clis/:id/test` are **SERVED** (run_42, d76cb5a); only `POST /clis` remains owed because CLIs derive from compiled adapters |
| 3 | `POST /workspaces/:id/priorities/reorder` | Drag-reorder priorities (Dashboard) | `electron/priorities-sync.ts` calls the daemon behind `window.oz.prioritiesReorder`; `electron/store.ts` remains the offline cache; `app/sections/Priorities.tsx` unchanged | **SERVED** by daemon-tracked `cocoder/priorities/order.json` with local fallback cache |
| 4 | `POST /workspaces/:id/priorities` (create) | "Create a persona via a priority" (Personas) and priority creation | `electron/priorities-create.ts` behind `window.oz.prioritiesCreate`; Dashboard New-Priority modal + Personas Craft modal share it | **SERVED** end-to-end: daemon create landed run_55 (97e3283); UI consumption landed run_56 atom 0 (aee75c9), with verbatim errors, no fake-create, and place-at-top via reorder |
| 5 | `POST /workspaces` ; `PUT/DELETE /workspaces/:id` (+ a `roots[]`/role model) | Workspaces roots & roles editor | `electron/workspaces-sync.ts` behind `window.oz.workspacesCreate/Update/Delete`; `app/sections/Workspaces.tsx` edits raw `.code-workspace` paths and refreshes from the daemon | **SERVED** end-to-end with raw-path fidelity, roots/roles, verbatim daemon errors, and legacy-hidden migration notice |
| 6 | `GET/PUT /settings` (+ the deferred C-S5 secret redaction) | Settings | `electron/settings-sync.ts` calls the daemon behind `window.oz.settingsGet/Set`; `electron/store.ts` remains the offline cache; `app/sections/Settings.tsx` unchanged | **SERVED** by daemon-global `local/settings.json` with local fallback cache |
| 7 | extend `POST /runs` with `{task?}` | Ad-hoc "run without a priority" with free text | Ad-hoc button pre-fills the Oz Terminal with `adhoc <task>`; `POST /oz/messages` launches `adhoc-session` with the task | **SERVED** end-to-end via daemon `{task?}` plus the bounded Oz `adhoc` verb |
| 8 | honor personas assignment `mode` | Personas: visible/headless toggle | `core/personas` validates `mode`; `plays/dispatch.ts` honors it for Play dispatch; UI `PersonaAssignment` passes it through untouched | **PARTIAL**: `mode: 'visible'\|'headless'` persists + daemon PUT round-trips/400s invalid values, and `headless` forces captured-subprocess Plays (run_56 atom 1, bcac308); Oscar/Bob session honoring + UI editor wiring remain owed |
| 9 | `POST /runs/:id/stop` | Stop a RUNNING run (vs. only closing panes) | Existing run drawer Stop action calls `app/live.ts` `stopRun()` | **SERVED** end-to-end: daemon endpoint landed run_58 atom 1 (932df67); Oz-chat `stop` remaps to cooperative stop and the UI consumes the same endpoint in this atom |
| 10 | `POST /runs/:id/resolve` `{disposition: "discard"\|"landed", note?}` | Resolve a parked run (pending-scope-decision / pending-landing) from the run drawer / a "decisions awaiting you" panel — the ADR-0015 decision-mechanics exit | `app/sections/dashboard/RunDetail.tsx` Resolve actions on parked runs; `app/sections/dashboard/Dashboard.tsx` derives the "Awaiting you" list from `GET /runs` statuses (no new read endpoint needed) | **SERVED** end-to-end: daemon resolve endpoint is consumed in the drawer, and the Dashboard awaiting list derives from existing run polling |

## Notes on fidelity to daemon reality (wired to these, not assumptions)

- **Personas**: the `GET …/personas` response's `personas[]` is **empty**; the live data is the
  `assignments` map. The editor is built over that map and `PUT …/assignments` is a **full-map replace**
  (the whole map is sent every save, or personas would be dropped).
- **Oz is not in the personas response** — it is rendered as a persona (headless, in-app) with no
  assignment row.
- **Run ids are opaque** (mixed `run_17` / hex) and never parsed. **Status** ∈ {running, completed,
  pending-scope-decision, pending-landing, failed}. **Transcript is still polled** (`GET /runs/:id`,
  ~poll interval from Settings, paused when hidden); `GET /oz/events` SSE is only a coarse "refetch now"
  hint stream, with polling retained as fallback.
- **Security**: all daemon HTTP is in the Electron main process — Bearer on every request, the
  `x-oz-csrf-token` on every mutation, loopback Host, and **no** `Origin` header (an absent Origin is
  allowed; a non-loopback one self-403s). Tokens never cross the IPC bridge or get logged.
- **TIER-3 read-only oversight**: the run drawer's Oversight section is a read-only projection of Deb's
  outputs + monitor signals. No `sendInput`/orchestration anywhere; the only writes are the run
  lifecycle ops this daemon owns (show / teardown / runs).
