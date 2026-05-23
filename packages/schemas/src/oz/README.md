# Oz Schemas

Home for the Oz daemon/dashboard contract types so both sides share one source.

## Landed

- `improvement-target.ts` — ADR-0005 improvement-routing taxonomy (`ozImprovementTargetSchema`, `ozImprovementGeneralitySchema`, `ozImprovementRoutingSchema`). The Zod source produces the JSON Schema artifact that the `.mjs` core (and any future Oz daemon) consumes via AJV.
- `audit-record.ts` — Oz audit-log line schema (`ozAuditRecordSchema`) mirroring `local/audit/oz-actions.jsonl`. Includes ADR-0005 `routing.target` / `routing.generality` on launch/stop records (PC-Q5=A).

## Target (Sub-Playbook C Expand)

- Oz HTTP request/response schemas — launch, stop, registry CRUD, settings (beyond Solve-phase stubs).
- WebSocket event envelopes if Oz adopts a push channel (deferred PC-Q2=A polling in v0.1).

Until Sub-Playbook C Expand lands full HTTP shapes, audit-record and improvement-target schemas are the enforced Oz contract surface in `packages/schemas/src/oz/`.
