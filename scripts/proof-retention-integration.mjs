#!/usr/bin/env node
// Proof harness - machine-local retention GC real daemon wiring.
//
//   node scripts/proof-retention-integration.mjs
//
// Copies the live install's local store/run artifacts into a temp install, enables retention only
// in that scratch, then calls the daemon boot entry runRetentionGcOnce(ctx). The live local/ tree is
// read-only input; all writes happen under os.tmpdir().

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = '@@PROOF_RETENTION_INTEGRATION@@'

const probe = String.raw`
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { openRunStore, readPortableRunById, writePortableRun } from '@cocoder/core'
import { runRetentionGcOnce } from './packages/daemon/src/launcher.ts'
import { readWorkspaces } from './packages/daemon/src/registry.ts'

const marker = '@@PROOF_RETENTION_INTEGRATION@@'
const KEEP = 25
const repoRoot = process.cwd()
const sourceLocal = join(repoRoot, 'local')
const bigLog = 'x'.repeat(8 * 1024 * 1024 + 1024)

const out = (payload) => console.log(marker + JSON.stringify(payload))
const terminal = new Set(['completed', 'failed', 'stopped'])
async function exists(path) { try { await stat(path); return true } catch { return false } }
async function size(path) { try { return (await stat(path)).size } catch { return 0 } }
function ensureTemp(root) {
  const r = resolve(root), t = resolve(tmpdir()), live = resolve(sourceLocal)
  if (!r.startsWith(t.endsWith(sep) ? t : t + sep) || r === t || r === live || live.startsWith(r + sep)) throw new Error('unsafe temp root: ' + r)
}
async function copyIfPresent(from, to) { if (await exists(from)) { await mkdir(dirname(to), { recursive: true }); await copyFile(from, to) } }
async function copyDirIfPresent(from, to) { if (await exists(from)) await cp(from, to, { recursive: true, force: true, errorOnExist: false }) }
async function readJson(path, fallback) { try { return JSON.parse(await readFile(path, 'utf8')) } catch { return fallback } }

async function setupScratch() {
  const temp = await mkdtemp(join(tmpdir(), 'cocoder-retention-integration-'))
  ensureTemp(temp)
  const home = join(temp, 'install')
  const local = join(home, 'local')
  await mkdir(local, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) await copyIfPresent(join(sourceLocal, 'cocoder.db' + suffix), join(local, 'cocoder.db' + suffix))
  await copyDirIfPresent(join(sourceLocal, 'runs'), join(local, 'runs'))
  await copyDirIfPresent(join(sourceLocal, 'workspace'), join(local, 'workspace'))
  await copyIfPresent(join(sourceLocal, 'workspaces.json'), join(local, 'workspaces.json'))
  await copyDirIfPresent(join(sourceLocal, 'oz'), join(local, 'oz'))
  await copyIfPresent(join(sourceLocal, 'oz-audit.log'), join(local, 'oz-audit.log'))
  await copyDirIfPresent(join(repoRoot, 'cocoder', 'runs'), join(home, 'cocoder', 'runs'))

  const settings = await readJson(join(sourceLocal, 'settings.json'), {})
  await writeFile(join(local, 'settings.json'), JSON.stringify({ ...settings, retention: { enabled: true, keepLastNPerWorkspace: KEEP } }, null, 2) + '\n')
  await writeFile(join(local, 'oz-audit.log'), bigLog)
  await mkdir(join(local, 'oz'), { recursive: true })
  await writeFile(join(local, 'oz', 'turn-proof.log'), bigLog)
  return { temp, home, local }
}

function runDir(root, run) { return join(root, run.workspaceId, run.id) }
async function countRunDirs(root) {
  if (!(await exists(root))) return { total: 0, byWorkspace: {} }
  let total = 0
  const byWorkspace = {}
  for (const ws of await readdir(root)) {
    const wsDir = join(root, ws)
    if (!(await stat(wsDir)).isDirectory()) continue
    const count = (await readdir(wsDir)).length
    byWorkspace[ws] = count
    total += count
  }
  return { total, byWorkspace }
}
function countByWorkspace(runs) {
  const out = {}
  for (const run of runs) out[run.workspaceId] = (out[run.workspaceId] ?? 0) + 1
  return out
}
async function footprint(local, store) {
  const runs = store.listRuns()
  return {
    dbBytes: await size(join(local, 'cocoder.db')),
    walBytes: await size(join(local, 'cocoder.db-wal')),
    runDirs: await countRunDirs(join(local, 'runs')),
    storeRunsByWorkspace: countByWorkspace(runs),
    storeRunRows: runs.length,
    auditBytes: await size(join(local, 'oz-audit.log')),
    turnBytes: await size(join(local, 'oz', 'turn-proof.log')),
  }
}

async function seedSentinels(home, store) {
  const runsRoot = join(home, 'local', 'runs')
  const made = {}
  async function make(status, projected, fault) {
    const created = store.createRun({ workspaceId: 'cocoder', priorityId: 'retention-proof' })
    if (status !== 'running') store.setRunStatus(created.id, status)
    const run = store.getRun(created.id)
    await mkdir(runDir(runsRoot, run), { recursive: true })
    await writeFile(join(runDir(runsRoot, run), 'state.json'), JSON.stringify({ proof: true, runId: run.id }) + '\n')
    const session = store.createSession({ runId: run.id, persona: 'bob', sessionRef: run.id + '-proof-session' })
    const item = store.createWorkItem({ runId: run.id, sourcePersona: 'oscar', targetPersona: 'bob', task: 'retention integration proof', writeScope: ['scripts/**'] })
    store.recordCommitLink({ runId: run.id, workItemId: item.id, commitSha: (run.id.replace('_', '') + session.id.replaceAll('_', '')).slice(0, 12), message: 'proof', files: ['scripts/proof-retention-integration.mjs'] })
    store.recordEvent({ runId: run.id, type: 'proof-event', data: { ok: true } })
    if (fault) store.recordEvent({ runId: run.id, type: 'fault-triaged', data: { fingerprint: 'retention-integration-proof', fault: 'proof-fault', disposition: 'retained' } })
    if (projected) await writePortableRun(home, { run: { id: run.id, displayNumber: 900000 + Number(run.id.replace('run_', '')) }, workspace: { id: 'cocoder' }, target: { kind: 'priority' }, priorityId: run.priorityId, playbookId: run.playbookId, ticketId: run.ticketId, status: run.status, createdAt: run.createdAt, endedAt: run.endedAt })
    return run
  }
  made.running = await make('running', true, false)
  made.protectedTerminal = await make('completed', true, false)
  made.unprojected = await make('completed', false, false)
  made.fault = await make('failed', true, true)
  return made
}

async function modelRuns(home, store) {
  const workspaces = new Map((await readWorkspaces(home)).map((ws) => [ws.id, ws.path]))
  const runs = store.listRuns()
  const rows = []
  for (const run of runs) {
    const repo = workspaces.get(run.workspaceId) ?? null
    const projected = repo !== null && (await readPortableRunById(repo, run.id)) !== null
    rows.push({ ...run, resolved: repo !== null, projected })
  }
  return rows
}
function eligiblePruneSet(rows, protectedId) {
  const byWs = new Map()
  for (const row of rows) {
    const list = byWs.get(row.workspaceId) ?? []
    list.push(row); byWs.set(row.workspaceId, list)
  }
  const prune = new Set()
  const keptEligible = {}
  const exceptions = {}
  for (const [workspaceId, list] of byWs.entries()) {
    list.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    keptEligible[workspaceId] = 0
    exceptions[workspaceId] = { unresolved: 0, unprojected: 0, nonTerminal: 0, protected: 0 }
    list.forEach((row, index) => {
      if (!row.resolved) exceptions[workspaceId].unresolved += 1
      else if (!row.projected) exceptions[workspaceId].unprojected += 1
      else if (!terminal.has(row.status)) exceptions[workspaceId].nonTerminal += 1
      else if (row.id === protectedId) exceptions[workspaceId].protected += 1
      else if (index >= KEEP) prune.add(row.id)
      else keptEligible[workspaceId] += 1
    })
  }
  return { prune, keptEligible, exceptions }
}

async function main() {
  const scratch = await setupScratch()
  let store = null
  try {
    let now = 1
    store = openRunStore(join(scratch.local, 'cocoder.db'), { now: () => now++ })
    const sentinels = await seedSentinels(scratch.home, store)
    const faultsBefore = store.listFaultHistory('cocoder').map((f) => f.runId + ':' + f.at + ':' + f.fingerprint)
    const rowsBefore = await modelRuns(scratch.home, store)
    const expected = eligiblePruneSet(rowsBefore, sentinels.protectedTerminal.id)
    const before = await footprint(scratch.local, store)
    const ctx = { cocoderHome: scratch.home, runsRoot: join(scratch.local, 'runs'), store, inFlight: new Map([['retention-proof', sentinels.protectedTerminal.id]]), stopControllers: new Map() }
    const firstLogs = await runGcWithLogs(ctx)
    const afterFirst = await footprint(scratch.local, store)
    const idsAfterFirst = new Set(store.listRuns().map((run) => run.id))
    const dirsAfterFirst = afterFirst.runDirs.total
    const secondLogs = await runGcWithLogs(ctx)
    const afterSecond = await footprint(scratch.local, store)
    const idsAfterSecond = new Set(store.listRuns().map((run) => run.id))

    const pruned = [...expected.prune]
    const faultHistoryAfter = new Set(store.listFaultHistory('cocoder').map((f) => f.runId + ':' + f.at + ':' + f.fingerprint))
    const sentinelState = {
      runningKept: store.getRun(sentinels.running.id) !== null && await exists(runDir(join(scratch.local, 'runs'), sentinels.running)),
      protectedKept: store.getRun(sentinels.protectedTerminal.id) !== null && await exists(runDir(join(scratch.local, 'runs'), sentinels.protectedTerminal)),
      unprojectedKept: store.getRun(sentinels.unprojected.id) !== null && await exists(runDir(join(scratch.local, 'runs'), sentinels.unprojected)),
      faultHistoryKept: faultHistoryAfter.has(sentinels.fault.id + ':' + (store.listFaultHistory('cocoder').find((f) => f.runId === sentinels.fault.id)?.at ?? '') + ':retention-integration-proof'),
    }
    const assertions = {
      scratchIsolated: resolve(scratch.temp).startsWith(resolve(tmpdir()) + sep),
      expectedPrunesExist: pruned.length > 0,
      projectedGate: pruned.every((id) => rowsBefore.find((row) => row.id === id)?.projected === true) && sentinelState.unprojectedKept,
      protectedAndNonTerminal: sentinelState.runningKept && sentinelState.protectedKept,
      recurrenceSurvives: faultsBefore.every((f) => faultHistoryAfter.has(f)) && store.listFaultHistory('cocoder').some((f) => f.runId === sentinels.fault.id && f.fingerprint === 'retention-integration-proof'),
      expectedPruned: pruned.every((id) => {
        const row = rowsBefore.find((item) => item.id === id)
        const run = store.getRun(id)
        const dirGone = row ? !existsSync(runDir(join(scratch.local, 'runs'), row)) : false
        return dirGone && (run === null || store.listSessions(id).length === 0 && store.listWorkItems(id).length === 0 && store.listCommitLinks(id).length === 0)
      }),
      idempotent: idsAfterFirst.size === idsAfterSecond.size && [...idsAfterFirst].every((id) => idsAfterSecond.has(id)) && afterSecond.runDirs.total === dirsAfterFirst,
      walShrank: before.walBytes > afterFirst.walBytes,
      auditRotated: await exists(join(scratch.local, 'oz-audit.log.1')) && afterFirst.auditBytes < before.auditBytes,
      turnRotated: await exists(join(scratch.local, 'oz', 'turn-proof.log.1')) && afterFirst.turnBytes < before.turnBytes,
      boundedEligible: Object.values(expected.keptEligible).every((count) => count <= KEEP),
    }
    store.close(); store = null
    await rm(scratch.temp, { recursive: true, force: true })
    out({ ok: true, model: { tempRemoved: !(await exists(scratch.temp)), before, afterFirst, afterSecond, firstLogs, secondLogs, expectedPruned: pruned.length, keptEligible: expected.keptEligible, exceptions: expected.exceptions, assertions } })
  } finally {
    if (store) store.close()
    await rm(scratch.temp, { recursive: true, force: true })
  }
}
async function runGcWithLogs(ctx) {
  const original = console.error
  const lines = []
  console.error = (message, ...rest) => lines.push([message, ...rest].map(String).join(' '))
  try {
    await runRetentionGcOnce(ctx)
  } finally {
    console.error = original
  }
  return lines
}
main().catch((err) => out({ ok: false, message: err instanceof Error ? err.stack ?? err.message : String(err) }))
`

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  const { stdout, stderr } = await exec('pnpm', ['exec', 'tsx', '--eval', probe], { cwd: repoRoot, maxBuffer: 128 * 1024 * 1024 })
  if (stderr.trim()) process.stderr.write(stderr)
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(MARKER))
  if (!line) throw new Error('probe did not return a proof payload')
  const payload = JSON.parse(line.slice(MARKER.length))
  if (!payload.ok) throw new Error(payload.message)
  const m = payload.model
  for (const [name, ok] of Object.entries(m.assertions)) assert(ok, `assertion failed: ${name}`)

  console.log('Proof - retention integration real daemon wiring')
  console.log(`Scratch cleanup: ${m.tempRemoved ? 'removed' : 'NOT REMOVED'}`)
  console.log(`Before: db=${m.before.dbBytes} wal=${m.before.walBytes} runDirs=${m.before.runDirs.total} rows=${m.before.storeRunRows}`)
  console.log(`After first: db=${m.afterFirst.dbBytes} wal=${m.afterFirst.walBytes} runDirs=${m.afterFirst.runDirs.total} rows=${m.afterFirst.storeRunRows}`)
  console.log(`After second: db=${m.afterSecond.dbBytes} wal=${m.afterSecond.walBytes} runDirs=${m.afterSecond.runDirs.total} rows=${m.afterSecond.storeRunRows}`)
  console.log(`Eligible retained per workspace: ${JSON.stringify(m.keptEligible)}`)
  console.log(`Safety exceptions per workspace: ${JSON.stringify(m.exceptions)}`)
  console.log(`First-pass daemon log: ${m.firstLogs.at(-1) ?? '(none)'}`)
  console.log(`Second-pass daemon log: ${m.secondLogs.at(-1) ?? '(none)'}`)
  console.log(`Idempotency: second pass changed no additional run dirs or store rows; expected first-pass state prunes=${m.expectedPruned}`)
  console.log('PASS projection gate: every pruned run was projected, and the unprojected sentinel was kept')
  console.log('PASS protected/non-terminal exclusion: protected terminal and running sentinels were kept')
  console.log('PASS recurrence survival: listFaultHistory retained pre-GC faults and the pruned fault sentinel')
  console.log('PASS WAL/log rotation: WAL shrank, audit rotated, and scratch turn log rotated')
  console.log('PASS summary: retention integration proof complete')
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
