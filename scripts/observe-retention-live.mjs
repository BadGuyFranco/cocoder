#!/usr/bin/env node
// Live observer - machine-local retention GC daemon boot pass.
//
//   node scripts/observe-retention-live.mjs --snapshot before --out /tmp/reten-before.json
//   node scripts/observe-retention-live.mjs --snapshot after --out /tmp/reten-after.json
//   node scripts/observe-retention-live.mjs --diff --before /tmp/reten-before.json --after /tmp/reten-after.json
//
// This script is strictly read-only against the live install. The daemon performs retention GC; this
// script only stats files, reads the audit log, and opens the SQLite store in read-only mode.

import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const localRoot = join(repoRoot, 'local')
const protectedStatuses = new Set(['running', 'awaiting-founder', 'awaiting-archive-confirmation', 'held'])
const usage = 'Usage:\n  node scripts/observe-retention-live.mjs --snapshot <before|after> --out <path>\n  node scripts/observe-retention-live.mjs --diff --before <path> --after <path>'

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`)
    const key = arg.slice(2)
    if (key === 'diff') {
      args.diff = true
      continue
    }
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`)
    args[key] = value
    i += 1
  }
  return args
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function fileSize(path) {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function treeBytes(root) {
  let entry
  try {
    entry = await stat(root)
  } catch {
    return 0
  }
  if (!entry.isDirectory()) return entry.size

  let total = 0
  for (const name of await readdir(root)) {
    total += await treeBytes(join(root, name))
  }
  return total
}

async function countRunDirs(root) {
  if (!(await exists(root))) return { total: 0, byWorkspace: {} }
  let total = 0
  const byWorkspace = {}
  for (const workspaceId of (await readdir(root)).sort()) {
    const wsDir = join(root, workspaceId)
    if (!(await stat(wsDir)).isDirectory()) continue
    const runIds = []
    for (const runId of (await readdir(wsDir)).sort()) {
      if ((await stat(join(wsDir, runId))).isDirectory()) runIds.push(runId)
    }
    byWorkspace[workspaceId] = { count: runIds.length, runIds }
    total += runIds.length
  }
  return { total, byWorkspace }
}

function countByWorkspace(runs) {
  const out = {}
  for (const run of runs) out[run.workspaceId] = (out[run.workspaceId] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([left], [right]) => left.localeCompare(right)))
}

function openReadOnlyRuns(dbPath) {
  const db = new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=ro`, { readOnly: true })
  try {
    const rows = db
      .prepare(
        `SELECT id, workspace_id, priority_id, playbook_id, ticket_id, status, created_at, ended_at
           FROM run
          ORDER BY created_at DESC`,
      )
      .all()
    return rows.map((row) => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      priorityId: String(row.priority_id),
      playbookId: row.playbook_id === null ? null : String(row.playbook_id),
      ticketId: row.ticket_id === null ? null : String(row.ticket_id),
      status: String(row.status),
      createdAt: Number(row.created_at),
      endedAt: row.ended_at === null ? null : Number(row.ended_at),
    }))
  } finally {
    db.close()
  }
}

async function readRetentionAuditEntries(auditPath) {
  let text = ''
  try {
    text = await readFile(auditPath, 'utf8')
  } catch {
    return []
  }
  const entries = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"action":"retention-gc"')) continue
    try {
      const entry = JSON.parse(line)
      if (entry && typeof entry === 'object' && entry.action === 'retention-gc') entries.push(entry)
    } catch {
      entries.push({ malformedLine: line })
    }
  }
  return entries
}

function runDirPresent(runDirs, run) {
  const workspace = runDirs.byWorkspace[run.workspaceId]
  return workspace ? workspace.runIds.includes(run.id) : false
}

async function snapshot(label) {
  assert(label === 'before' || label === 'after', '--snapshot must be before or after')
  const dbPath = join(localRoot, 'cocoder.db')
  assert(await exists(dbPath), `store database not found: ${dbPath}`)

  const runDirs = await countRunDirs(join(localRoot, 'runs'))
  const runs = openReadOnlyRuns(dbPath)
  const protectedRuns = runs
    .filter((run) => protectedStatuses.has(run.status))
    .map((run) => ({ id: run.id, workspaceId: run.workspaceId, status: run.status, runDirPresent: runDirPresent(runDirs, run) }))
    .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId) || left.id.localeCompare(right.id))

  return {
    kind: 'retention-live-snapshot',
    mode: label,
    capturedAt: new Date().toISOString(),
    cocoderHome: repoRoot,
    localRoot,
    footprint: {
      localBytes: await treeBytes(localRoot),
      dbBytes: await fileSize(dbPath),
      walBytes: await fileSize(join(localRoot, 'cocoder.db-wal')),
      auditBytes: await fileSize(join(localRoot, 'oz-audit.log')),
      runDirs,
    },
    store: {
      runRows: runs.length,
      runRowsByWorkspace: countByWorkspace(runs),
      runIds: runs.map((run) => run.id).sort(),
      protectedRuns,
    },
    audit: {
      path: join(localRoot, 'oz-audit.log'),
      retentionGcEntries: await readRetentionAuditEntries(join(localRoot, 'oz-audit.log')),
    },
  }
}

function guardSnapshotOut(path) {
  const target = resolve(path)
  const local = resolve(localRoot)
  const rel = relative(local, target)
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep))) {
    throw new Error(`refusing to write snapshot under live local/: ${path}`)
  }
}

async function writeSnapshot(label, outPath) {
  guardSnapshotOut(outPath)
  const data = await snapshot(label)
  await writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`)
  console.log(`Snapshot ${label}: wrote ${outPath}`)
  console.log(
    `Footprint: local=${data.footprint.localBytes} db=${data.footprint.dbBytes} wal=${data.footprint.walBytes} audit=${data.footprint.auditBytes} runDirs=${data.footprint.runDirs.total}`,
  )
  console.log(`Store: rows=${data.store.runRows} protected=${data.store.protectedRuns.length}`)
}

