# Oz Dashboard — Build Prompt (review-hardened)

> Paste the block below into a fresh Claude Code session. It realizes the **delivered v1 Oz
> design** (`docs/oz-design-brief.md`) as an Electron desktop app, built in earned slices against
> the live daemon. It encodes the findings of a 4-lens adversarial review (design-fidelity,
> daemon-reality, ADR/compliance, Electron-engineering).

---

You are an autonomous Claude Code session and you ARE the developer. Build the **Oz dashboard — the
already-designed v1 control plane** — as an **Electron desktop app**, realizing the delivered design
spec, wired to the running CoCoder daemon. Work end-to-end, verify on evidence (launch it / screenshot
it / fixture-replay), commit in slices. This is a BUILD session.

THIS IS NOT A GREENFIELD DESIGN. The UI is already designed in `docs/oz-design-brief.md` (the verbatim
claude.ai/design brief). Your job is to REALIZE it faithfully, not re-invent it. It is an **operator
cockpit, explicitly NOT an IDE and NOT a terminal** — the real terminal/editor is **cmux**, which Oz
**deep-links into**. Do not build an editor, file tree, or embedded terminal.

═══════════════════════════════════════════════════════════════════════════
ISOLATION — read first (a live run holds the main tree; getting this wrong destroys its work)
═══════════════════════════════════════════════════════════════════════════
A CoCoder run (workspace `cocoder`) is ALREADY RUNNING in this repo's MAIN working tree, driven by a
live Oz daemon. `packages/ui` is in that run's builder write-scope (`packages/**`), so editing it in
the main checkout risks the commit-gate sweeping your files in, or a verify-fail git-cleaning them.
Work ONLY in the pre-made worktree:

    REPO ROOT: /Volumes/NAS LOCAL/CoCoder
    WORKTREE:  /Volumes/NAS LOCAL/CoCoder/.worktrees/oz-ui   (branch feat/oz-dashboard)

  - First: `cd "/Volumes/NAS LOCAL/CoCoder/.worktrees/oz-ui" && git branch --show-current` → expect
    feat/oz-dashboard. If missing: `git -C "/Volumes/NAS LOCAL/CoCoder" worktree add .worktrees/oz-ui -b feat/oz-dashboard`.
  - `.worktrees/` is already ignored via `.git/info/exclude` (local-only; do NOT edit the tracked
    .gitignore). The worktree is out-of-scope of `packages/**`, verified safe from the run's gate.
  - NEVER: `scripts/oz.sh restart|stop`, `cocoder run`, `oz teardown`, or any touch of the live daemon
    or its run. The daemon (127.0.0.1:7878) is your READ-ONLY backend.
  - NEVER launch a CoCoder run inside the worktree; never broaden any run's write-scope to repo-root /
    `**` / anything matching `.worktrees/`.
  - Edit ONLY `packages/ui`. Do NOT edit packages/core, packages/daemon, cocoder/, or repo-root files
    (root tsconfig/.gitignore). SANCTIONED EXCEPTION (founder-approved): you MAY add `"pnpm":
    {"onlyBuiltDependencies": ["electron"]}` to the ROOT package.json — this is the clean, reproducible
    way to let electron's binary install (see Engineering). Make ONLY that minimal addition; it rides the
    feat/oz-dashboard branch in the worktree (isolated from the live run's main tree) like any other change.
  - If a surface needs a NEW daemon endpoint, do NOT add it — build against existing endpoints, stub the
    rest, and record it in the "ENDPOINTS OWED" list.

═══════════════════════════════════════════════════════════════════════════
ORIENTATION (AGENTS.md convention — read before building)
═══════════════════════════════════════════════════════════════════════════
  - `docs/oz-design-brief.md` — THE authoritative design (5-section nav; Oz chat central; Runs+Priorities
    are Dashboard PANELS, not pages; never show raw JSON; non-goals: not a terminal, not an IDE).
  - `cocoder/decisions/0008-oz-control-plane-architecture.md` — v1 architecture ADR.
  - `cocoder/priorities/full-oz-dashboard.md` — the priority you're realizing + its 3 reconciliations.
  - `cocoder/priorities/zArchive/v0.4-oz-control-plane/README.md` — the archived v1 priority.
  - `cocoder/decisions/0013-orchestration-observation.md` — Oz oversight is TIER 3 (observe,
    NEVER orchestrate; reuse the monitor primitive). `cocoder/priorities/deb.md` — Deb WRITES faults,
    Oz READS them (ONE debugger, not two).
  - `cocoder/decisions/0002-substrate-oz-and-cmux.md` — cmux is the terminal host; deep-link,
    don't embed/fork (AGPL arm's-length). `0008-repository-topology.md` + `scripts/check-topology.mjs`.
  - `packages/ui/public/{index.html,app.js,style.css}` — today's thin static dashboard. REUSE as the
    reference for what each surface shows; KEEP these files (the daemon serves them statically).
  - `packages/daemon/src/{server.ts,security.ts,routes.ts}` + `tests/security.test.ts` — the EXACT
    Host/Origin/Bearer/CSRF gate you must satisfy.

