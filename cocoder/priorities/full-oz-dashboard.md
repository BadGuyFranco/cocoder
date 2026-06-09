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

**In progress — `continue`.** The v1 Electron dashboard is realized and **wired to every daemon
endpoint that exists**; surfaces without an endpoint stub cleanly and are tracked in
`packages/ui/ENDPOINTS_OWED.md` (live tracker). Slices 1–5 (adapter, polling, connection-states,
mutations, drag-reorder seam) plus CLI list/test consumption are **merged to trunk** (`feat/oz-dashboard`
was the merge-base). **Not archive-ready** — seven owed surfaces remain; two blocked on founder design
decisions (see below).

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
- **Verification (run_43):** daemon tests 50 · ui tests 42 · typecheck 0 · topology pass. Fresh
  worktree baseline needs `pnpm install` at root first (no `node_modules` ship in the worktree).

### Remaining — daemon endpoints owed (back half)

The renderer is wired; remaining work is **new daemon surfaces**, not adapter plumbing. Live tracker:
`packages/ui/ENDPOINTS_OWED.md`. Each owed item carries a design seam or consumption tail — not
mechanical infra (Settings was the last clean infra slice).

| # | Surface | Seam / blocker |
|---|---------|----------------|
| 1 | Oz chat — `POST /oz/messages` (+ SSE) | **Founder decision (Q1):** in-daemon LLM Oz agent (new ADR) vs bounded command interface (verbs → existing ops). Oscar recommends bounded interface next. |
| 2 | Workspaces CRUD + `roots[]`/role model | **Founder decision (Q2):** reconcile with ADR-0008 before building. |
| 3 | `POST /runs/:id/stop` | Investigate launcher/runner process ownership before scoping. |
| 4 | Persona `{mode, subAgents}` | Assignments map round-trips via existing PUT/GET, but runner does not honor `mode`/`subAgents` yet — honest scope = wire runner consumption or label "saved, not yet honored". |
| 5 | `POST /clis` (add CLI) | CLIs derive from compiled adapters — defer (dynamic registration feature). |
| 6 | Settings | **SERVED** (run_43). |
| 7 | `POST /runs {task?}` free-text ad-hoc | Bounded; threads task to builder. |
| 8 | Priority create + reorder | Source-of-truth migration (ordering off `backlog/` + PLAYBOOK into Oz/DB). |

### Founder judgment questions (start next session here)

**Fresh-session pickup (2026-06-09):** the orchestration repair around isolated worktrees is landed in
main: a verified-but-not-landed run now surfaces as `pending-landing` / **Not landed**, and Deb's
dogfood repair authority is no longer constrained by a hardcoded machinery path fence. Do not restart
that repair in the next Oz session. Start from the remaining Oz product slice below.

**Q1 (marquee):** Oz chat = in-daemon LLM agent (needs new ADR) vs bounded command interface
(shippable now within existing security posture)? Oscar recommends bounded interface; full agent deferred
to its own ADR.

**Q2:** Workspaces multi-root/role model — confirm model and ADR-0008 reconciliation before Workspaces
CRUD.

**Recommended next slice:** if Q1 → bounded command interface, build `POST /oz/messages` mapping a small
verb vocabulary to existing run-lifecycle ops (SSE/stream later). Else persona `{mode, subAgents}` with
runner consumption wired (#4). Avoid Workspaces CRUD until Q2 is settled.
