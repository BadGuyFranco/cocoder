---
id: ADR-0009
title: "Non-persona orchestration services (cheap-model admin delegation)"
status: accepted
date: 2026-05-27
relates-to: ADR-0002, ADR-0004, ADR-0008
---

# ADR-0009: Non-persona orchestration services

## Context

The lead orchestrator (Oscar) spends expensive lead-model context on repeatable, mechanical administrative work: wrap cleanup, handoff/priority compaction, run summaries, evidence collation, result-contract repair, commit-boundary and startup-context audits, and teardown-readiness checks. None of this needs lead-model judgment, yet today it either runs as deterministic CLI checks (a subset) or falls to Oscar directly.

CoCoder already has model-role assignment (`lib/model-roles.mjs`) for the *build* side — `orchestrator`, `builder`, `builderSubagents`, `planning`, `research` — but those are static, route-scoped lane assignments resolved at launch. There was **no** mechanism for the lead to offload its *own* admin work to a cheaper/faster model on demand, with bounded writes and verification. [ADR-0008](./0008-oz-control-plane-architecture.md) point 6 already reserved the slot ("a persona may delegate to **sub-agents/services that each independently select CLI + model**"); this ADR implements it. The pattern is ported from CoBuilder (upstream extraction reference per [ADR-0001](./0001-storage-and-license.md)).

## Decision

1. **Orchestration services are non-persona, bounded administrative execution units.** They are not agents and create no durable personas. Oscar may invoke a service when work is mechanical and scoped; Oscar retains all judgment (priority, architecture, scope, founder decisions, completion).

2. **Services are declarations, not runtime code.** Each service is a JSON file at `packages/core/services/<service-id>.json` declaring `id`, `label`, `mode` (`read-only` | `bounded-write` | `control-plane`), `purpose`, `execution` (model/executor guidance), `allowedWriteScopes`, and `requiredChecks`. Adding a service is a new declaration, **not** a runtime-code edit — `lib/services.mjs` must not become a catalog god file. Two hand-written JSON contracts validate the surface: `orchestration-service-declaration.schema.json` (registry entry) and `orchestration-service.schema.json` (the **packet**). These follow the same custom `{ contract, required, fields, rules }` shape and `lib/contracts.mjs` validator as the existing 12 core contracts; per [ADR-0004](./0004-typescript-validation-toolchain.md), the Zod→JSON-Schema rule governs `packages/schemas` config/Oz schemas, not the copy-verbatim orchestration contracts.

3. **A service packet binds one execution.** `build-service-packet` instantiates a declaration against exact run context + Oscar's decision input, narrowing the declaration's broad `allowedWriteScopes` to the exact `allowedWrites` for that run, and freezing `decisionAuthority: oscar-only`, `executionAuthority: orchestration-service`, and a fixed `forbiddenDecisions` list. The packet delegates execution only.

4. **Headless execution + deterministic write-audit.** `execute-service-packet` runs the packet headlessly (default executor `cursor-agent`, argv array — no shell interpolation), capturing a service-result JSON and transcript under `<runDir>/services/<packetId>/`. A before/after `git status --porcelain` audit blocks acceptance — forcing `BLOCK` even on a claimed `PASS` — if any write lands outside `allowedWrites` (or any write at all for a read-only service). Failures return diagnosis + proposedFix + nextAction to Oscar, who fixes in scope or recommends the Orchestrator Debugger.

5. **Eleven services ship at adoption.** `startup-context-audit`, `handoff-compaction`, `wrap-execution`, `evidence-collation`, `commit-boundary-audit`, `result-contract-repair`, `run-summary`, `next-run-packet`, `doc-hygiene`, `teardown-readiness`, `regression-triage`. Write scopes were path-scrubbed to CoCoder's layout (`cocoder/PRIORITIES.md`, `cocoder/SESSION_LOG.md`, `cocoder/plans/*.md`, `cocoder/priorities/*/plans/*.md`, `cocoder/priorities/zArchive/INDEX.md`, run results under `local/workspaces/*/runs/*/jobs/*`).

6. **The debugger recognizes the pattern.** Future debugger sessions suggest a service when an issue is recurring, mechanical, bounded, and administrative — and explicitly **not** for founder judgment, priority ordering, architecture direction, persona-dispatch judgment, or Bob/Talia/Phil/Quinn/Ian domain work ([ADR-0002](./0002-talia-quinn-boundary.md) boundaries).

7. **A dedicated `cursor-agent-service` adapter** declares the headless, write-capable executor profile (`interactive: false`, `sandboxModes: [danger-full-access]`, `resultContract: orchestration-service-packet`) as registry metadata, leaving the existing interactive `cursor-agent` adapter (resultContract `job-result`) untouched.

## Consequences

- **Oz requires no change ([ADR-0008](./0008-oz-control-plane-architecture.md) preserved).** Services run externally (Oscar / `cursor-agent`) and write artifacts under the run directory; Oz observes them as ordinary run artifacts in run detail. The capability lives entirely in the orchestration-services / `packages/core` layer.
- Complements `model-roles.mjs`: cheap models on the *build* side (subagents/planning/research) and now on the *lead/admin* side (services).
- New surface: `packages/core/services/`, two contracts, `lib/services.mjs`, 5 CLI commands (`list-orchestration-services`, `validate-orchestration-services`, `build-service-packet`, `validate-service-packet`, `execute-service-packet`), a session-wrap fragment bullet, and debugger guidance. Suite: 346/346 core, 8/8 oz-daemon, 10/10 oz-dashboard.
- **Adoption is pending** (tracked under `v0.5-orchestration-services`): wiring services into Oscar's live wrap/teardown flow, proving headless `cursor-agent` execution end-to-end against a real run, and surfacing service results in Oz run detail.

## Alternatives considered

- **Extend `model-roles.mjs` to cover admin work** — rejected; model-roles are static launch-time lane assignments, not on-demand bounded packets with write-audit. Different shape, different lifecycle.
- **Make each service a persona/sub-agent** — rejected; services must carry no judgment authority. Persona framing would invite scope creep and a durable-identity surface the pattern explicitly avoids.
- **Overwrite the interactive `cursor-agent` adapter with the headless profile** (upstream's exact shape) — rejected; it would flip `interactive`→false and `resultContract`→`orchestration-service-packet`, breaking the prior-session interactive adapter. A separate adapter id keeps both intents.
- **Write service results under `jobs/<lane>/`** — rejected; services are not personas/lanes. `<runDir>/services/<packetId>/` keeps the persona job space clean and matches upstream.