async function loadSnapshot(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'))
  assert(parsed.kind === 'retention-live-snapshot', `not a retention live snapshot: ${path}`)
  return parsed
}

function delta(after, before) {
  return after - before
}

function afterRunDirHas(snapshotData, run) {
  const workspace = snapshotData.footprint.runDirs.byWorkspace[run.workspaceId]
  return workspace ? workspace.runIds.includes(run.id) : false
}

function printFootprintDelta(before, after) {
  const rows = [
    ['localBytes', before.footprint.localBytes, after.footprint.localBytes],
    ['dbBytes', before.footprint.dbBytes, after.footprint.dbBytes],
    ['walBytes', before.footprint.walBytes, after.footprint.walBytes],
    ['auditBytes', before.footprint.auditBytes, after.footprint.auditBytes],
    ['runDirs', before.footprint.runDirs.total, after.footprint.runDirs.total],
  ]
  for (const [name, beforeValue, afterValue] of rows) {
    console.log(`${name}: before=${beforeValue} after=${afterValue} delta=${delta(afterValue, beforeValue)}`)
  }
}

function assertProtectedRuns(before, after) {
  const afterStoreIds = new Set(after.store.runIds)
  const missingRows = []
  const missingDirs = []
  for (const run of before.store.protectedRuns) {
    if (!afterStoreIds.has(run.id)) missingRows.push(`${run.workspaceId}/${run.id}:${run.status}`)
    if (run.runDirPresent && !afterRunDirHas(after, run)) missingDirs.push(`${run.workspaceId}/${run.id}:${run.status}`)
  }
  assert(missingRows.length === 0, `protected run rows pruned: ${missingRows.join(', ')}`)
  assert(missingDirs.length === 0, `protected run dirs pruned: ${missingDirs.join(', ')}`)
  return { rowsChecked: before.store.protectedRuns.length, dirsChecked: before.store.protectedRuns.filter((run) => run.runDirPresent).length }
}

function assertRetentionAudit(beforePath, afterPath, before, after) {
  const beforeCount = before.audit.retentionGcEntries.length
  const afterCount = after.audit.retentionGcEntries.length
  if (resolve(beforePath) === resolve(afterPath)) {
    assert(afterCount >= beforeCount, 'same-snapshot audit count regressed')
    return { beforeCount, afterCount, mode: 'same-snapshot' }
  }
  assert(afterCount > beforeCount, `no new retention-gc audit entry captured after daemon pass (before=${beforeCount}, after=${afterCount})`)
  return { beforeCount, afterCount, mode: 'real-pass' }
}

async function diffSnapshots(beforePath, afterPath) {
  const before = await loadSnapshot(beforePath)
  const after = await loadSnapshot(afterPath)
  printFootprintDelta(before, after)
  const protectedResult = assertProtectedRuns(before, after)
  const auditResult = assertRetentionAudit(beforePath, afterPath, before, after)
  console.log(
    `PASS protected runs: rows intact=${protectedResult.rowsChecked}, run dirs intact=${protectedResult.dirsChecked}`,
  )
  console.log(
    `PASS audit: retention-gc entries before=${auditResult.beforeCount} after=${auditResult.afterCount} (${auditResult.mode})`,
  )
  console.log('PASS summary: live retention observation invariants held')
}

try {
  const args = parseArgs(process.argv.slice(2))
  if (args.diff) {
    assert(args.before && args.after, '--diff requires --before and --after')
    await diffSnapshots(args.before, args.after)
  } else if (args.snapshot) {
    assert(args.out, '--snapshot requires --out')
    await writeSnapshot(args.snapshot, args.out)
  } else {
    throw new Error(usage)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
