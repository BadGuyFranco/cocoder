# ADR-0011 — Orchestrator verify-gate (merged into ADR-0013)

**Status:** Merged into [ADR-0013](./0013-orchestration-observation.md) (2026-05-30, per ADR-0014).

The verify-gate decision — *the commit runs only on Oscar's `pass`* — now lives in
[ADR-0013](./0013-orchestration-observation.md) (the run lifecycle) as the per-atom verify station,
where it belongs alongside the multi-atom loop it gates. This file remains as a stable pointer so
existing references to "ADR-0011" still resolve.
