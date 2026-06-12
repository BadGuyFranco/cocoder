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
run-mode editor persists for Oscar only). run_60 (2026-06-12) built the **core of Oz-as-persona
(ADR-0017 slice 1)** in four landed atoms: the `oz` base persona definition, a daemon-hosted Oz
agent turn host (free-text chat → one-shot captured-subprocess turns of the assigned oz CLI,
artifact-grounded facts digest, verb surface untouched), the bounded **tool loop** (`OZ_TOOL`
protocol — the agent speaks the gated verbs through ONE shared action layer, 3-round budget,
truthful errors), and the **`refresh` tool** (reuses the idle-guarded daemon restart;
short-circuits the loop on success). run_61 (2026-06-12) closed the **Oz `nudge` verb end-to-end**
in three atoms: the core runner's `oz-nudge.json` channel (reuses the Deb-nudge mechanics on EVERY
run's Oscar awaits — independent oz/deb seq dedupe, Oz outranks Deb on a same-sample tie,
source-attributed `oscar-nudge` events, delivery via `oscarDriver.nudge` so headless-Oscar
recorded-not-delivered semantics apply), the daemon's TOOL-ONLY `nudge` verb through the shared
action layer (parser + help frozen like `refresh`; honest 404/409/400s mirroring stop's liveness
checks; atomic restart-durable monotonic seq; truthful queued-not-delivered reply), and an
`ENDPOINTS_OWED.md` truth sweep. run_62 (2026-06-12) fixed BOTH founder-directed fresh-workspace
bugs found live onboarding CoPublisher (the first real non-dogfood workspace): the launch
stale-gate now compares the daemon's bootSha to the ENGINE repo HEAD (`ctx.cocoderHome`), not the
workspace's own HEAD — previously every non-dogfood launch was refused 425 in a futile
self-restart loop — and `POST /workspaces` now scaffolds the launch-required governance zone
(portable base `adhoc-session.md` template + seeded `assignments.json`, create-only-if-missing,
resolved-path, 400 existence gate on the primary root). POST-WRAP run_62 (2026-06-12, founder
live): the CoPublisher first launch (run_63) **WORKED end-to-end** — launched, built, wrapped,
and LANDED two commits on the CoPublisher trunk; the Bug-A fix is **live-proven**. But run_63
also exposed the THIRD dogfood-coincidence bug (failure-catalog F12): the runner anchors the
run worktree at `<workspace.path>/local/worktrees/<runId>` (`runner.ts` literally does
`const cocoderHome = workspace.path`), polluting the target repo — and the daemon's boot
orphan-sweep lists only the ENGINE repo's worktrees, so workspace-side worktrees would never be
swept. Founder then stated the **workspace-footprint contract**: CoCoder's ONLY entry into a
target repo is the `cocoder/` folder itself; `local/` exists ONLY in the CoCoder install (it
holds the install's non-git-tracked runtime state) and must NEVER be created inside a workspace;
each workspace's `cocoder/` zone should carry an `AGENTS.md` (repo instructions, blank at
scaffold) plus a `claude.md`/`CLAUDE.md` pointer to it; and CoCoder never writes a README into a
workspace. CoPublisher was then RESET entirely (founder decision): run_63 torn down via the
mechanism (3 panes closed; its worktree was GC'd from CoPublisher because gcWorktree uses the
stored absolute path), `copublisher.code-workspace` deregistered, founder deletes the repo's
folders — fresh-workspace onboarding will be re-run properly AFTER Oz completes, as its own
priority (see backlog/workspace-onboarding.md). Founder also flagged: the **Dashboard priorities
pane does not match the design spec** (`packages/ui/design-ref/`) — "the priorities pane in the
dashboard is all wrong"; an audit + rebuild against design-ref is owed. run_64 (2026-06-12)
closed all of the run_63 fallout: the worktree-placement fix (F12 instance 3) and the scaffold
AGENTS.md/CLAUDE.md additions are landed, the priorities-pane design-conformance AUDIT is
committed (`packages/ui/design-audit-priorities-pane.md` — 10 cited mismatches, 10 conformances,
a 6-atom rebuild split A–F), and rebuild Atom B (active-run semantics: `not-landed` rows render
inline, suppress Launch, stay visible in the ad-hoc row) is landed. run_65 (2026-06-12) closed
the REST of the rebuild — atoms A, C, D, E, F all landed (five atoms, every gate first-try),
so **the priorities-pane rebuild is COMPLETE**: handoff geometry matches the design grid, active
rows carry real enriched data (bounded renderer detail fetches — no daemon contract change),
first-run vs empty-queue is gated on the real configured signal, the polish items (chat
status chip, hover, borders, static not-landed bar) are in, and the lot is regression-pinned
(ui 108 tests). **Not archive-ready** — remaining: the Oz `repair` verb (a real design seam is
owed BEFORE build — see the next-slice note), a LIVE exercise of Oz with a real CLI assigned
(everything is injected-runner-proven only), Bob session `mode` honoring (gated on a
captured-subprocess monitor path for builder work), and a live (non-test) exercise of a
headless-Oscar run.

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
- **run_60 (2026-06-12), four landed atoms (one gate rejection + rebuild en route), all verified +
  committed on `cocoder/run_60` — Oz-as-persona (ADR-0017 slice 1), the agent core:**
  (0) `packages/personas/base/oz.md` (`d9aa34e`) — the oz base persona: tier-3 boundary (direct
  only Oscars via runner-mediated nudge; observe anyone; never write into Bob/Deb), bounded-tools
  doctrine, artifacts-for-facts/Deb-for-interpretation, repair fenced as future Oz-level-only
  authority, `writeScope: []`; passes the ADR-0012 portability test (product concepts only, no
  dogfood nouns); the existing loader/assignment machinery covers Oz with ZERO code change
  (proven by test). (1) daemon Oz turn host (`3d23d61`) — `packages/daemon/src/oz-host.ts`:
  free-text messages (anything `parseOzCommand` calls `unknown`) run a one-shot
  captured-subprocess turn of the assigned oz CLI via `ctx.getAdapter(...).build(...)` +
  `runHeadlessProcess` (the run_59 headless machinery), prompt = persona body + daemon-composed
  facts digest (priorities + runs) + capped in-memory transcript (drops on restart BY DESIGN —
  Refresh = fresh session) + turn instructions; per-workspace serialized turns (409 busy),
  truthful failure replies naming exit code + `local/oz/<ws>/turn-<n>.log`; typed verbs and
  no-oz-assigned behavior byte-identical (existing tests pass unmodified). (2) tool loop
  (`3c3de8c`) — the agent acts: output ending `OZ_TOOL {\"tool\":...,\"args\":{...}}` (strict JSON,
  last line, one per turn) executes launch/adhoc/show/stop/teardown/status through the SAME
  `executeOzCommand` action layer the parser uses (the ADR's 'parser becomes Oz's action layer',
  literally one code path), result feeds a follow-up turn, hard 3-round budget with truthful
  exceeded reply, malformed/unknown calls feed errors back without executing, GUI gets the same
  action metadata as typed verbs. ⚠️ First attempt REJECTED at the gate: the shared-executor
  refactor silently 400ed `status`/`status <runId>` without workspaceId (previously 200
  summaries) — caught by reading the diff against pre-atom behavior, NOT by the (green) suite;
  rebuild restored per-verb guards + 3 regression tests pinning no-workspace status. (3)
  `refresh` tool (`ef1ed14`) — Refresh Oz v1: reuses `requestDaemonRestart` (idle guard — 409
  while a run is in flight — audit, detached restart) as a TOOL-ONLY verb (parser + help text
  frozen); on success the loop SHORT-CIRCUITS (no follow-up turn racing the dying daemon) with a
  truthful restarting/fresh-session/transcript-resets reply; refused refresh feeds back to the
  agent to explain.
