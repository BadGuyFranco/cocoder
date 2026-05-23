# Oz Schemas

Home for the Oz daemon/dashboard contract types so both sides share one source.

## Landed

- `improvement-target.ts` — ADR-0005 improvement-routing taxonomy (`ozImprovementTargetSchema`, `ozImprovementGeneralitySchema`, `ozImprovementRoutingSchema`). The Zod source produces the JSON Schema artifact that the `.mjs` core (and any future Oz daemon) consumes via AJV.

## Target (Sub-Playbook C)

- Oz HTTP request/response schemas — launch, stop, registry CRUD, settings.
- Audit-log record schema (mirrors `local/audit/oz-actions.jsonl`).
- WebSocket event envelopes if Oz adopts a push channel.

Until Sub-Playbook C lands, ADR-0005 is schema-only — there is no runtime enforcement of the routing taxonomy beyond the JSON Schema validation core packages perform.
