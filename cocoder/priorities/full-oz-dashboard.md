---
id: full-oz-dashboard
title: Full Oz dashboard — the v1-designed control plane, earned in slices
---

## Objective
Oz grows from the four Phase-2 "thin" surfaces to the v1-designed control plane — an in-app **chat
command interface**, **run oversight/debugger**, **settings**, and **drag-reorder priorities** — built
and operated in **earned slices**, not big-bang (D6). **Verified** per slice: each ships behind the
existing loopback/token/Origin/CSRF posture and is operated end-to-end from the dashboard before the
next slice starts. Boundary: rides the existing `core` ports + the Phase-2 daemon/ui; no fork.

This is the road to feature-complete and the surface you actually operate from (re-authored from the
archived v1 `v0.4-oz-control-plane` as reference, not resurrected). Three reconciliations flagged for
design time: its **drag-reorder** is where priority *ordering* migrates off the interim (`backlog/` +
the PLAYBOOK roadmap) into Oz/DB; its **oversight/debugger** must be reconciled with [`deb`](../zArchive/priorities/v2/deb.md)
so we build one debugger, not two; and its oversight is **tier 3 of the observation hierarchy
(ADR-0013)** — Oz monitors Oscars across sessions and may observe (poll) Bobs/Debs, but never
orchestrates them — **reusing** the monitor primitive built by
[`oscar-orchestrates-bob`](../zArchive/priorities/v2/oscar-orchestrates-bob.md) (done + archived), not a second implementation. Slice sequencing
is decided when this is picked up, not here.

## Status