- **Verification (run_60):** core 220 · daemon 150 · ui 88 · root typecheck clean · topology pass
  (per-atom at the verify gate; whole-tree diff checked every atom).
- **run_61 (2026-06-12), three atoms, all verified + committed on `cocoder/run_61` — the Oz
  `nudge` verb end-to-end (ADR-0017 amendment):**
  (0) core runner oz-nudge channel (`ebc951b`) — the Oscar watchdog now also reads
  `<runDir>/oz-nudge.json` (same `NudgeRequest` shape + shared `parseNudgeRequest`; target locked
  to 'oscar' per ADR-0013) with an INDEPENDENT seq counter from Deb's; on a same-sample tie Oz
  outranks Deb and Deb's request stays pending (not consumed) for a later sample; `oscar-nudge`
  events gain `source: 'oz'|'deb'|'idle'` (the old `'deb-authored'` label renamed `'deb'` — zero
  consumers remained, verified by repo-wide grep); the watchdog now runs on EVERY run (previously
  Deb-backed runs only) so Oz can nudge a Deb-less run's Oscar — `readScreen` is stubbed and idle
  nudges stay gated off when no Deb is on the run, so no-Deb behavior is otherwise unchanged;
  delivery flows through `oscarDriver.nudge`, so headless-Oscar recorded-not-delivered semantics
  apply automatically. (1) daemon TOOL-ONLY `nudge` verb (`8013904`) — `requestNudgeRun` in
  `launcher.ts` mirrors stop's liveness honesty (404 unknown; 409 terminal or
  running-row-without-live-tracking, the daemon-restart orphan; 400 empty/over-4000-chars),
  writes the channel file atomically with a file-derived restart-durable monotonic seq, audits,
  emits a `nudge-queued` event, and replies truthfully "queued — the runner delivers at the next
  watchdog sample" (never "delivered"); the `OZ_TOOL` vocabulary gains
  `nudge {"runId","message"[,"rationale"]}` dispatched through the SAME `executeOzCommand` action
  layer; `parseOzCommand` + typed help are FROZEN byte-identical (run_60 `refresh` precedent),
  pinned by new regression tests (typed `nudge …` still parses as `unknown`). (2)
  `ENDPOINTS_OWED.md` row-1 truth sweep (`a6e528f`).
