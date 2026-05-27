# Oz design brief

**Status:** intent — pending the claude.ai/design output, then implementation.
**Decides nothing on its own:** the settled architecture is in [ADR-0008](../cocoder/decisions/0008-oz-control-plane-architecture.md) (Oz control-plane model) and [ADR-0007](../cocoder/decisions/0007-workspace-files-and-multiroot-description.md) (root roles). This file captures the **screen/flow brief** and the **verbatim design prompt** used to generate the Oz UI, so the intent is durable and feeds implementation under the `v0.4-oz-control-plane` priority.

Authored 2026-05-27. Audience: technical founder/operator. Visual styling is owned by the claude.ai/design system and is intentionally unspecified here.

---

## The design prompt (paste into claude.ai/design)

```
# Design brief: "Oz" — the control plane for CoCoder

You have NO prior context on CoCoder. Read this fully, then (1) map the user flows, (2) design each screen, (3) define states for each. Use your existing design system for all visual styling — this brief is about information architecture, flows, screens, components, and data, not aesthetics.

## What CoCoder is
CoCoder is a local, self-improving AI software-orchestration engine for a technical founder. Instead of coding directly, the founder directs a small team of AI "personas" (each backed by a coding CLI like Claude Code, Codex, or Cursor) that plan, build, test, and review software across one or more code repositories. Work is organized into prioritized units; the AI team executes them as "runs" the founder supervises.

## What you're designing: Oz
Oz is the control plane — the single app where the founder runs the whole operation. The audience is a technical founder/operator comfortable with terms like run, persona, CLI, root, priority. Design it as a desktop-class web app (persistent left-side navigation; will later be wrapped in Electron). Never show raw JSON anywhere — always human-friendly forms, tables, and controls.

## Core concepts (the data model you're designing around)
- Workspace — a named, described project context. It bundles one or more root folders. Everything in Oz is scoped to the currently selected workspace. There can be many workspaces.
- Root folder — a directory in a workspace. Each root has: Name, Path, and a Role:
  - Primary — the main working repo; where the project's coding happens and where CoCoder is "picked up." Exactly one primary per workspace.
  - Writable — the orchestrator may write to it, but only with explicit human permission.
  - Read-only — a reference repo; never written to.
- Priority — a unit of work to pick up next. A workspace has an ordered list of priorities (top = next).
- Run — one execution of work by the AI team against a workspace (e.g., building a priority, or an ad-hoc task). Runs have status (running / complete / blocked / failed / stopped), a live transcript, evidence/results, and controls (stop, attach).
- Persona — a role on the AI team (see Personas screen). Each persona is backed by a CLI + model and runs visible or headless.
- CLI — a coding-agent command-line tool (Claude Code, Codex, Cursor-agent, Grok, Gemini, …) that personas run on. Each must be installed + authenticated locally.
- Oz — itself a headless persona: the in-app chatbot + watcher described below.

## The Oz interaction model (important)
- Oz is an in-dashboard, headless chatbot and the primary command interface: the founder converses with Oz to do everything — launch runs, add/reorder priorities, kick off ad-hoc tasks (code reviews, refactors, research), and ask for status. GUI controls (buttons, drag-drop) are shortcuts for the same actions Oz can take — both must exist and stay in sync.
- Oz is also the primary watcher/interface for all runs in the selected workspace: it monitors every run and surfaces progress, decisions it needs from the founder, and results — all inside Oz.
- There is one Oz per workspace. Switching the workspace switches the Oz conversation, its priorities, and its runs.
- The actual orchestration sessions execute externally (today in iTerm terminal windows; later an embedded Electron terminal). Oz does not embed those live terminals — it observes/controls them and shows their transcript/evidence/status. Design run views as Oz's window into externally-running sessions.

## Your task
1. User flows first. Before screens, map the key flows and include them: e.g., "first-time setup → add a CLI → test it → create a workspace → add roots → set personas → launch the first run"; "daily: pick workspace → talk to Oz / pick a priority → launch → watch the run → review result"; "ad-hoc: launch a run with no priority to do a refactor/review/research."
2. Design each screen below with its component breakdown.
3. Define states for each screen: empty (nothing configured yet), loading, active/live, and error.

## Screens

### 1. Dashboard (per selected workspace)
- Workspace picker at the top — switches the entire context (Oz conversation, priorities, runs).
- Oz Terminal — the chatbot conversation with this workspace's Oz: the primary place to issue commands and watch runs. Show conversation history, an input, and inline run/status updates Oz surfaces. Make clear this is a live, working conversation, not a help bot.
- Priorities — the workspace's ordered priority list, reorderable by drag-and-drop (top = next up). Each priority shows its name/summary/status and a Launch action. At the top of the list, an "Launch a run without a priority" action: lets the founder describe an ad-hoc task for the orchestrator to run (e.g., add new priorities, code review, refactor, research) without it being a formal priority.
- Should give an at-a-glance sense of what's running now and what's next.

### 2. Workspaces
- List of workspaces (name + description); create/edit/delete.
- Editing a workspace: edit name and description, and add/remove root folders.
- Each root row: Name, Path (with a folder picker), and Role selector (Primary / Writable / Read-only) — clearly convey the three roles' meaning and the rule that there's exactly one Primary.

### 3. CLIs
- List the configured CLIs (Claude Code, Codex, Cursor-agent, Grok, Gemini, …) with availability/auth status.
- Add a new CLI — an easy form to register one.
- A per-CLI "Test" button that runs a check and returns Success, or shows the exact error the test returned (e.g., not installed, not authenticated).

### 4. Personas
- Lists the default personas with short descriptions of each role. (Include Oz in this list — it is a persona, and runs headless.)
- For each persona, configurable:
  - CLI + Model — two linked dropdowns: pick the CLI (Claude, Codex, …), then the Model available for that CLI, including a "Default" option (e.g., "Claude → Default" or "Claude → Opus 4.7").
  - Run mode — Visible or Headless.
  - Sub-agents / services — a persona may delegate specific tasks to sub-agents/services; each sub-agent also gets its own CLI + Model selection, so the UI must express a hierarchy (persona → its sub-agents, each independently configurable).
- A way to craft a priority that creates a new persona — i.e., starting "make a new persona" enqueues it as a workspace priority for the AI team to build, rather than a raw form.

### 5. Runs (per selected workspace)
- Workspace picker at the top (same pattern as Dashboard).
- A list of runs with status, what they worked on, and timing.
- A run detail view: live read-only transcript, evidence/results, status, and controls (stop, attach/copy-attach-command). Remember: the live session runs externally (iTerm) — this is Oz's view into it.

### 6. Settings
- Human-friendly configuration only — never raw JSON. Use forms/toggles. Treat the exact contents as flexible; design a clean, extensible settings layout (e.g., defaults, global preferences) that can grow.

## Global rules
- Never expose JSON — everything is forms, tables, selectors, status chips.
- Workspace context is pervasive (Dashboard + Runs have the picker); make the active workspace obvious everywhere.
- GUI ⇄ Oz parity — anything the founder can do via a button, they can also ask Oz to do; keep them consistent.
- Use precise, technical terminology (run, persona, root, priority, CLI).
- Left-nav top level: Dashboard, Workspaces, CLIs, Personas, Runs, Settings.

## Deliverables
- A user-flow map (the flows above).
- Each screen designed with component breakdown and empty/loading/active/error states.
- The navigation/IA structure tying it together.
```

---

## Open items to resolve from the design output

- The **CLI + Model hierarchy** (persona → CLI → model, and sub-agent → CLI → model) is the trickiest interaction — confirm the design handles nesting cleanly.
- **Settings** contents are intentionally loose; the design should be extensible without inventing final contents.
- How the **ad-hoc "run without a priority"** capture maps to an actual run + (optionally) a new priority.
- The seam where the external iTerm session is later replaced by an **embedded Electron terminal** — keep the run-detail "window into the session" contract stable across that swap.
