#!/usr/bin/env node
// `cocoder` entrypoint. Registers the tsx ESM loader (programmatic API) so the CLI runs
// TypeScript directly — no build step in Phase 1 — then hands off to run.ts.
import { register } from 'tsx/esm/api'
register()
await import('../src/suppress-sqlite-warning.ts')
const { main } = await import('../src/run.ts')
main().catch((err) => {
  console.error(`cocoder: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
