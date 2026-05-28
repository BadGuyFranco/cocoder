# CoCoder IDE — Designer Notes

Implementation guidance from the designer, captured 2026-05-27 (before the full spec/prototype is placed in `docs/cocoder-ide-design/`). These notes are authoritative input for **ADR-0010** and the build plan. The spec ships as a React prototype (`app.jsx` + design tokens + a dev/annotation registry); the prototype is **reference**, not production code.

## What's simulated in the prototype → real wiring it implies

| Prototype (fake) | Real wiring to build |
|---|---|
| Oz chat is a regex bot (`app.jsx::buildOzReply`); seed prompts (status, launch next, promote #N, full/partial) | Oz must be a **tool-using agent**: recognize **intents → actions**, call the orchestrator (Claude/chosen CLI), stream replies back. The seed prompts are the intent set, not a protocol. |
| Run transcripts are static arrays | **Stream per run** (websocket or SSE), indexed by `run.id`, with **replay-on-reconnect** and **disk persistence** (close laptop → return to same transcript). |
| `cocoder attach <run-id>` (Attach tab just copies a string) | Decide what the **CLI actually does** — most likely connect to the cmux/tmux session that owns that run's iTerm. **New CLI command.** |
| "Decision needed" flow suspends nothing | Wire a real **pause/resume primitive**: run hits a decision point → **pauses** (Oscar blocks waiting for human input) → Oz surfaces the callout → founder answers → run **resumes** with the answer routed through Oscar. |
| CLI Test = 1.1s timeout | Real Test **invokes the CLI** with a no-op command and parses the result. |
| Re-check dependency (same fake shape) | Wire to `which iterm2` / `which cmux` (or platform equivalent). |
| Root folder picker = text input w/ folder icon | Use the platform's **real picker** (Electron `dialog.showOpenDialog`). |

## Do NOT inherit from the prototype

- **Drag-and-drop priorities** uses native HTML5 drag → use **dnd-kit** or **react-dnd** (keyboard, touch, a11y, animation included).
- **Tweaks panel** is design-review-only → **strip for production**. The first-run state IS real (drive off "no workspaces configured yet"); theme/density move into **Settings → Appearance**.
- **Dev annotations** are spec, not feature → strip them, but **keep the registry as design docs**.
- **Fixed-width artboard** isn't responsive below ~1280px. Desktop-class is fine per brief, but **Electron should clamp min window size**.

## Architecture (real, easy to miss)

- **Oz is workspace-scoped and plural.** Three open tabs = **three live Oz processes**, each with its own conversation, watcher list, retention window. **Don't share state.** **Suspend watchers for backgrounded (non-active) tabs** to save tokens; wake on tab focus.
- **Persona color identity is stable across the app:** Bob = sage, Quinn = coral, Oz = gold, system = muted. They double as recognition cues — keep consistent (esp. transcript view).
- **"Craft new persona" priority** carries the full spec in `priority.spec`. When it runs, Oscar reads the spec and builds the persona (prompt, sub-agents, tests). The persona appears in the Personas list **only after Quinn green-lights** the build.
- **`run.progress`** is currently hardcoded. Real progress is probably **Oscar's step counter** (step 2 of 5) projected to a 0–1 float. **Decide where the truth lives.**
- **Light theme** is wired but lightly tested; some colors are inline hex/rgba. Tokens flip, but verify a full pass.

## Accessibility (needs work — not there yet)

No keyboard nav on workspace tabs · drag-reorder has no keyboard path · modal focus-trap not bulletproof · ARIA labels sparse.

## Out of scope for the control plane (FOUNDER-CONFIRMED 2026-05-27)

Designer flagged auth, identity, billing, telemetry, crash reporting, update channels as mute-in-brief. Founder decision:

- **In scope for v0.6:** **Update channels** — the packaged Electron app gets an in-app update mechanism (vs. today's git-clone + pnpm). ADR-0010 must cover update channel/signing/distribution.
- **Deferred (out of scope for v0.6):** Auth & identity, billing, telemetry & crash reporting. (CoCoder stays a local single-operator tool — localhost Oz daemon + per-install token. Revisit telemetry only as an explicit opt-in design if ever needed.)

## Implications for the orchestration core / oz-daemon (flag, don't assume)

Several "real wiring" items reach beyond the IDE shell into existing packages — to be validated against the code during spec review, not assumed:

- **`cocoder attach <run-id>`** → new `packages/core` CLI command + session-ownership lookup.
- **Pause/resume decision primitive** → run lifecycle state in `packages/core` (ledger/launch) where a run can block awaiting a founder decision and resume with the answer routed through Oscar. This is the most significant core touch.
- **Real `run.progress`** → Oscar emits a step counter the daemon projects to 0–1.
- **Per-run transcript streaming (SSE/WS) + persistence** → `packages/oz-daemon`.
- **Oz-as-tool-using-agent (intents → actions)** → oz-daemon/dashboard + orchestration.

> ADR-0008 discipline: keep core changes minimal and **flag** required ones rather than assume. Where the IDE genuinely needs a core/daemon primitive (pause/resume especially), that becomes an explicit companion work item in the build plan.
