# oz-daemon

Fastify HTTP control plane for Oz (v0.1 Solve scaffold).

## Audit log rotation (v0.1)

Launch/stop actions append schema-valid JSON lines to `<CoCoder>/local/audit/oz-actions.jsonl`.

**Rotation policy:** manual only in v0.1. When the file exceeds ~5 MiB or ~10k lines, archive it under `local/audit/zArchive/oz-actions-YYYYMMDD.jsonl` and start a fresh empty `oz-actions.jsonl`. No automatic rotation code ships in v0.1; operators rotate during routine install maintenance.

Invalid records are rejected before append (fail closed via `ozAuditRecordSchema`).
