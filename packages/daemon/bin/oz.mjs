#!/usr/bin/env node
// Oz daemon entry. Registers the tsx ESM loader (no build step) then starts the always-on server.
// Spawned as an argv subprocess by `cocoder oz start` (the cli must NOT import the daemon — ADR-0008
// topology — so it launches this entry instead, consistent with the argv-only posture C-S7).
import { register } from 'tsx/esm/api'
register()

const { createOzServer } = await import('../src/index.ts')

// argv: [node, oz.mjs, --port, <n>]; cwd is the install root (the cli passes it through).
const portFlag = process.argv.indexOf('--port')
const port = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : undefined

const oz = await createOzServer({ cocoderHome: process.cwd(), port, warmCliCacheOnBoot: true })
console.log(`[oz] daemon listening on ${oz.url} — dashboard at ${oz.url}/`)

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  const forceExitTimer = setTimeout(() => process.kill(process.pid, 'SIGKILL'), 2500)
  forceExitTimer.unref()
  oz.close().finally(() => {
    clearTimeout(forceExitTimer)
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
