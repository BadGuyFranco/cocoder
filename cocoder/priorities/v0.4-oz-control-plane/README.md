# v0.4 — Oz Control Plane

**Status:** Draft (stub)
**Owner:** Bob + founder
**Sequencing:** Founder decision. Depends on the claude.ai/design output for the Oz UI and on [ADR-0008](../../decisions/0008-oz-control-plane-architecture.md). Builds on v0.3 work item #6 ("Oz as control plane") and the founder-flagged "improve Oz dashboard / Oz oversight + debugger" theme.

## Summary

Turn Oz into a real **operator control plane**: a per-workspace, in-dashboard headless chatbot that is the primary command interface *and* the primary watcher/interface for every run — plus the oversight/debugger mechanism for live runs.

## Architecture (decided)

- [ADR-0008](../../decisions/0008-oz-control-plane-architecture.md) — Oz control-plane architecture (Oz persona model, command + watch, GUI⇄Oz parity, external orchestration sessions, persona exec model incl. visible/headless, the six surfaces).
- [ADR-0007](../../decisions/0007-workspace-files-and-multiroot-description.md) (revised 2026-05-27) — root-role taxonomy primary / writable / read-only.
- Screen/flow brief + design prompt: [`docs/oz-design-brief.md`](../../../docs/oz-design-brief.md) (intent; refined by the claude.ai/design output).

## Work items (provisional — refine after design output lands)

1. **Dashboard** — workspace picker, in-app Oz chat (primary command interface), priorities list with **drag-and-drop reorder** + an **ad-hoc "run without a priority"** launcher.
2. **Workspaces** — add/edit workspaces (name + description) and roots with the three roles (primary / writable / read-only); plumb `role` as a first-class registry field (the registry entry schema already `.passthrough()`es — extends WS-DESC work).
3. **CLIs** — register adapters + a **Test** button returning success or the exact error.
4. **Personas** — per-persona **CLI + model** (with `default`), **sub-agent/service CLI+model hierarchy**, **visible/headless** run mode; list defaults incl. Oz; "create a new persona via a priority."
5. **Runs** — list + run detail (live transcript / evidence / status / stop / attach) as Oz's window into externally-running iTerm sessions.
6. **Oz oversight / debugger** — Oz as live watcher of all workspace runs; the Orchestrator Debugger surface (reference: CoBuilder `ORCH DEBUGGER`); terminal-state awareness (the daemon already refuses mutations on terminal runs — surface it).
7. **Settings** — human-friendly only, never JSON; extensible.

## Open questions

- The CLI→model→sub-agent configuration hierarchy UI (nesting).
- How the ad-hoc run capture maps to a run and (optionally) a new priority.
- The seam for later replacing external iTerm sessions with an embedded **Electron** terminal harness (keep the run-detail contract stable).
- Sequencing vs v0.2 / v0.3.
