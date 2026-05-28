#!/usr/bin/env node
// `cocoder` entrypoint. Registers the tsx ESM loader (programmatic API) so the CLI runs
// TypeScript directly — no build step in Phase 1 — then hands off to run.ts.
import { register } from 'tsx/esm/api'
register()
await import('../src/run.ts')
