# oz-daemon

Fastify HTTP control plane for Oz (v0.1 Solve scaffold).

## Audit log rotation (v0.1)

Launch/stop actions append schema-valid JSON lines to `<CoCoder>/local/audit/oz-actions.jsonl`.

**Rotation policy:** manual only in v0.1. When the file exceeds ~5 MiB or ~10k lines, archive it under `local/audit/zArchive/oz-actions-YYYYMMDD.jsonl` and start a fresh empty `oz-actions.jsonl`. No automatic rotation code ships in v0.1; operators rotate during routine install maintenance.

Invalid records are rejected before append (fail closed via `ozAuditRecordSchema`).

## Testing notes

Things that will save you an hour if you read them before writing your first oz-daemon test.

| Quirk | What to do instead |
|---|---|
| **`fastify.inject()` always synthesizes a Host header** | You cannot test Host-absent behavior through inject. Replace assertions like "GET works without Host" with the achievable equivalent (e.g., "GET /health does not require Bearer"). Use explicit `host: \`127.0.0.1:${port}\`` when testing auth bootstrap. |
| **Zod regex validation on workspace paths fires before `assertRegistryPathToken`** | Tests asserting the registry-helper error (`env references are not allowed`) must accept either error string, or scope the assertion at the Zod layer only. |
| **Mock launch subprocess uses `launchArgvPrefix` + JSON argv stdout** | When `launchArgvPrefix` / `stopArgvPrefix` is set, POST/DELETE use `launchCocoderSubprocess` (JSON stdout). Real cocoder CLI spawns use `runCocoderSubprocess` (exit code only). Tests must set profile/route/prioritySlug when exercising configured launch subprocess. |

## Multiplexer observation (v0.2 seam)

All tmux observation routes through `src/multiplexer-observer.ts`. HTTP handlers must not call tmux directly. v0.2 cmux migration swaps the observer implementation only.
