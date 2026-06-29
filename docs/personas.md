# CoCoder Personas

**Status:** Draft, implemented by Sub-Playbook D Solve  
**Last verified:** 2026-06-29 (base set is Oz/Oscar/Bob/Deb/Quinn; testing moved to Plays, ADR-0033; model tiers are first-class assignments)

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

## Model assignment and tiers

Each live persona has a `{cli, model}` assignment in `cocoder/personas/assignments.json`. Play-specific overrides live under that persona's `plays` map with the same `{cli, model}` shape. In both places, `model: ""` means "use the CLI's default model."

Assignments can also declare a `tier` instead of pinning a concrete model. The canonical tiers today are `default` and `strong`. The engine resolves a tier to a concrete `{cli, model}` at the live dispatch seam, so stored assignments can say "strong" without baking in a vendor model id.

Precedence is simple: a non-empty concrete `model` always wins, and `tier` is consulted only when `model` is empty. Concrete pins behave exactly as they did before tiers existed.

Each adapter declares its own tier-to-model map in its model-list metadata. The same tier can therefore resolve differently by CLI, for example `strong` can mean Opus for Claude and `gpt-5-codex` for Codex. Any future adapter participates automatically once it declares tier metadata; the resolver and Personas UI do not special-case adapter ids. Requesting a tier the selected adapter does not declare fails loudly with a clear error.

Oscar and Bob are an adversarial pair, so tier resolution has one extra guard: when a tier-introduced resolution would put both on the same concrete `{cli, model}`, the run fails fast before launch with a clear reason. Two explicit identical concrete pins are left alone as the founder's deliberate choice.

In the Personas screen, the Model control lists the selected CLI's declared tiers above the normal Default, enumerated model, and Custom choices. Choosing a tier writes `model: ""` plus `tier`; choosing Default, a concrete model, or Custom clears `tier`.

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
