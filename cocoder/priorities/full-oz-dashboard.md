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
the PLAYBOOK roadmap) into Oz/DB; its **oversight/debugger** must be reconciled with [`deb`](./deb.md)
so we build one debugger, not two; and its oversight is **tier 3 of the observation hierarchy
(ADR-0013)** — Oz monitors Oscars across sessions and may observe (poll) Bobs/Debs, but never
orchestrates them — **reusing** the monitor primitive built by
[`oscar-orchestrates-bob`](./zArchive/v2/oscar-orchestrates-bob.md) (done + archived), not a second implementation. Slice sequencing
is decided when this is picked up, not here.

## Status

**In progress.** Built in worktree `.worktrees/oz-ui` on branch `feat/oz-dashboard`. The **UI is
realized against the v1 design and runs as a real Electron app — on fixtures.** The remaining work is
**wiring it to the live CoCoder daemon.**

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
- **Verification:** root typecheck 0 · topology 0 · ui typecheck 0 · 13 vitest tests · electron-vite
  build · **launch smoke** (cjs preload + watchdog) capturing real screenshots of every surface, with
  `elementFromPoint` paint-order assertions proving the modal + tab dropdown stack on top.

**Current limitation:** every surface renders from the **ported prototype seed** (`app/seed.json`) —
fully interactive *fixture parity*, **not yet connected to the live daemon at `127.0.0.1:7878`.** The
workspaces/runs/priorities/personas shown are demo data.

### Remaining — wire the renderer to the live daemon

The `electron/` plumbing (main + `preload.cjs` + `daemon-client.ts` + IPC contract + `OZ_FIXTURES`
replay) already exists and is auth-correct; the renderer consumes a single view-model (`app/model.ts`).
So this is a **`daemon → view-model` adapter**, not a rewrite.

1. **Adapter (`daemon → app/model.ts`).**
   - `GET /workspaces` → Workspace (daemon's is **thin**: id/name/path only — description/roots/role are
     owed; degrade gracefully).
   - `GET /workspaces/:id/priorities` → Priority[] (`title`→name, `goal`→summary).
   - `GET /runs?workspace=cocoder` + `GET /runs/:id` → Run/Run-detail. **Status mapping:** daemon
     `running|completed|pending-scope-decision|failed` → design `running|complete|blocked|failed|
     stopped`, treating **`pending-scope-decision` as the design's "blocked / needs-decision"** (it is
     exactly the decision-callout case). Build the **transcript** from `events[]` and **evidence** from
     `commitLinks` + `diffs` + `files.{record,pickup}` (never raw JSON). Run ids are **opaque** — never
     parse.
   - `GET /workspaces/:id/personas` → Persona[] **from the `assignments` map** (the `personas[]` array
     is empty in reality); render Oz separately.
2. **Polling (no SSE yet):** poll `GET /runs/:id` (~2.5s, pause when hidden) for the live transcript;
   thread the interval from Settings.
3. **Mutations via the main client (already auth-correct):** Launch = `POST /runs
   {workspaceId,priorityId}` with **202/409/400** as first-class UI states; ad-hoc = the existing
   `adhoc-session` priority; Attach = `POST /runs/:id/show` (enable only when `deepLinkable`; render 409
   honestly); Close = `POST /runs/:id/teardown`; Resume = `POST /runs {resumeFromRunId}`; persona edits
   = `PUT /workspaces/:id/personas/assignments` (**full-map replace**).
4. **Drag-reorder seam:** client-owned `order: string[]` via a main-process method now; swaps to the
   daemon endpoint with zero renderer change when it lands.
5. **Connection states:** real health/offline/connecting indicator off `GET /health`; stale-token
   (daemon restarted) retry; honest empty/error states when the daemon is down.
6. **Verify read-only:** re-capture fixtures with ws id `cocoder`; drive mutating surfaces from a mock
   client in tests + `OZ_FIXTURES` replay — **never `POST /runs` against the real daemon in CI** (it
   launches a real run).

### Endpoints owed by the daemon (surfaces that stay "pending endpoint" until added)

`POST /oz/messages` (+ `GET /oz/stream` SSE) for the Oz chat command interface · `GET /clis`,
`POST /clis/:id/test`, `POST /clis` · `POST /workspaces/:id/priorities/reorder` ·
`POST /workspaces/:id/priorities` (create) · `POST /workspaces`, `PUT/DELETE /workspaces/:id` + a
roots[]/role model · `GET/PUT /settings` · extend `POST /runs` with `{task?}` for ad-hoc free-text ·
extend persona assignment with `{mode, subAgents}` · `POST /runs/:id/stop`.
