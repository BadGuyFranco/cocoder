#!/usr/bin/env node
// `cocoder` entrypoint. Registers the tsx ESM loader so the CLI runs TypeScript directly
// (no build step in Phase 1), then hands off to run.ts.
import { register } from 'node:module'
register('tsx/esm', import.meta.url)
await import('../src/run.ts')