**In progress — `continue`.** The v1 Electron dashboard is realized and **wired to every daemon
endpoint that exists**; surfaces without an endpoint stub cleanly and are tracked in
`packages/ui/ENDPOINTS_OWED.md` (live tracker). Slices 1–5 (adapter, polling, connection-states,
mutations, drag-reorder seam), CLI list/test consumption, and `POST /oz/messages` are **merged to
trunk** (`feat/oz-dashboard` was the merge-base). run_54 (2026-06-11) closed three more owed
surfaces end-to-end: **priority reorder** (the ADR-0010 `order.json` manifest, daemon + UI),
**free-text ad-hoc runs** (`POST /runs {task?}` + the bounded Oz `adhoc` verb + describe-first UI),
and **run-resolve consumption** (Resolve actions on parked runs in the run drawer). run_55
(2026-06-11) closed three more: **sub-agents over the `plays` map** (ADR-0018 stage 1, accepted at
run_54 wrap — Personas screen renders + persists per-Play `{cli, model}` through the existing
`PUT …/assignments`), the **"Awaiting you" Dashboard list** (renderer-only, derives blocked /
not-landed from existing run polling; click opens the drawer with its Resolve actions), and the
**daemon half of priority create** (`POST /workspaces/:id/priorities`, injection-hardened). run_56
(2026-06-11) closed two more: **priority-create UI consumption** (New-Priority modal on the
Dashboard "Add priority" action + Craft-a-persona files through the same typed
`electron/priorities-create.ts` seam) and **ADR-0018 stage 2** (`mode` persists in
`assignments.json` and is honored for Play dispatch — `headless` forces the captured-subprocess
path; `visible` never forces panes), plus a truth sweep of `ENDPOINTS_OWED.md`. run_57
(2026-06-11) closed the **Workspaces daemon model end-to-end (ADR-0019, owed slice #2)** in four
atoms: the registry reads `local/workspace/*.code-workspace` files (roles, one-primary rule,
legacy `workspaces.json` fallback), full daemon CRUD (`PUT`/`POST`/`DELETE /workspaces…`) with
ADR rules 6/7 enforced at the write gate, and the Workspaces screen operating it live with
raw-path fidelity. run_58 (2026-06-11) closed **`POST /runs/:id/stop` end-to-end (owed slice #3)**
in three atoms: a cooperative-stop seam in the runner core (first-class `stopped` run status; a
founder stop is no longer misrecorded as a fault), the CSRF-gated daemon endpoint with per-run
abort controllers + post-settle pane/worktree cleanup, and the consumption tail (Oz-chat `stop`
verb split off its teardown alias; the dashboard's Stop action wired live). run_59 (2026-06-11,
overnight auto mode) closed two more: **Oz-chat SSE end-to-end** (daemon `GET /oz/events` coarse
refetch hints + UI main-process consumption debounced into the existing polling refresh paths,
polling retained as fallback) and **ADR-0018 stage 3 for the OSCAR session end-to-end** (an
`OscarDriver` seam in the runner; `mode:'headless'` runs Oscar as fresh one-shot
captured-subprocess invocations over the unchanged file-artifact handshake; the Personas
run-mode editor persists for Oscar only). **Not archive-ready** — remaining: Oz-as-persona
(ADR-0017), Bob session `mode` honoring (gated on a captured-subprocess monitor path for builder
work), and a live (non-test) exercise of a headless-Oscar run.

> History worth recording: a first pass mistakenly built from `docs/oz-design-brief.md` (the *input
> brief* that was pasted into claude.ai/design), not the founder's actual **design output**. It was then
> **rebuilt** against the real v1 prototype, now preserved in-repo at **`packages/ui/design-ref/`** —
> the authoritative spec (Fusion design system, dashboard/screens/components JSX, the 18 dev-notes,
> seed data). Always build the Oz UI from `design-ref/`, not the brief.

### Accomplished (done + verified)

- **Electron desktop app** (`packages/ui`): electron-vite + React + TS. Renderer in `app/`,
  main+preload in `electron/`, so `packages/ui/src` stays Node-only and the **root typecheck + topology
  stay green**. Launches as a real, interactive window.
- **Security posture wired, main-process only:** typed daemon client does the `/auth/session`
  handshake; **Bearer on every request + `x-oz-csrf-token` on every mutation**, loopback `Host`, **no
  `Origin`** header (matches `packages/daemon/src/security.ts`). Renderer reaches the daemon only over a
  narrow typed IPC bridge (`contextIsolation:true, sandbox:true, nodeIntegration:false`); tokens never
  cross the bridge or get logged. **Preload must be CommonJS (`preload.cjs`)** — a sandboxed ESM preload
  silently fails to load (hard lesson, recorded).
- **Design realized faithfully — Fusion "Warm Espresso":** espresso/gold palette, glass backdrop-blur
  panels, Deco corner accents, Phosphor **thin** icons, Josefin Sans + Inter + JetBrains Mono — **all
  bundled offline** (no Google-Fonts CDN) so it works under the strict CSP.
- **5-section IA** (Dashboard · Workspaces · CLIs · Personas · Settings); Runs + Priorities are
  Dashboard panels, never standalone pages. **Workspace tabs** (browser-style, multiple loaded at once,
  each its own Oz, pulsing-dot for live runs).
- **Dashboard mental model — "a run IS a priority being executed":** drag-reorderable queue (top = next
  up); a running priority expands an **inline run summary**; selecting it opens the **run-detail drawer
  in place between the queue and the Oz chat** (gold notch handoff). **Ad-hoc** is a pinned row holding
  many concurrent runs. **Oz Terminal** is the command center with **decision callouts** (resolve a
  blocked run inline), inline run cards, quick-prompt pills, typing indicator. Run-detail tabs
  **Transcript · Evidence · Attach**; status-adaptive footer; **Run History** modal; **first-run**
  setup ladder for empty workspaces.
- **All four screens:** Workspaces (roots/roles editor, one-Primary rule), CLIs (status summary +
  per-CLI Test + exact errors + model list), Personas (Oz + roster, linked CLI/Model, visible/headless,
  **sub-agent hierarchy**, "Craft a persona" files a priority), Settings (tabbed: Appearance / System
  dependencies / Watching / Advanced / About). New-Workspace + Craft-Persona modals (portal-to-`<body>`,
  solid opaque card, so they paint cleanly over the glass panels).
- **No raw JSON anywhere; GUI⇄Oz parity** as the design goal; **TIER-3** posture preserved (render-only;
  no sendInput/orchestration).
- **Daemon adapter + polling + connection states + mutations + drag-reorder seam** (slices 1–5):
  renderer consumes live daemon data for every existing endpoint; `OZ_FIXTURES` replay for tests;
  **live-smoke verified** on trunk.
- **`GET/PUT /settings`** (run_43, `3e2584d`): daemon persists to `<home>/local/settings.json`
  (atomic tmp+rename); PUT rides CSRF+Bearer mutation gate (403-without-CSRF proven). UI main-process
  handlers prefer daemon, fall back to local store when unreachable (`daemon-client` returns `{ok:false}`
  on network failure — fallback genuinely fires). `Settings.tsx` contract untouched.
- **Oz chat — `POST /oz/messages`** (run_46, `0637c04`): the marquee command-center slice. A **bounded
  command interface** (`launch` / `show` / `stop`+`teardown` / `status` / `help`) parsed in
  `packages/daemon/src/oz-chat.ts` and routed to existing run-lifecycle launcher ops — **no in-daemon
  LLM**; same Bearer/CSRF/loopback posture. UI wired via `electron/chat-send.ts` + `daemon-client`.
  **Recovered, not rebuilt** — see the stranding note below.
- **Verification (run_46):** daemon tests 69 · ui tests 46 · typecheck 0 · topology pass. Fresh
  worktree baseline needs `pnpm install` at root first (no `node_modules` ship in the worktree).
- **run_54 (2026-06-11), five atoms, all verified + committed on `cocoder/run_54`:**
  (0) daemon priority ordering via the ADR-0010 **order-only manifest** — `GET …/priorities` sorts by
  `cocoder/priorities/order.json` (unlisted appended, stale ids ignored, missing manifest = old
  behavior), new `POST /workspaces/:id/priorities/reorder` writes it atomically behind the CSRF gate
  (`e4b1435`); (1) UI drag-reorder consumes it — `electron/priorities-sync.ts` mirrors the
  settings-sync daemon-first/offline-cache pattern, zero renderer change (`c1360a3`); (2) run drawer
  **Resolve actions** on parked runs (Mark landed / Discard) consuming `POST /runs/:id/resolve`,
  daemon 409 fail-closed messages surfaced verbatim (`b1747cc`); (3) `POST /runs` gains optional
  `{task}` (trim, 4000 cap, never persisted) threaded into Oscar+Deb launch prompts as a labeled
  ad-hoc-instruction section, byte-identical prompts when absent (`54745f7`); (4) bounded Oz
  `adhoc <task>` verb + design's describe-first ad-hoc flow (Launch pre-fills the Oz Terminal), and
  live chat send now actually posts through the existing `chatSend` bridge (`721437d`).
- **Verification (run_54):** core 202 · daemon 90 · ui 53 · root typecheck clean (all run per-atom at
  the verify gate).
- **run_55 (2026-06-11), three atoms, all verified + committed on `cocoder/run_55`:**
  (1) Personas **sub-agents wired to the real `plays` map** (ADR-0018 stage 1) — UI `PersonaAssignment`
  gains `plays`, the renderer renders/edits per-Play `{cli, model}`, and saves go through a new
  `electron/personas-sync.ts` seam to `PUT …/assignments` as the required `{personas: <full map>}`
  full-map replace; daemon-unreachable saves fail loudly (no offline fake-save); `mode` stays a
  truthful local preview (`2eb8591`); (2) **"Awaiting you" Dashboard strip** — renderer-only,
  `awaitingFounderRuns` derives blocked/not-landed from existing run polling, hides when empty, click
  opens the run drawer with its Resolve actions (`414633d`); (3) daemon **`POST
  /workspaces/:id/priorities`** (create) — slug/explicit id, atomic tmp-subdir validate-then-rename,
  control-char title rejection + round-trip assertion (frontmatter-injection-proof, exactly
  `{id, title}` keys, `scopeNarrowing` must be null), case-insensitive 409, CSRF-gated, audited
  (`97e3283`). Two atoms were first REJECTED at the verify gate and re-delegated: a wire-shape bug
  (bare map vs `{personas: …}`) and a frontmatter injection via newline-bearing titles — both caught
  by reading the daemon validators, not by the (green) bridge-mocked tests.
- **Verification (run_55):** core 202 · daemon 97 · ui 62 · root typecheck clean (per-atom at the
  verify gate; whole-tree diff checked every atom).
- **run_56 (2026-06-11), three atoms, all verified + committed on `cocoder/run_56`:**
  (1) **priority-create UI consumption** — new typed seam `electron/priorities-create.ts` (mirrors
  personas-sync) behind `window.oz.prioritiesCreate`; the Dashboard "Add priority" action opens a
  New-Priority modal (title + optional goal + place-at-top) in live mode, and Craft-a-persona files
  through the same `handleCreatePriority` path; daemon errors surface verbatim with NO offline
  fake-create; success refreshes from the daemon (real id) and place-at-top persists via the
  existing reorder seam; fixtures/demo mode unchanged. The design-ref routes "Add priority" through
  a free-form Oz chat reply — that depends on Oz-as-persona (ADR-0017), so the modal is the
  truthful interim; revisit when Oz-as-persona lands (`aee75c9`). (2) **ADR-0018 stage 2** —
  `PersonaAssignment` gains `mode?: 'visible'|'headless'` (core-validated; `PlayAssignment` stays
  exactly `{cli, model}`); `dispatchPlay` honors it: `headless` forces the captured-subprocess path
  regardless of Play kind, `visible`/absent leaves the Play's `kind` in control (a pane cannot
  reliably signal command exit — the run_28 hang class — so `visible` NEVER forces panes; rationale
  is a comment in `plays/dispatch.ts`); the launcher threads Oscar's mode into all three runner Play
  sites (wrap-up / integration-verify / merge-conflict); daemon PUT round-trips `mode` and 400s
  invalid values; the renderer's full-map PUT passes a daemon-side `mode` through untouched (closes
  a silent-erase footgun) while the Personas run-mode picker stays a local preview per the
  truthfulness rule (`bcac308`). (3) `packages/ui/ENDPOINTS_OWED.md` truth sweep — rows 2/4/8
  updated to current reality incl. the stale-since-run_42 CLIs row (`b26d68b`).
