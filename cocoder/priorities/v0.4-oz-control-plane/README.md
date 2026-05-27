# v0.4 — Oz Control Plane

**Status:** Active — **design spec landed 2026-05-27** (`docs/oz-control-plane-design/`); ADR-0010 + build plan next.
**Owner:** Bob + founder
**Sequencing:** Founder decision. Depends on the claude.ai/design output for the Oz UI and on [ADR-0008](../../decisions/0008-oz-control-plane-architecture.md). Builds on v0.3 work item #6 ("Oz as control plane") and the founder-flagged "improve Oz dashboard / Oz oversight + debugger" theme.

## Summary

Turn Oz into a real **operator control plane**: a per-workspace, in-dashboard headless chatbot that is the primary command interface *and* the primary watcher/interface for every run — plus the oversight/debugger mechanism for live runs.

## Architecture (decided)

- [ADR-0008](../../decisions/0008-oz-control-plane-architecture.md) — Oz control-plane architecture (Oz persona model, command + watch, GUI⇄Oz parity, external orchestration sessions, persona exec model incl. visible/headless, the five surfaces with runs + priorities folded into the Dashboard).
- [ADR-0007](../../decisions/0007-workspace-files-and-multiroot-description.md) (revised 2026-05-27) — root-role taxonomy primary / writable / read-only.
- Screen/flow brief + design prompt: [`docs/oz-design-brief.md`](../../../docs/oz-design-brief.md) (intent; **now realized by the spec below**).

## Design spec — landed 2026-05-27

The claude.ai/design output landed as a high-fidelity, working React prototype (the "Oz — Control Plane Prototype"). It is the **source of truth for *what* to build**; it is **reference, not production code** (production is a fresh build informed by it).

- **Spec + prototype:** [`docs/oz-control-plane-design/`](../../../docs/oz-control-plane-design/) — brief (`README.md`), `app.jsx` (shell + Oz intent bot), `dashboard.jsx`/`screens.jsx`/`components.jsx`, `data.js` (informal data model), `dev-notes.js` (18 numbered component specs — the binding implementation spec), Fusion `design-system/` tokens (Josefin Sans + gold kanji marks). Open `Oz.html` to run it.
- **Designer implementation notes:** [`designer-notes.md`](./designer-notes.md) — simulated-vs-real wiring, what NOT to inherit, architecture invariants, a11y gaps, scope.
- **Confirms our ADRs:** five-section nav + Runs/Priorities as Dashboard panels (ADR-0008); `Root.role: primary|writable|readonly` (ADR-0007); Fusion tokens (ADR-0001).

### New decisions this spec forces (→ ADR-0010)

1. **Pause/resume decision primitive** (largest core touch) — a run reaches a decision point → **pauses** (Oscar blocks for a founder answer) → Oz surfaces a callout → founder answers → run **resumes**, routed through Oscar. Real run-lifecycle state in `packages/core`.
2. **`cocoder attach <run-id>`** — new CLI; connects to the cmux/tmux session owning that run's iTerm.
3. **Per-run transcript streaming** (websocket/SSE) + **disk persistence** + replay-on-reconnect (`packages/oz-daemon`); real **`run.progress`** from Oscar's step counter.
4. **Oz as a tool-using agent** (intents → actions), replacing the prototype's regex `buildOzReply`.
5. **Persona roster reconciliation** — the spec's roster is Oz · Oscar · Bob · Talia · Quinn · **Doc** (new); **Ian and Phil are absent**. Reconcile against [ADR-0002](../../decisions/0002-talia-quinn-boundary.md) and the shipped persona set before building the Personas screen.
6. **In-app update channels** — founder-confirmed in scope (packaged app self-update). Auth/identity, billing, telemetry/crash reporting are **deferred**.
7. Build-target: a fresh **`packages/cocoder-ide`** (or extend `packages/oz-dashboard`) using dnd-kit (not native HTML5 DnD), Electron native folder picker + min-window clamp; **strip** the Tweaks panel + dev annotations (keep the registry as design docs).