═══════════════════════════════════════════════════════════════════════════
THE PRODUCT SHAPE — 5-section IA (authoritative; do NOT ship standalone Runs/Priorities pages)
═══════════════════════════════════════════════════════════════════════════
Persistent left nav, EXACTLY these five, in order:
  1. Dashboard  — workspace picker · Oz chat (THE command center) · Priorities panel · Runs panel +
                  in-place run-detail drawer. Runs and Priorities live HERE, never as top-level pages.
  2. Workspaces — list (+ later create/edit); each root has Name/Path/Role (primary | writable |
                  read-only; exactly one primary).
  3. CLIs       — list w/ install+auth status · add form · per-CLI Test button (success or exact error).
  4. Personas   — list incl. Oz · CLI+Model linked dropdowns ("Default" = empty model) · sub-agent
                  hierarchy · visible/headless mode · "create a persona via a priority".
  5. Settings   — human-friendly forms only; intentionally minimal/extensible.
Invariants at EVERY shippable step: no standalone Runs/Priorities page; Oz chat is primary; NEVER render
raw JSON (events → timeline, work-items/records → formatted cards/tables); GUI⇄Oz parity (anything a
button does, Oz chat can do); deep-link to cmux for live panes (never embed a terminal).

═══════════════════════════════════════════════════════════════════════════
DAEMON BACKEND (http://127.0.0.1:7878, loopback) — GROUND TRUTH from the live daemon
═══════════════════════════════════════════════════════════════════════════
Workspace id is `cocoder`. Auth: `GET /auth/session` → {bearerToken, csrfToken} (open). Send
`Authorization: Bearer <token>` on every request; add header `x-oz-csrf-token: <csrf>` on every mutation.
EXISTING endpoints (build real against these):
  GET  /health → {ok, sha}                                   (open)
  GET  /auth/session → {bearerToken, csrfToken}              (open)
  GET  /workspaces → {workspaces:[{id,name,path}]}           (NOTE: thin — no description/roots/role)
  GET  /workspaces/:id/priorities → {workspace, priorities:[{id,title,scopeNarrowing,goal}]}
  GET  /workspaces/:id/personas → {workspace, personas:[{id,label,role,writeScope,cli,model}], assignments}
  PUT  /workspaces/:id/personas/assignments  (body = FULL assignments map {id:{cli,model,enabled?}} — a
       full replace, NOT a patch; send the whole map or you drop personas)
  GET  /runs?workspace=cocoder → {runs:[{id,workspaceId,priorityId,status,createdAt,endedAt}]} newest-first
  GET  /runs/:id → {run, sessions:[{persona,sessionRef,deepLinkable,exitCode,...}], workItems[],
       commitLinks[], events:[{type,data,at}], files:{oscarOut,oscarErr,bobOut,bobErr,pickup,record},
       diffs:[{sha,diff}]}
  POST /runs {workspaceId, priorityId, resumeFromRunId?} → 202 {runId} · 409 in-flight · 400 bad
  POST /runs/:id/show → {shown,sessionRef} · 409 not live · 404   (focus the cmux pane = "Attach")
  POST /runs/:id/teardown → {closed:[...]} · 404                  (close the run's panes; NOT a kill)
REALITY (wire to these, not assumptions): run.id is an OPAQUE string (mixed run_17 / hex — never parse).
status ∈ {running, completed, pending-scope-decision, failed} (no blocked/stopped). Ad-hoc run = launch
the existing `adhoc-session` priority (no free-text task field yet). Transcript is POLLED (no SSE/WS);
poll GET /runs/:id (the current app polls ~2.5s, pause when hidden). Oz is NOT in the personas response.
events[] types seen: run-start, preflight, spawn, delegation, builder-dispatch, monitor-assessment,
builder-done, verify-dispatch, verify-pass, commit, out-of-scope, daemon-stale, wrapup, run-end,
teardown, orphaned, run-error.

VERIFY SAFELY: only read-only/idempotent calls against the live daemon. Do NOT `POST /runs` (launches a
real run) and do NOT teardown another run. Re-capture fixtures with workspace id `cocoder` into
packages/ui/fixtures/, and drive mutating surfaces from a mock client in tests + a fixture-replay mode.

═══════════════════════════════════════════════════════════════════════════
BUILD ORDER — earned slices, each built AND verified before the next (D6)
═══════════════════════════════════════════════════════════════════════════
Each slice ships behind the existing loopback/token/Origin/CSRF posture and is operated end-to-end from
the dashboard before the next starts. The 5-section IA is the shape; this is the order to reach it
faithfully (never shipping a forbidden standalone page):

  0. SHELL: Electron app (main + preload + renderer) + the persistent 5-section nav with empty/loading
     states + typed daemon client (in MAIN) + /auth/session handshake + health/connection indicator +
     Workspaces list (read) + workspace picker. Fixture-replay mode (OZ_FIXTURES=1).  [all wired]
  1. DASHBOARD + thin Oz chat: stand up the Dashboard built AROUND a chat panel (the command center).
     If no chat endpoint exists (it doesn't), ship a thin chat shell wired to a stubbed main-process
     `chat:send` (fixture/echo) with GUI⇄Oz parity as the design goal. Do NOT leave the center empty.
  2. PRIORITIES panel (inside Dashboard): read + Launch (POST /runs; handle 202/409/400 as first-class
     UI states) + ad-hoc "run without a priority" wired to the `adhoc-session` priority.  [wired]
  3. RUNS panel + in-place run-detail DRAWER (inside Dashboard): list w/ status chips; the events[]
     TIMELINE as the read-only transcript; files.record/pickup, commitLinks + diffs as human-friendly
     evidence (NO raw JSON); Attach = POST /runs/:id/show (enable only when a session is deepLinkable;
     render 409 honestly); Close = POST /runs/:id/teardown; Resume = POST /runs {resumeFromRunId}.  [wired]
  4. DRAG-REORDER priorities: client-owned `order: string[]`, persisted via a main-process
     `priorities:reorder` IPC method (local store now). NO daemon endpoint yet — keep the seam at the
     main client method so it later swaps to the DB endpoint with zero renderer change. Note it OWED.
  5. PERSONAS section (this is the brief's "Personas", NOT "Settings"): read + edit CLI+Model linked
     dropdowns + assignments via PUT (full-map replace). Render Oz in the list. Show sub-agent hierarchy
     + visible/headless toggle as DISABLED "coming soon" (no model backing). [assignments wired; rest stub]
  6. OVERSIGHT / DEBUGGER (inside Runs panel): a read-only PROJECTION of Deb's outputs + run events
     (out-of-scope, monitor-assessment, daemon-stale, fault/triage/disposition). TIER-3: render only;
     NEVER call sendInput/orchestrate; do NOT re-implement triage. One debugger — Deb writes, Oz reads.
  7. STUB SECTIONS for full IA fidelity: CLIs (list/Test disabled "coming soon"), Workspaces roots/roles
     editor (disabled), real Settings (client-only/local prefs). Each clearly marked "pending endpoint".

═══════════════════════════════════════════════════════════════════════════
HARD CONSTRAINTS (the build cannot drift past these)
═══════════════════════════════════════════════════════════════════════════
  1. TIER-3 READ-ONLY: oversight calls only read/observe endpoints + the existing show/teardown for runs
     this daemon owns. NEVER sendInput / directive / any write against an agent. No "nudge from dashboard".
  2. ONE DEBUGGER: render Deb's existing events/faults/dispositions; do not build/duplicate triage logic.
  3. TOPOLOGY: packages/ui/src/** imports only `@cocoder/core` + node/electron/third-party. NEVER import
     `@cocoder/daemon`/`adapters`/`session-hosts`. Shared client/contract types go in `@cocoder/core` (or
     local to ui). `node scripts/check-topology.mjs` AND root `tsc -p tsconfig.json` must stay green.
  4. CMUX ARM'S-LENGTH: live panes only via POST /runs/:id/show. No embedded terminal (no xterm/node-pty),
     no cmux source vendored/forked. Render the 409 (not-live) honestly.
  5. SECURITY VIA MAIN: all daemon HTTP from the Electron MAIN process; renderer↔main over a narrow typed
     IPC (contextIsolation:true, sandbox:true, nodeIntegration:false). Bearer + x-oz-csrf-token live ONLY
     in main, never in the renderer, never logged. Send `Host: 127.0.0.1`; send NO `Origin` header
     (checkOrigin allows absent-Origin — verified; adding a non-loopback Origin self-403s). Echo CSRF on
     every mutation. Do NOT add a CORS/Origin allow-list to make a renderer-direct fetch work.
  6. NEVER RAW JSON: every surface is forms/tables/status-chips/timelines. (Today's run view violates this
     — fix it.)
  7. ISOLATION: build only in .worktrees/oz-ui on feat/oz-dashboard. Keep packages/ui/public/* intact.

═══════════════════════════════════════════════════════════════════════════
ENGINEERING (so it compiles, launches, and keeps the monorepo green)
═══════════════════════════════════════════════════════════════════════════
  - LAYOUT: keep ALL DOM/React/Electron code OUT of packages/ui/src (the root typecheck globs
    packages/*/src/**/*.ts with types:["node"] — DOM/JSX there goes red). Put renderer in
    packages/ui/app/ (*.tsx) and main+preload in packages/ui/electron/. packages/ui/src/index.ts stays
    Node-compilable (its only consumer is the root typecheck). Give the app its own tsconfig.app.json:
    extends tsconfig.base.json but OVERRIDE moduleResolution:"Bundler", module:"ESNext",
    lib:["ES2022","DOM","DOM.Iterable"], jsx:"react-jsx", types:["node","electron"], include
    ["app","electron"]. Leave packages/ui/tsconfig.json as-is (include ["src","tests"], types ["node"]).
    Add a ui `typecheck` script running BOTH tsconfigs, and a `test` script (`vitest run`, not watch).
    Add `out/` `.vite/` to .gitignore (worktree-local). Stack: electron-vite + React + TS.
  - ELECTRON BINARY: pnpm 10 ignores build scripts, so electron's postinstall (the ~100MB binary
    download from github) is skipped → a non-launching electron. Fix (founder-sanctioned): add `"pnpm":
    {"onlyBuiltDependencies":["electron"]}` to ROOT package.json, then `pnpm install`. If the binary still
    isn't present, run `node packages/ui/node_modules/electron/install.js`. Fallback if github egress is
    blocked: seed ELECTRON_CACHE / set ELECTRON_MIRROR; if no binary at all, do NOT block — gate on the
    headless evidence ladder.
  - DEPS in packages/ui/package.json: react, react-dom (deps); electron, electron-vite, vite,
    @types/react, @types/react-dom (devDeps). Keep @cocoder/core as the ONLY workspace dep.
  - IPC: one shared ipc-contract.ts (channel names + payload types) imported by main, preload, renderer
    so a renamed channel is a compile error. Only plain JSON across the bridge. Tokens stay in main; the
    renderer calls e.g. invoke('daemon:get', path) and main attaches auth.
  - VERIFY (no human, daemon may be busy): (a) both typechecks green; (b) `electron-vite build` succeeds;
    (c) vitest + jsdom component tests render each surface against packages/ui/fixtures/*.json via a MOCK
    client; (d) main-process tests assert the client sends Bearer + x-oz-csrf-token and NO Origin against
    a stub http server; (e) when the binary is present, an electron smoke test (app ready, window created,
    IPC health round-trips) + win.webContents.capturePage() screenshots per surface in fixture-replay
    mode. Attach typecheck logs, build log, vitest counts, and screenshots per slice.

═══════════════════════════════════════════════════════════════════════════
HOUSE RULES · DONE · ENDPOINTS OWED
═══════════════════════════════════════════════════════════════════════════
  - Terse house style; small files, one concept each; TypeScript; typed unit-testable daemon client.
  - Commit each slice on feat/oz-dashboard with clear messages ending:
      Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
    Do NOT push. Do NOT merge to any other branch.
  - Founder comms: plain English, decision-first; surface only genuine judgment calls.
  - DONE when: the app builds + launches (or passes the full headless evidence ladder if no binary);
    connects via the auth handshake; the wired surfaces operate end-to-end (workspace pick · launch ·
    runs list/detail/attach/teardown/resume · personas read+assign); the stub surfaces render with clear
    "pending endpoint" markers; root typecheck + topology + tests are green; and you deliver the written
    ENDPOINTS OWED list below, filled in.

  ENDPOINTS OWED (deliverable — the daemon session must add these for the deferred bits):
    POST /oz/messages (+ GET /oz/stream SSE)         — Oz chat command interface (the centerpiece)
    GET  /clis ; POST /clis/:id/test ; POST /clis    — CLIs list + per-CLI Test + register
    POST /workspaces/:id/priorities/reorder          — persist drag order (needs a position/order field)
    POST /workspaces/:id/priorities                  — create a priority (and "create persona via priority")
    POST /workspaces ; PUT/DELETE /workspaces/:id    — workspace CRUD + roots[]/role model (today: thin)
    GET/PUT /settings                                — settings read/write (+ the deferred C-S5 redaction)
    extend POST /runs with {task?}                   — ad-hoc free-text run (today: priorityId only)
    extend personas assignment with {mode, subAgents}— visible/headless + sub-agent hierarchy (core change)
    POST /runs/:id/stop                              — actually stop a RUNNING run (today only teardown panes)

Begin by cd-ing into the worktree, confirming the branch + daemon health, re-capturing fixtures (ws id
`cocoder`), reading the orientation files, then building Slice 0.
