---
id: ADR-0008
title: "Oz control-plane architecture"
status: accepted
date: 2026-05-27
relates-to: ADR-0007
---

# ADR-0008: Oz control-plane architecture

## Context

v0.1 ships CoCoder terminal-only, and the dogfood loop now works end to end: launch Oz → pick a workspace → pick a priority → spawn an Oscar/Bob orchestration session (with a visible iTerm split-pane attach). Oz must now become a real **operator control plane**. Before designing and building the UI (`docs/oz-design-brief.md`), we settle how the founder interacts with the engine through Oz so the design and implementation share one model.

## Decision

1. **Oz is a per-workspace, in-dashboard, headless control-plane persona.** There is one Oz per workspace; selecting a workspace switches the Oz conversation, its priorities, and its runs.
2. **Oz is the primary command interface.** The founder converses with Oz to launch runs, add/reorder priorities, kick off ad-hoc tasks (reviews, refactors, research, authoring new priorities), and ask for status.
3. **Oz is the primary watcher/interface for all runs** in the selected workspace — it monitors every run and surfaces progress, founder decisions, and results in-app.
4. **GUI ⇄ Oz parity.** Every GUI action (launch, reorder, edit) is also expressible as an Oz instruction, and the reverse; the two stay in sync (e.g. priorities are drag-reorderable in the GUI *and* reorderable by asking Oz).
5. **Orchestration sessions execute externally.** Oscar/Bob/etc. run in iTerm today (an embedded Electron terminal harness later). Oz observes and controls them — status, transcript, evidence, stop, attach — but does not embed the live terminals yet.
6. **Persona execution model.** Each persona binds to a **CLI (adapter) + model** (with a `default` option that defers to the CLI's own default); a persona may delegate to **sub-agents/services that each independently select CLI + model** (a configuration hierarchy); each persona has a **visible | headless** run mode. Oz itself is headless.
7. **Oz surfaces** — exactly **five** top-level navigation items, never exposing raw JSON: **Dashboard**, **Workspaces** (roots + roles), **CLIs** (register + Test), **Personas** (CLI/model + sub-agent hierarchy + visible/headless + "new persona via priority"), **Settings** (human-friendly forms only). There is no standalone Runs page and no standalone Priorities page.
8. **The Dashboard is the operator's hub, built around the Oz chat as the command center.** The Oz conversation is the primary surface; **priorities** (ordered list, drag-reorder, + an "ad-hoc run" launcher above the list) and **runs** (what's running now / recent, with run detail — transcript, evidence, status, stop, attach — opening in place) are **supporting panels inside the Dashboard**, not separate screens. This follows from Oz being the per-workspace watcher (decision 3): the founder watches and drives runs from the Dashboard, through Oz.

## Consequences

- `packages/oz-dashboard` and `packages/oz-daemon` evolve substantially; the workspace registry gains first-class **root roles** and **persona-execution config** (CLI/model hierarchy, run mode).
- **Root roles refine [ADR-0007](./0007-workspace-files-and-multiroot-description.md)** from Primary/Helper to **primary / writable / read-only** (see that ADR's 2026-05-27 revision).
- Concrete screens and flows are specified in [`docs/oz-design-brief.md`](../../docs/oz-design-brief.md) — *intent*, to be refined by the claude.ai/design output; implementation is tracked under the `v0.4-oz-control-plane` priority.
- Oz becoming the watcher reframes the terminal-state-command-guard (the daemon already refuses mutations on terminal runs) as part of Oz oversight.

## Alternatives considered

- **Oz as a passive status board** (buttons only; chat advisory) — rejected; the founder chose chat-as-primary-command-interface.
- **Embed live orchestration terminals in Oz now** — deferred to the Electron terminal harness; keeping sessions external in iTerm keeps v0.x shippable.
- **Per-tool screens with no unifying control plane** — rejected; Oz is the single operator surface.
- **Six-section nav with standalone Runs + Priorities screens** (an earlier draft of this ADR / `docs/oz-design-brief.md`) — rejected; it mirrored the current shipped app rather than the founder's intent. Runs and Priorities are panels inside the Dashboard, because Oz watches runs and the founder works from the Dashboard conversation.