> The embedded **Electron terminal harness** is explicitly the brief's **"v2"** — tracked separately as [`v0.6-cocoder-ide`](../v0.6-cocoder-ide/README.md). v0.4 keeps orchestration sessions external (iTerm) per ADR-0008 decision 5; the Run Detail transcript is Oz's read-only window into them.

## Work items (provisional — refine after design output lands)

1. **Dashboard** — the operator's hub, built around the **Oz chat as the command center** (primary command interface). Supporting panels *inside* the Dashboard: **priorities** list with **drag-and-drop reorder** + an **ad-hoc "run without a priority"** launcher; **runs** (what's running now / recent) with run detail (live transcript / evidence / status / stop / attach) opening in place as Oz's window into externally-running iTerm sessions. No standalone Runs or Priorities pages.
2. **Workspaces** — add/edit workspaces (name + description) and roots with the three roles (primary / writable / read-only); plumb `role` as a first-class registry field (the registry entry schema already `.passthrough()`es — extends WS-DESC work).
3. **CLIs** — register adapters + a **Test** button returning success or the exact error.
4. **Personas** — per-persona **CLI + model** (with `default`), **sub-agent/service CLI+model hierarchy**, **visible/headless** run mode; list defaults incl. Oz; "create a new persona via a priority."
5. **Oz oversight / debugger** — Oz as live watcher of all workspace runs (surfaced in the Dashboard runs panel); the Orchestrator Debugger surface (reference: CoBuilder `ORCH DEBUGGER`); terminal-state awareness (the daemon already refuses mutations on terminal runs — surface it).
6. **Settings** — human-friendly only, never JSON; extensible.

Note: the left nav is **five sections** — Dashboard, Workspaces, CLIs, Personas, Settings. Runs and Priorities are Dashboard panels, not top-level pages (corrects the earlier six-section draft).

## Priorities panel — display + persisted reorder (design)

Today `cocoder/PRIORITIES.md` is the single source of truth: two sections (`## Active`, `## Draft`), each a markdown table parsed by `packages/oz-daemon/src/priorities.ts`. A priority has `slug`, `description`, `status`, `section`, `readmePath` (`packages/schemas/src/oz/priorities-http.ts`) — **no `order`/`rank` field**; order is implicitly the table row order. The `v0.x-` prefix in slugs is a roadmap-version label baked into the slug, not a separate field, and "Draft" is the **section** the row sits under, not a glitch.

- **Human-readable display (shipped in the dashboard):** the Priorities panel shows `description` as the title and demotes the `slug` (incl. its `v0.x` version) to a small tag — slugs stay stable IDs; the readable name leads.
- **Section vs status:** keep both but label them distinctly — `section` (Active/Draft = which table / backlog vs promoted) is organizational; `status` (Active/Draft/Paused/Complete/Cancelled) is lifecycle. Promoting a priority = moving its row to `## Active`.
- **Persisted reorder (no new ID scheme):** drag-reorder reorders rows **within a section**; order = row order in `PRIORITIES.md`. The daemon gains `PATCH /workspaces/:id/priorities` that **rewrites the markdown row order** in place. Keep the version prefix as a label only — it is *not* the ordering mechanism, so reordering never renumbers versions. One git-tracked source of truth, no DB.
- **Ownership:** `PRIORITIES.md` is founder/Oz-owned — Bob is boundary-blocked from it (`cocoder/profiles/cocoder-oscar.profile.json` `bob.excludedWriteBoundary`), so the **daemon** performs the rewrite on a founder/Oz drag action, not an orchestration lane.

## Open questions

- The CLI→model→sub-agent configuration hierarchy UI (nesting).
- How the ad-hoc run capture maps to a run and (optionally) a new priority.
- The seam for later replacing external iTerm sessions with an embedded **Electron** terminal harness (keep the run-detail contract stable).
- Sequencing vs v0.2 / v0.3.