- **Verification (run_56):** core 204 · daemon 98 · ui 70 · root typecheck clean · topology pass
  (per-atom at the verify gate; whole-tree diff checked every atom).
- **run_57 (2026-06-11), four atoms, all verified + committed on `cocoder/run_57` — the ADR-0019
  Workspaces daemon model, end-to-end:**
  (0) registry reader rebuilt on the directory-of-files SSOT (`25c9b8d`) — `local/workspace/
  *.code-workspace` files (id/name = filename stem), three-role taxonomy with exactly-one-primary
  enforced, invalid files skipped not fatal, `${VAR}` expansion + VS-Code-style relative-path
  resolution against the file's dir, legacy `workspaces.json` fallback (synthesizes a primary
  root; the directory, once non-empty, supersedes it WHOLESALE), and the invariant
  `RegistryWorkspace.path` = the primary root's path so routes/launcher needed zero changes;
  (1) roots/roles exposed on `GET /workspaces` + `PUT /workspaces/:id` (`99f8509`) — ONE shared
  validator in `registry.ts` owns the folder rules for reader and writer; raw `${VAR}`/relative
  path strings persist verbatim (never resolved absolutes); ADR rules 6 (CoCoder always a root)
  and 7 (primary never strictly inside the install) reject with plain-English 400s BEFORE any
  write; 409 for legacy-sourced workspaces names the migration path; atomic dot-tmp+rename;
  (2) `POST /workspaces` + `DELETE /workspaces/:id` (`e5207dc`) — create is slug-gated
  (traversal-proof), 409s case-insensitively, and doubles as the legacy-migration path: the 201
  returns `legacyHidden` naming any legacy-only ids no longer served (visible + audited, never a
  refuse-deadlock); delete 409s for legacy-sourced workspaces and for in-flight runs
  (`ctx.inFlight`), and deleting the last file resurrecting the legacy fallback is asserted as
  intended; (3) Workspaces screen live (`eb7460c`) — `RegistryRoot.rawPath` feeds the editor (the
  raw string is what's edited and persisted; resolved path shown muted), new
  `electron/workspaces-sync.ts` seam behind `window.oz.workspacesUpdate/Create/Delete`
  (daemon-first, verbatim errors, NO offline fake-saves), New-Workspace modal POSTs a slugged id
  and auto-includes the CoCoder root (rule 6), `legacyHidden` surfaces as a plain notice, Delete
  wired to the screen's pre-existing button, stale PendingBanner removed + `ENDPOINTS_OWED.md`
  row 5 truthed to SERVED. Known cosmetic gap: the screen's workspace Name field edits local
  state only (daemon name = filename stem by design) so a name edit reverts on refresh.
- **Verification (run_57):** core 204 · daemon 120 · ui 77 · root typecheck clean · topology pass
  (per-atom at the verify gate; whole-tree diff checked every atom).
- **run_58 (2026-06-11), three atoms, all verified + committed on `cocoder/run_58` — `POST
  /runs/:id/stop`, end-to-end (owed slice #3):**
  (0) core cooperative-stop seam (`9a0c099`) — `RunnerDeps` gains an optional `AbortSignal`,
  honored at the loop's wait seams (the directive/verify/triage `pollFile` loops and the builder
  monitor's cadence) via a single `StopRequestedError` mechanism; on stop the runner records ONE
  `run-stopped` event, abandons + quarantines the in-flight atom, SKIPS integration, still writes
  the run record, and exits with a new first-class `'stopped'` RunStatus — a deliberate founder
  stop can no longer masquerade as `directive-timeout`/`builder-failed` or trigger Deb triage
  (which is what teardown-as-stop did). No signal = byte-identical behavior. The UI's
  `mapRunStatus` default already rendered unknown statuses as 'stopped', so zero UI accommodation
  was needed; (1) daemon `POST /runs/:id/stop` (`932df67`) — `OzContext.stopControllers` (runId →
  AbortController, registered at `onRunCreated`, always removed on settle), post-settle
  pane-close + worktree GC reusing the existing `closeRunSurfaces`/`gcWorktree` helpers (a
  `stop-teardown` event records it), and `requestStopRun` with honest statuses: 404 unknown, 409
  for terminal runs or a running row with no live controller (the daemon-restart orphan), 202
  cooperative. Stop is COOPERATIVE — honored only at the wait seams, so a stop arriving during
  wrap-up or integration lets the run finish rather than corrupting a merge; (2) consumption tail
  (`d570278`) — Oz-chat `stop <runId>` split off its teardown alias into a real `{kind:'stop'}`
  command dispatching `requestStopRun` (cooperative-wording reply, 409s verbatim; `teardown`
  byte-identical, re-asserted by test), renderer `live.ts stopRun()` over the existing generic
  `daemonPost` bridge (zero new IPC), the App's stubbed "isn't wired yet" Stop branch replaced
  with the real call, `ENDPOINTS_OWED.md` row 9 truthed.
- **Verification (run_58):** core 209 · daemon 127 · ui 79 · root typecheck clean (per-atom at
  the verify gate; whole-tree diff checked every atom).
- **run_59 (2026-06-11, overnight auto mode), seven atoms, all verified + committed on
  `cocoder/run_59` — Oz-chat SSE end-to-end AND ADR-0018 stage 3 for the Oscar session:**
  (0) daemon `GET /oz/events` (`da24ba8`) — a typed `OzEventBus` on `OzContext` with five
  synchronous never-throw emit sites in the launcher (run-created / run-settled w/ final status /
  stop-requested / run-resolved w/ disposition / run-torn-down), Bearer-gated SSE (GET, so no
  CSRF; mutation gate untouched) with `retry:` hint, 15s heartbeat, and disconnect cleanup —
  proven by a real streaming test; (1) UI consumption (`2b9c29d`) — main-process connector
  `electron/events-stream.ts` reuses the daemon-client Bearer session (tokens never cross the
  bridge), the contract's FIRST main→renderer push channel (`onOzEvent`, sanitized data only,
  field-whitelisted), renderer debounces hints (250ms) into the same workspace/run-detail refresh
  paths polling uses, polling untouched as fallback, fixtures mode never connects; (2)
  `OscarDriver` seam (`6ff309e`) — behavior-preserving extraction of all seven Oscar
  `sessionHost` touchpoints behind one interface, proven byte-identical by the unedited core
  suite; (3) `ENDPOINTS_OWED.md` row-1 truth sweep (`db59dd8`); (4) headless Oscar honoring
  (`67e7a99`) — `mode:'headless'` on Oscar's effective persona skips the pane: each dispatch is a
  fresh one-shot captured-subprocess invocation (reusing the Plays `runHeadlessProcess`, D4) with
  a `buildHeadlessOscarTurnPrompt` telling the fresh session to reconstruct state from the
  on-disk directive/verify artifacts; serialized never-throw sends, exit-0-safe `alive()` (no
  pollFile race), always-changing never-throw `readScreen`, nudges recorded-not-delivered,
  wrap-up pane delivery skipped with a `wrapup-delivery-skipped` event; `visible`/absent proven
  byte-identical + never invokes `runHeadless`; (5) Personas mode editor for Oscar only
  (`7a0921e`) — display `runMode` now derives from the real `mode` field (the `enabled`
  conflation ADR-0018 flagged is gone), `MODE_HONORED_PERSONAS = {oscar}` persists through the
  existing full-map PUT with verbatim errors, Bob's toggle stays a local preview, run_56
  silent-erase guard intact; (6) `ENDPOINTS_OWED.md` mode-row truth sweep (`fe7d94f`).
- **Verification (run_59):** core 216 · daemon 130 · ui 88 · root typecheck clean · topology pass
  (per-atom at the verify gate; whole-tree diff checked every atom; all seven atoms passed their
  gate first try).

> History worth recording (run_46): this Oz-chat slice was independently built by **run_44** (a
> status/query design) and **run_45** (the bounded command-interface design) — but **neither landed**;
> both were collateral of the worktree-landing bug since fixed in main. run_46 **recovered run_45's
> bounded-command version byte-identically and re-verified it** so it finally lands, and **abandoned
> run_44's divergent design**. Do not rebuild this slice a fourth time — the stranded `cocoder/run_44`
> / `cocoder/run_45` branches are superseded.
>
> Operational note (run_46): Bob's write-scope is `packages/**` only — it **fences out**
> `cocoder/priorities/` (governance). Priority Playbook edits belong in **Oscar wrap-up**, not a Bob
> atom; don't waste a builder atom on governance-doc updates.

### Remaining — daemon endpoints owed (back half)

The renderer is wired; remaining work is **new daemon surfaces**, not adapter plumbing. Live tracker:
`packages/ui/ENDPOINTS_OWED.md`. Each owed item carries a design seam or consumption tail — not
mechanical infra (Settings was the last clean infra slice).

| # | Surface | Seam / blocker |
|---|---------|----------------|
| 1 | Oz chat — `POST /oz/messages` | **SERVED** (run_46, `0637c04`): bounded command interface — verbs `launch <priorityId>` / `show <runId>` / `stop`+`teardown <runId>` / `status [runId]` / `help` parsed in `packages/daemon/src/oz-chat.ts` and dispatched to existing launcher ops; **no in-daemon LLM**, rides the existing Bearer/CSRF/loopback posture. **SSE SERVED** (run_59, `da24ba8` + `2b9c29d`): Bearer-gated `GET /oz/events` streams coarse refetch hints from a typed `OzEventBus`; the UI main process consumes it (tokens never cross the bridge) and debounces hints into the same refresh paths polling uses — polling stays the fallback. Anything richer than coarse hints (e.g. streamed transcripts) is a future refinement, not owed. |
| 2 | Workspaces CRUD + `roots[]`/role model | **SERVED end-to-end** (run_57, `25c9b8d` + `99f8509` + `e5207dc` + `eb7460c`): the daemon implements the full [ADR-0019](../decisions/0019-multi-root-workspaces.md) model — `local/workspace/*.code-workspace` directory-of-files SSOT (legacy `workspaces.json` fallback until migrated), roots/roles on `GET`, `PUT`/`POST`/`DELETE /workspaces…` with rules 6/7 enforced at the write gate, create = the migration path (`legacyHidden` visibility) — and the Workspaces screen operates it live with raw-path fidelity via `electron/workspaces-sync.ts`. NOTE: this install still runs on the legacy fallback until someone creates `local/workspace/cocoder.code-workspace` (the New-Workspace modal or a `POST /workspaces` does it). |
| 3 | `POST /runs/:id/stop` | **SERVED end-to-end** (run_58, `9a0c099` + `932df67` + `d570278`): cooperative stop — core `AbortSignal` seam with first-class `'stopped'` RunStatus (no fault/triage misfire), CSRF-gated daemon endpoint with per-run controllers + post-settle pane/worktree cleanup, Oz-chat `stop` verb remapped off teardown, dashboard Stop action live. Honored at the loop's wait seams only: a stop during wrap-up/integration lets the run finish (never corrupts a merge). |
| 4 | Persona `{mode, subAgents}` | **[ADR-0018](../decisions/0018-persona-run-mode-and-sub-agents.md) ACCEPTED (run_54 wrap). Sub-agents SERVED** (run_55, `2eb8591`): the Personas screen renders + persists per-Play `{cli, model}` over the existing `plays` map (no new schema). **`mode` stage 2 SERVED** (run_56, `bcac308`): `mode` persists in `assignments.json` and is honored for Play dispatch (`headless` forces captured subprocess; `visible` never forces panes — pane exit isn't detectable, the run_28 hang class); renderer passes `mode` through its full-map PUT untouched. **Stage 3 SERVED for OSCAR end-to-end** (run_59, `6ff309e` + `67e7a99` + `7a0921e`): the runner honors Oscar `mode:'headless'` via the `OscarDriver` seam (fresh one-shot captured-subprocess invocations per dispatch; file-artifact handshake unchanged; nudges recorded-not-delivered; wrap-up pane delivery skipped), and the Personas run-mode editor persists for Oscar only (`MODE_HONORED_PERSONAS`; display untangled from `enabled`; Bob's toggle stays a local preview). **Still owed:** Bob session honoring, gated on a captured-subprocess monitor path for builder work (the run_28 hang class). |
| 5 | `POST /clis` (add CLI) | CLIs derive from compiled adapters — defer (dynamic registration feature). |
| 6 | Settings | **SERVED** (run_43). |
| 7 | `POST /runs {task?}` free-text ad-hoc | **SERVED** (run_54): `{task?}` threads into launch prompts (`54745f7`); bounded Oz `adhoc <task>` verb + describe-first UI (`721437d`). |
| 8 | Priority create + reorder | **Reorder SERVED** (run_54, `e4b1435` + `c1360a3`): the ADR-0010 order-only `cocoder/priorities/order.json` manifest is implemented daemon+UI end-to-end. **Create daemon-half SERVED** (run_55, `97e3283`): `POST /workspaces/:id/priorities` `{id?, title, goal?}` → governance `.md`, injection-hardened, no order.json write needed (read-side sort appends unlisted ids). **UI consumption SERVED** (run_56, `aee75c9`): Dashboard "Add priority" New-Priority modal + Craft-a-persona both file through the typed `electron/priorities-create.ts` seam (verbatim errors, no fake-create, place-at-top via the reorder seam). Surface closed end-to-end. |
| 9 | `POST /runs/:id/resolve` + "awaiting founder" list | **SERVED end-to-end** (run_54 `b1747cc` + run_55 `414633d`): run drawer Resolve actions consume the daemon endpoint (409s surfaced verbatim), and the Dashboard "Awaiting you" strip derives blocked/not-landed from existing run polling — renders only when non-empty, click opens the drawer. |

### Founder decisions + next-session pickup

**Fresh-session pickup (2026-06-09):** the orchestration repair around isolated worktrees is landed in
main: a verified-but-not-landed run now surfaces as `pending-landing` / **Not landed**, and Deb's
dogfood repair authority is no longer constrained by a hardcoded machinery path fence. The Oz-chat slice
is landed; do not rebuild it. **All three open founder questions are now LOCKED (run_46, see below)** —
no founder decisions are outstanding on this priority.

**ALL THREE LOCKED (founder, run_46, 2026-06-09):**

- **Q1 (Oz chat) — RESOLVED.** Bounded command interface landed (`0637c04`). The deeper "what IS Oz"
  question is now answered by a real ADR (see Q2-Oz), not deferred.
- **Q2 (multi-root workspaces) — NOT a decision; build-work.** The model was already fully ratified in
  [ADR-0019](../decisions/0019-multi-root-workspaces.md); the only gap is the daemon
  implementing it. Removed as a founder blocker. Owed slice #2 reclassified above.
- **Q2-Oz (what Oz IS) — DECIDED, new [ADR-0017](../decisions/0017-oz-orchestration-persona.md).**
  Oz = a CLI-backed persona run as a long-lived session, surfaced as the in-app chat window, with a
  **bounded tool surface** mapping to existing run-lifecycle ops. Dissolves the old "command interface
  vs in-daemon LLM" binary; the `run_46` `parseOzCommand` stub becomes Oz's action layer. **No custom
  in-daemon LLM.** TIER-3 preserved.
- **Q3 (priority ordering) — DECIDED, [ADR-0010 amendment](../decisions/0010-taxonomy-and-authoring.md).**
  No DB migration: priorities stay `.md` files; sequence is a git-tracked order-only
  `cocoder/priorities/order.json`; drag-reorder rewrites it. Owed slice #8 reclassified above.

**Recommended next slice (updated run_59 post-wrap — Objective APPROVED, ready to build):**
(a) **Oz as a persona**, per ADR-0017 **as amended 2026-06-12** (read the amendment first — it
records the founder's decisions from the run_59 wrap conversation: daemon-owned lifecycle-synced
hosting, the Refresh Oz action (idle-only v1), the extended verb surface incl. runner-mediated
nudge-to-Oscar and Oz-level repair, and the artifacts-first/Deb-for-interpretation info doctrine).
**Founder-approved Objective for this slice:** Oz becomes a real agent, not a parser — an `oz`
persona with a founder-chosen CLI+model, hosted BY THE DAEMON as a long-lived headless session
lifecycle-synced to the daemon (boot starts Oz; Refresh Oz restarts both: new session up → old
closed → priorities/run statuses re-derived from disk; v1 refuses while a run is in flight). The
dashboard chat becomes a window into that session; Oz acts only through his bounded tools (the
existing gated verbs + nudge/repair/refresh). **Verified when:** (1) a natural-language status
question gets a correct artifact-grounded chat answer; (2) launch/stop round-trip through tools,
not regex; (3) Refresh Oz performs the full cycle live with state correctly re-derived; (4) a
nudge reaches a live Oscar via the runner channel; (5) the security posture is untouched — every
Oz action is an already-gated daemon op. Build seams: the conflict scan (run_59 wrap) was clean;
the one flagged risk is that ADR-0006's adapter contract covers launch-and-run, not long-lived
conversational sessions — slice 1 may extend it deliberately (the run_59 headless-Oscar machinery
is most of the host). Suggested slice order: 1. oz persona definition + daemon session host +
chat wired to the real agent; 2. tools (existing verbs as the agent's tool calls); 3. Refresh Oz;
4. nudge + repair verbs. (b) **Bob session `mode` honoring** — gated on
a captured-subprocess monitor path for builder work (the run_28 hang class: the monitor's
readScreen/sentinel detection assumes a pane; a headless Bob needs incremental output capture the
current `runHeadless` final-only contract doesn't provide); (c) optional refinements: richer
Oz-chat streaming beyond coarse refetch hints, and Deb-nudge delivery for headless Oscars (folded
into the next one-shot turn). Worth a cheap live check when convenient: flip Oscar to `headless`
in the Personas screen and launch a small run — the honoring is unit/orchestration-test proven
but has not yet driven a live run. Zero-code founder follow-up still open from run_57: create
`local/workspace/cocoder.code-workspace` via the New-Workspace modal to migrate off the legacy
registry fallback.

> ⚠️ **run_45 incident — read before delegating.** Twice the builder rebuilt an entire, undelegated
> "Priority Architecture Contract" feature into `packages/core` (incl. a `MissingArchitectureContractError`
> launch-refusal gate) on top of the Oz-chat atom. Once it slipped into a commit (`ddd3f8d`) because the
> **commit gate enforces the run-level builder scope (`packages/**`), NOT the narrower per-directive
> `writeScope`** — narrowing a directive's scope does NOT contain out-of-scope work at commit time. Oscar
> reverted it (`4b7a4e6`); the branch is clean. **Lesson: at verify, always diff the WHOLE tree and FAIL
> any atom whose diff exceeds the delegated atom — do not rely on per-directive scope to hold it back.**
> The Architecture Contract idea is now its own future priority (Objective + ADR-conflict pass owed before
> any code); do not let a builder re-implement it inside another run.
