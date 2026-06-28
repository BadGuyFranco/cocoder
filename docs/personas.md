# CoCoder Personas

**Status:** Draft, implemented by Sub-Playbook D Solve  
**Last verified:** 2026-06-21 (base set is Oz/Oscar/Bob/Deb/Quinn; testing moved to Plays, ADR-0033)

Personas are role contracts for orchestration lanes. They describe what a lane is responsible for, how it receives work, what evidence it must return, and whether it can write.

## Core personas

| Persona | Role |
|---|---|
| Oz | Global orchestration overseer. Provides the multi-workspace dashboard and control-plane surface. |
| Oscar | Lead orchestrator. Selects the bounded packet, reconciles route fit, dispatches teammates, and owns priority closeout. |
| Bob | Primary builder and architect. Implements scoped changes, keeps docs and behavior aligned, and reports verification evidence. |
| Deb | Escalation engineer. Observes run health, diagnoses machinery faults, and repairs CoCoder-owned infrastructure when in scope. |
| Quinn | User-interaction QA. Exercises browser, terminal, and IDE paths where scripted interaction is the right evidence. |

Routes decide which personas are active in a run. A persona listed in the library does nothing until a route and profile assign it to a lane.

## Dispatch rules

The lead lane should dispatch work as a concrete packet, not as a vague phase label. A good packet includes the task, scope, write boundary, exclusions, verification command, and result expectations.

Teammate lanes should:

- treat the launch prompt as authoritative for persona, adapter, write capability, and result paths
- obey the startup packet's write boundary
- preserve unrelated working-tree changes
- stop when a requested edit crosses the lane boundary
- write result artifacts only when the packet is complete

The route's substitution policy matters. If a route requires Bob as a builder, a planning or verifier lane does not silently satisfy that role.

## Write capability

Write access is lane-specific. A persona can be capable in one route and read-only in another, depending on the selected profile and priority boundary.

Common policies:

- **read-only** - inspect and report, but do not edit.
- **task-scoped** - write only the packet's files or directories.
- **bounded-writer** - write within a declared priority boundary, still preserving unrelated changes.

When a packet asks for a wider edit than the boundary allows, report the conflict instead of expanding scope locally.

## Results

Every active lane returns the result contract named in its launch prompt, usually `job-result`. At minimum, closeout should include status, files changed, findings, evidence, residual risk, and the next action.

Evidence should be concrete enough for the lead to audit without reading the whole chat transcript. Prefer command outputs, report paths, screenshots, diffs, and named files over narrative confidence.

## Custom-persona ergonomics

Custom personas are tracked workspace artifacts, not private prompt hacks. A good custom persona adds a focused role, a validated contract, prompt fragments, route eligibility, and an evidence checklist.

Use custom personas when a recurring job needs a different skill boundary than Bob, Quinn, or the
testing Plays (`write-tests` / `run-tests`). Do not create one for a one-off packet that the existing
route can dispatch clearly.

See [`custom-personas.md`](./custom-personas.md) for schema requirements, directory conventions, prompt manifests, validation commands, and review gates.
