# v0.5 — Orchestration Services (cheap-model admin delegation)

**Status:** Draft — engine landed 2026-05-27; adoption pending. **Owner:** Bob + founder.
**Decision:** [ADR-0009](../../decisions/0009-orchestration-services.md). **Relates to:** [ADR-0008](../../decisions/0008-oz-control-plane-architecture.md) (Oz unchanged).

## Why

Oscar (the lead orchestrator) was spending expensive lead-model context on repeatable, mechanical admin work — wrap cleanup, handoff/priority compaction, run summaries, teardown/commit-boundary/startup-context audits, result repair. CoCoder had no way to offload that to a cheaper/faster model with bounded writes + verification (model-roles covers only the *build* side). Orchestration services close that gap and are the concrete implementation of the "sub-agents/services that independently select CLI + model" clause already in ADR-0008 — which is why **Oz needs no change**.

## Landed this session (2026-05-27)

- Two contracts (`orchestration-service-declaration`, `orchestration-service` packet) + `lib/services.mjs` engine (build/validate/execute packet, deterministic git write-audit).
- 11 service declarations under `packages/core/services/` (path-scrubbed to CoCoder layout).
- 5 CLI commands; new `cursor-agent-service` headless executor adapter; debugger guidance; session-wrap fragment bullet.
- Tests: core 346/346, oz-daemon 8/8, oz-dashboard 10/10. `validate-orchestration-services` green against shipped declarations.

## Remaining (adoption)

1. **Wire services into Oscar's live wrap/teardown flow** — Oscar builds + runs packets during real runs (currently the engine + prompt guidance exist; the runtime wrap path does not yet invoke them automatically).
2. **Prove headless `cursor-agent` execution end-to-end** against a real run (the suite exercises a fake executor; validate the real `cursor-agent --print --trust --force --sandbox disabled` path + a cheap model).
3. **Surface service results in Oz run detail** — service artifacts already land under `<runDir>/services/<packetId>/`; confirm the Oz run watcher enumerates/labels them (no Oz code change expected; verify only).
4. **Sequencing** — founder to place this relative to v0.2 / v0.3 / v0.4. The `v0.5` slug is provisional (engine is already in `main`-line core).

## Notes

- Adding a service is a new JSON declaration, never a `lib/services.mjs` edit (god-file guard, enforced by `validate-orchestration-services` + debugger guidance).
- Read-only services carry empty write scopes; bounded-write services (`handoff-compaction`, `wrap-execution`, `result-contract-repair`) are write-audited against exact packet `allowedWrites`.
