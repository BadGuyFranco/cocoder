# Oz — Control Plane Prototype

Historical reference for **Oz**, the CoCoder control plane. This is a high-fidelity working mock, not
production code and not a regeneration source for `packages/ui/app`. Open `Oz.html` in a browser to run
the archived prototype.

---

## What this is

- A single-page React prototype (no build step) demonstrating the original screen, state, and interaction
  intent from the design brief.
- Stable visual reference: type, color, spacing, components, and copy are committed.
- Behavioral reference: clicking through the prototype demonstrates the intended flows.
- A spec embedded in the UI itself — **turn on dev annotations** (see below).

`packages/ui/app` is now the maintained implementation. Do not wholesale copy or regenerate it from
`design-ref/`; if a design idea here is revived, port the specific behavior intentionally and verify it
against the maintained app tests.

---

## How to read it

Open `Oz.html` in any modern browser. Key things to try:

1. **Talk to Oz.** Type in the terminal. Try `status`, `launch the next priority`, `promote #4`, `full`, `partial`. Click the decision callout when run-1 is blocked.
2. **Click a running priority.** The Run Detail drawer slides out next to it with the gold-edge handoff cue.
3. **Open Run history.** Top-right of the priorities panel.
4. **Switch workspaces.** Use the tabs at the top of the dashboard. Each tab is its own Oz instance.
5. **Inspect every persona.** Personas screen. Note the linked CLI + Model dropdowns and sub-agent hierarchy.
6. **Craft a new persona.** Header button on Personas — fills a priority for the team to build.
7. **First-run setup.** Open Tweaks (bottom-left toggle) → Workspace state → First run.

### Dev annotations (the embedded spec)

Open the **Tweaks panel** (toggle in the toolbar) → flip **Show dev annotations** on. Eighteen numbered gold pins appear on key UI surfaces. Click any pin for a short component spec — what it is, how it behaves, and the data it touches. A floating **"Dev notes"** button (bottom-right) opens the full index.

Treat the dev-notes list as the binding implementation spec.

---

## File layout

```
Oz.html                    Entry point. Loads everything below.
oz.css                     App styles. Extends the design system.
design-system/             CoBuilder Fusion design system tokens (drop-in).
  colors_and_type.css        93 CSS variables, typography classes
  fonts/                     Josefin Sans (display)
data.js                    Seed data — workspaces, runs, priorities,
                           personas, CLIs, dependencies, settings.
                           NOT the schema spec; just demo content.
dev-notes.js               Component specs for the dev team.
                           18 numbered entries that overlay the UI.
components.jsx             Shared primitives — Sidebar, TopBar,
                           WorkspaceTabs, Modal, Button, StatusChip,
                           DevNote, DevNotesPanel, Card.
dashboard.jsx              Dashboard composition — PrioritiesPanel
                           (incl. AdhocPriorityRow + PriorityRow),
                           OzChatPanel, RunDetail drawer,
                           RunHistoryModal, first-run setup card.
screens.jsx                Workspaces, CLIs, Personas, Settings,
                           Dependencies panel, NewWorkspaceModal,
                           CraftPersonaModal.
app.jsx                    Root component. State, routing, tweaks
                           wiring, Oz bot reply simulator.
tweaks-panel.jsx           Tweaks panel host (theme, density,
                           workspace state, dev-mode toggle).
```

No bundler, no npm install. React + Babel are loaded from unpkg.

---

## Hard rules baked in

These come from the design brief and should survive the rewrite:

- **Five top-level nav items only:** Dashboard · Workspaces · CLIs · Personas · Settings. Runs and Priorities are panels inside Dashboard, never standalone pages.
- **One Oz per workspace.** Multiple workspaces loaded = multiple independent headless Oz instances. Persist Oz state keyed on `workspace.id`. (See dev note 17.)
- **Oz is the command center.** Anything the founder can do via a button, they must be able to ask Oz to do. Keep parity.
- **Never expose JSON.** Forms, toggles, selectors. Always.
- **Workspace context is pervasive.** Switching tabs swaps Oz, priorities, runs, and conversation atomically.
- **External orchestration sessions.** Today the runs execute in iTerm. The Run Detail "Transcript" tab is Oz's read-only window into the externally-running session. v2 will embed an Electron terminal.
- **Persona roster:** Oz · Oscar · Bob · Talia · Quinn · Doc. New personas are built by the team via the Craft modal — not configured directly.
- **System dependencies separate from CLI auth.** Settings → System dependencies probes iTerm2 / cmux. CLIs screen probes Claude Code / Codex / Cursor-agent / Gemini / Grok.

---

## What this prototype does NOT decide

- The wire protocol between Oz and the orchestrator
- How the externally-running session reports back (probably a websocket per run + persisted transcript)
- The actual persona prompt scaffolding (Oscar builds these at runtime)
- Auth, identity, billing — out of scope for the control plane
- Schema / persistence model

The dev team owns these.

---

## Data model (informal, from the prototype state shape)

```
Workspace {
  id, name, description, icon, roots: [Root], created
}
Root {
  id, name, path, role: "primary" | "writable" | "readonly"
}
Priority {
  id, name, summary, status, labels: [string],
  runId?: string,  // points to the live or last run executing this priority
  spec?: PersonaSpec  // present when priority is a "build new persona"
}
Run {
  id, title, status: "running"|"blocked"|"complete"|"failed"|"stopped",
  priorityId?: string,  // null = ad-hoc
  personas: [string], cli, startedAt, progress, lastEvent, attachCmd,
  transcript: [TranscriptLine], evidence: [EvidenceItem]
}
Persona {
  id, name, role, description, cli, model, runMode: "visible"|"headless",
  subAgents: [{ id, name, cli, model }], icon, headless?: boolean
}
Cli {
  id, name, vendor, version, status: "ok"|"auth-failed"|"not-installed",
  lastTested, errorDetail?, models: [string]
}
Dependency {
  id, name, vendor, purpose, status: "ok"|"not-installed",
  version, lastChecked, installCmd, icon, note?
}
```