- **Verification (run_61):** core 224 · daemon 155 · ui 88 · root typecheck clean (per-atom at
  the verify gate; whole-tree diff checked every atom; all three atoms passed their gate first
  try).
- **run_62 (2026-06-12), two landed atoms (one gate rejection en route), all verified + committed
  on `cocoder/run_62` — both founder-directed fresh-workspace bugs (found live onboarding
  CoPublisher, the first real non-dogfood workspace):**
  (1) **Bug A, the launch stale-gate** (`099b453`) — `launchRun` compared the daemon's bootSha to
  the WORKSPACE repo's HEAD (`input.workspace.path`), correct only by dogfood coincidence
  (workspace path == install root); for any other workspace every launch was refused 425 stale
  and the idle self-restart looped futilely (observed live: bootSha `b97f186b` vs CoPublisher
  HEAD `25ab851e`). One-line fix: compare against the ENGINE repo (`ctx.cocoderHome`). Two
  regression tests pin it from both directions: an external workspace launches (202) when the
  daemon is current, and a genuinely stale daemon still 425s + self-restarts even when the
  workspace's HEAD equals bootSha (which the old code would have wrongly accepted).
  (2) **Bug B, workspace-create governance scaffold** (`d8eea96`) — `POST /workspaces` registered
  a workspace without the governance files the launch path hard-requires (first launch died on
  raw ENOENT for `cocoder/personas/assignments.json`; `cocoder/priorities/adhoc-session.md`
  equally required for adhoc). Create now scaffolds the minimal zone: the ad-hoc template ships
  PORTABLY in the install base (`packages/personas/base/priorities/adhoc-session.md`, new
  `basePrioritiesDir()` export; no dogfood nouns — regex-pinned in two suites) and
  `assignments.json` is seeded with the standard defaults (oscar=claude + the three Play
  overrides, bob=codex, deb=codex enabled — matches the dogfood and the founder's hand-scaffolded
  CoPublisher). Scaffold targets the validator-RESOLVED primary root (`${VAR}` expansion proven
  by test), behind a plain-English 400 existence gate BEFORE any write (no blind mkdir of a
  typo'd path), create-only-if-missing (`wx`; pre-existing files byte-preserved by test), with
  gate→scaffold→register ordering so a failure never registers a half-usable workspace.
  `loadAssignments` stays STRICT — the scaffold self-checks its output with the same loaders
  launch uses, so an invalid pre-existing zone surfaces at create time. The legacy-migration
  create path gets the same scaffold as a safe no-op on already-scaffolded repos.
  ⚠️ The first Bug-A atom was REJECTED at the gate as a run_45-class scope blowout: the builder
  also implemented an undelegated Bug-B scaffold (with the dogfood noun 'CoBuilder' baked into
  the product template + an unconditional mkdir-recursive on the primary root). The whole-tree
  diff check caught it; Bug A was re-delegated alone, then Bug B with the corrected design.
- **run_64 (2026-06-12), four atoms, all verified + committed on `cocoder/run_64` — the run_63
  fallout closed + the priorities-pane audit and its first rebuild atom:**
  (0) **Worktree placement, F12 instance 3** (`19d55ea`) — `RunInput` gains an explicit
  `engineHome` (the daemon always passes `ctx.cocoderHome`; direct callers default to the
  historical dogfood shape with a documented rationale); the worktree DIRECTORY now lives at
  `<engineHome>/local/worktrees/<runId>` for EVERY workspace while every git op that targets the
  workspace's repo (branch cut at trunk tip, land/ff-merge, misrouting guard) stays anchored at
  `workspace.path` — the conflation variable was renamed `workspaceRepo`; daemon `gcWorktree`
  removes through the OWNING workspace repo (resolved from the run's workspaceId; safe recorded
  fallback if unresolvable) and `sweepOrphanWorktrees` now ALSO reconciles from the run table's
  stored `worktreePath`s, so non-engine worktrees are no longer invisible to the boot sweep.
  Four regression tests pin: worktree-under-engine with NOTHING created under
  `<workspace>/local/**`, dogfood path-identity when the two homes coincide, gc of a
  workspace-owned worktree, sweep of a non-engine orphan.
  (1) **Scaffold additions** (`47e1d2a`) — `scaffoldWorkspaceGovernance` also writes a BLANK
  `cocoder/AGENTS.md` + a portable `cocoder/CLAUDE.md` pointer to it (create-only-if-missing via
  the existing `wx` helper; one shared scaffold site so the legacy-migration path inherits it);
  tests pin pointer content (regex: no dogfood nouns), byte-preservation of pre-existing files,
  NO README ever written into a workspace, and no leakage into priorities/personas listings.
  (2) **Priorities-pane design-conformance audit** (`daf9763`) — a no-code atom; the single new
  file `packages/ui/design-audit-priorities-pane.md` holds 10 dual-cited mismatches (design-ref
  line vs app line, major/minor), 10 conformances (the drawer IS in place; row anatomy +
  drag-reorder largely faithful — the founder's "all wrong" is mostly DATA SEMANTICS), and a
  6-atom rebuild split A–F with per-atom exit criteria. Headline mismatches: `not-landed` runs
  lose their inline summary and show a misleading Launch button; not-landed ad-hoc runs VANISH
  from the pinned row; active rows render empty personas/no progress until selected (the list
  endpoint doesn't carry those fields — detail fetch only); first-run hijacks the designed
  "Nothing queued" empty state; the post-design resize handle interrupts the gold-notch handoff.
  (3) **Rebuild Atom B — active-run semantics** (`20ec2aa`) — one shared `isActiveRun` helper
  (`running|blocked|not-landed`): a not-landed priority row renders the inline run summary,
  selects/opens the drawer, and SUPPRESSES Launch; not-landed ad-hoc runs stay in the pinned
  row's sub-list; blocked keeps its distinct warning treatment; 4 new renderer tests. Noted for
  Atom E polish: a not-landed row currently inherits the pulsing "live" accent bar — worth a
  static-vs-pulse distinction when polish is tuned.
- **run_65 (2026-06-12), five atoms, all verified + committed on `cocoder/run_65` — the
  priorities-pane rebuild COMPLETED (audit atoms A, C, D, E, F):**
  (0) **Atom A — handoff geometry** (`29e5e6c`) — the selected-run grid is now
  `prioWidth 460px 6px 1fr` (design: drawer immediately after priorities, the design's own 16px
  gap carrying the gold notch); the resize handle moved to the drawer/chat far edge; resize
  stays correct because the handle is delta-based, not position-based.
  (1) **Atom C — real inline-summary data for active rows** (`11f9632`) — DESIGN DECISION
  (taken at scope time, recorded here): bounded per-active-run `GET /runs/:id` fetches in the
  RENDERER, no daemon/wire change — `adaptRunDetail` stays the single enrichment owner.
  `enrichActiveRunDetails` caps at 6 fetches/cycle preferring running/blocked, fetches
  not-landed detail ONCE (status-change invalidates), skips the selected run (already polled)
  and `document.hidden`; `mergeRunsWithEnrichment` fixes a real clobber bug where
  `refreshWorkspace` wiped enriched rows back to bare summaries on every refresh; `isActiveRun`
  consolidated into `adapter.ts`. Fixtures mode performs zero detail fetches (pinned by test).
  (2) **Atom D — first-run vs empty configured queue** (`7e73cbe`) — renderer-only after
  reading the daemon: `GET /workspaces/:id/personas` already 200s with an EMPTY assignments map
  for an unscaffolded zone vs a seeded map for any created workspace, so `loadWsData` derives
  `configured` from it; a FAILED personas fetch counts as configured (a network blip can never
  show the setup ladder); live mode shows `FirstRun` only on explicit `configured === false`
  with empty data, so a configured workspace with zero priorities finally reaches the designed
  "Nothing queued" empty state; fixtures keep the old heuristic byte-identically.
  (3) **Atom E — polish pass** (`74e8d83`) — chat run cards gain the design's `StatusChip`;
  selected priority/ad-hoc rows match the reference borderRight accent treatment; ad-hoc
  sub-run hover restored verbatim from design-ref; not-landed accent bars are now STATIC while
  running keeps the pulse (the run_64 note, closed) — blocked's warning treatment untouched.
  (4) **Atom F — regression gap-fill, tests only** (`d4b007f`) — handoff geometry pinned in
  both states (selected + unselected grid/DOM order), ad-hoc multi-run concurrent visibility
  with per-run selectability, drag→drop reorder indices at the panel level. Coverage from
  atoms B–E (14 tests) was already in place; F added only the genuine gaps.
- **Verification (run_65):** ui 108 · root typecheck clean (per-atom at the verify gate;
  whole-tree diff checked every atom; all five atoms passed their gate first try).
- **Verification (run_64):** core 226 · daemon 164 · ui 92 · root typecheck clean · topology pass
  (per-atom at the verify gate; whole-tree diff checked every atom; all four atoms passed their
  gate first try).
- **Verification (run_62):** core 224 · daemon 162 · personas 9 · root typecheck clean · topology
  pass (per-atom at the verify gate; whole-tree diff checked every atom).
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
| 1 | Oz chat — `POST /oz/messages` | **SERVED** (run_46, `0637c04`): bounded command interface — verbs `launch <priorityId>` / `show <runId>` / `stop`+`teardown <runId>` / `status [runId]` / `help` parsed in `packages/daemon/src/oz-chat.ts` and dispatched to existing launcher ops; **no in-daemon LLM**, rides the existing Bearer/CSRF/loopback posture. **SSE SERVED** (run_59, `da24ba8` + `2b9c29d`): Bearer-gated `GET /oz/events` streams coarse refetch hints from a typed `OzEventBus`; the UI main process consumes it (tokens never cross the bridge) and debounces hints into the same refresh paths polling uses — polling stays the fallback. Anything richer than coarse hints (e.g. streamed transcripts) is a future refinement, not owed. **AGENT SERVED** (run_60, `3d23d61` + `3c3de8c` + `ef1ed14`): free-text messages run a real one-shot turn of the assigned `oz` persona (ADR-0017) with a bounded `OZ_TOOL` tool loop over the same gated action layer (+ `refresh`); typed verbs byte-identical; not yet exercised live. **NUDGE SERVED** (run_61, `ebc951b` + `8013904`): tool-only `nudge` writes the runner-owned `<runDir>/oz-nudge.json` channel; the runner delivers to Oscar at the watchdog (independent oz/deb seqs, source-attributed events, rate-limited, headless-safe). Only `repair` remains owed — its design seam (Oz-level repairs commit OUTSIDE any run branch) is owed before build. |
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

**Recommended next slice (updated run_65 wrap):**
~~The priorities-pane rebuild~~ **COMPLETE (run_65, 2026-06-12): audit atoms A, C, D, E, F all
landed (Atom B landed run_64) — the Dashboard priorities pane now conforms to design-ref.**
What remains on this priority is exactly the four items in the Status remaining list, in this
suggested order: (a) **the Oz `repair` verb design seam** — surface the founder judgment call
(may an Oz repair commit land on trunk without a run's verify gate, and under what scope?)
BEFORE delegating any build; the sketch to evaluate is recorded below under the pre-run_64
context. (b) **The LIVE proof session** (zero code owed): assign oz a real CLI+model in the
Personas screen, ask a status question in the dashboard chat, drive a launch/stop through
chat, nudge a live run's Oscar, run one real Refresh Oz — Oz-as-persona criteria 1–4 flip to
met on that evidence; while at it, eyeball the rebuilt priorities pane against design-ref live
(a code-conformance rebuild is landed; a founder look is the real acceptance). (c) **Bob
session `mode` honoring** — still gated on a captured-subprocess monitor path for builder work
(the run_28 hang class). (d) A live (non-test) **headless-Oscar run** (cheap: flip Oscar to
headless in Personas, launch a small run). The pre-run_64 text below is kept for context:
~~(0) the CoPublisher live retry~~ **DONE LIVE (run_63, 2026-06-12): launched, built, landed on
the CoPublisher trunk — Bug-A acceptance met.** CoPublisher has since been reset entirely
(founder decision); onboarding re-runs properly as its own future priority after Oz completes.
**Founder-set ordering (2026-06-12, post-run_62): COMPLETE OZ FIRST, then build the
fresh-workspace onboarding process as its own priority (`backlog/workspace-onboarding.md`).**
(0) **NEXT BUILD ATOMS — the run_63 fallout (do these before other slices):**
(0a) **Worktree placement (F12 instance 3):** run worktree DIRECTORIES must live under the
ENGINE install's `local/worktrees/` for EVERY workspace — the git worktree still belongs to the
workspace's repo; only the directory moves. Root cause: `packages/core/src/runner/runner.ts`
does `const cocoderHome = workspace.path` and anchors `worktreePathFor` there; thread the
engine home (vs the workspace repo) EXPLICITLY through worktree create + gcWorktree + the boot
orphan-sweep (`sweepOrphanWorktrees` lists only `ctx.cocoderHome`'s worktrees today, so
workspace-side worktrees are invisible to it — after the move, also make the sweep reconcile
from the run table's stored `worktreePath`s, not just the engine repo's worktree list). The
workspace-footprint contract this enforces: **CoCoder's ONLY entry into a target repo is
`cocoder/`; `local/` exists ONLY in the install.**
(0b) **Scaffold additions:** the run_62 workspace-create scaffold also writes a blank
`cocoder/AGENTS.md` (repo instructions) and a `CLAUDE.md` pointer file to it (founder asked for
"claude.md" — use the CLAUDE.md casing the claude CLI reads unless the founder objects);
create-only-if-missing like the rest. CoCoder never writes a README into a workspace.
(0c) **Dashboard priorities pane — design-conformance audit + rebuild.** Founder (2026-06-12):
"the priorities list is not modeled against the design spec; the priorities pane in the
dashboard is all wrong." Audit the current Dashboard priorities pane against
`packages/ui/design-ref/` (the authoritative spec: drag-reorderable queue where top = next up, a
running priority expands an inline run summary, run-detail drawer opens IN PLACE between queue
and Oz chat with the gold-notch handoff, ad-hoc as a pinned row holding many concurrent runs)
and write up the concrete mismatches BEFORE delegating rebuild atoms — the audit decides the
atom split.
(a) **The Oz `repair` verb — DESIGN FIRST, do not delegate a build yet.** Scoring the approved
Oz-as-persona Objective's five criteria after run_61: (1) natural-language artifact-grounded
answers — BUILT, injected-runner-proven, NOT yet exercised live; (2) launch/stop through tools
not regex — BUILT + proven at unit level; (3) Refresh Oz full cycle live — tool BUILT, live
cycle NOT yet performed; (4) nudge to a live Oscar — **BUILT end-to-end (run_61)**, live delivery
not yet observed; (5) security posture untouched — HOLDS (every tool is an already-gated op;
zero new endpoints). `repair` is the last unbuilt verb and it carries a genuine design seam the
Deb precedent does not answer: Deb's ADR-0016 repairs are gate-committed onto the RUN's branch by
the runner, but Oz operates OUTSIDE any run — an Oz repair would have to commit to the trunk
checkout directly (no run branch, no verified auto-merge), which is NEW commit authority for an
agent. Sketch to evaluate (not decided): idle-only like `refresh`; a one-shot headless repair
turn over the trunk checkout; the daemon diffs the whole tree afterward, gate-commits only
in-scope changes as an `oz-repair` commit (reusing core's deb-repair scope-split helpers), holds
back everything else; scope = governance docs + Oz's own operation, with machinery-code repairs
the contentious case. **The judgment call for the founder: may an Oz repair commit land on trunk
without a run's verify gate, and if so under what scope?** Surface this question before
delegating any repair atom. (b) **LIVE proof session** (no code owed): assign oz a real
CLI+model in the Personas screen, ask a status question in the dashboard chat, drive a
launch/stop through chat, nudge a live run's Oscar, and run one real Refresh Oz — criteria 1–4
flip to met on that evidence. NOTE: turn logs land in `local/oz/<workspaceId>/turn-<n>.log`; the
oz turn subprocess is NOT tool-restricted in this build (prompt-level discipline only — the
assigned CLI could in principle touch files; acceptable v1 seam, recorded here deliberately) —
prefer a CLI/flags combo with read-only behavior until tool-restriction lands in the adapter
contract. (c) **Bob session `mode` honoring** — gated on
a captured-subprocess monitor path for builder work (the run_28 hang class: the monitor's
readScreen/sentinel detection assumes a pane; a headless Bob needs incremental output capture the
current `runHeadless` final-only contract doesn't provide); (d) optional refinements: richer
Oz-chat streaming beyond coarse refetch hints, and Deb-nudge delivery for headless Oscars (folded
into the next one-shot turn). Worth a cheap live check when convenient: flip Oscar to `headless`
in the Personas screen and launch a small run — the honoring is unit/orchestration-test proven
but has not yet driven a live run. ~~Zero-code founder follow-up from run_57~~ DONE
(2026-06-12): `local/workspace/cocoder.code-workspace` exists — the dogfood is off the legacy
registry fallback. AFTER OZ COMPLETES: pick up `backlog/workspace-onboarding.md` (founder-set
sequencing) — the two onboarding flows (brand-new primary root; existing-code primary root with
a full repo audit/review + ingestion into the `cocoder/` zone).

> ⚠️ **run_45 incident — read before delegating.** Twice the builder rebuilt an entire, undelegated
> "Priority Architecture Contract" feature into `packages/core` (incl. a `MissingArchitectureContractError`
> launch-refusal gate) on top of the Oz-chat atom. Once it slipped into a commit (`ddd3f8d`) because the
> **commit gate enforces the run-level builder scope (`packages/**`), NOT the narrower per-directive
> `writeScope`** — narrowing a directive's scope does NOT contain out-of-scope work at commit time. Oscar
> reverted it (`4b7a4e6`); the branch is clean. **Lesson: at verify, always diff the WHOLE tree and FAIL
> any atom whose diff exceeds the delegated atom — do not rely on per-directive scope to hold it back.**
> The Architecture Contract idea is now its own future priority (Objective + ADR-conflict pass owed before
> any code); do not let a builder re-implement it inside another run.
