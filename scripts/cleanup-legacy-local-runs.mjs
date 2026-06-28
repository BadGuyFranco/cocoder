#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const innerFlag = '--__cocoder-cleanup-legacy-local-runs-inner'
const terminalStatuses = new Set(['completed', 'failed', 'stopped'])
const residueCategories = ['pre-projection', 'orphan-workspace', 'both']
if (!process.argv.includes(innerFlag)) {
  const child = spawn('pnpm', ['exec', 'tsx', fileURLToPath(import.meta.url), innerFlag], {
    cwd: repoRoot,
    env: { ...process.env, NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS ?? '1' },
    stdio: 'inherit',
  })
  child.on('exit', (code, signal) => {
    if (signal) console.error(`cleanup inventory interrupted by ${signal}`)
    process.exitCode = signal ? 1 : (code ?? 1)
  })
} else {
  await main()
}
async function main() {
  const { DatabaseSync } = await import('node:sqlite')
  const coreRequire = createRequire(join(repoRoot, 'packages/core/package.json'))
  const core = await import(coreRequire.resolve('@cocoder/core'))
  const { readWorkspaces } = await import(pathToFileURL(join(repoRoot, 'packages/daemon/src/registry.ts')).href)
  const localRoot = join(repoRoot, 'local')
  const dbPath = join(localRoot, 'cocoder.db')
  const runsRoot = join(localRoot, 'runs')
  const generatedAt = new Date().toISOString()
  const manifestPath = join(localRoot, 'cleanup-legacy-local-runs', `inventory-${generatedAt.replace(/[:.]/g, '-')}.json`)
  const rows = readRuns(dbPath, DatabaseSync)
  const dirs = await readRunDirs(runsRoot)
  const workspaces = await readWorkspaces(repoRoot)
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const projectionChecker = core.projectionCheckerFor((workspaceId) => workspaceById.get(workspaceId)?.path ?? null)
  const rowById = new Map(rows.map((run) => [run.id, run]))
  const dirById = new Map(dirs.map((dir) => [dir.runId, dir]))
  const entries = []

  for (const runId of [...new Set([...rowById.keys(), ...dirById.keys()])].sort(compareRunIds)) {
    const run = rowById.get(runId) ?? null
    const dir = dirById.get(runId) ?? null
    if (run === null) {
      entries.push(dirOnly(runId, dir))
      continue
    }
    const workspace = workspaceById.get(run.workspaceId) ?? null
    const workspaceResolvable = workspace !== null
    const projectedToRepo = await projectionChecker(run)
    const portable = workspaceResolvable ? await core.readPortableRunById(workspace.path, run.id) : null
    const terminal = terminalStatuses.has(run.status)
    const category = classify({ terminal, workspaceResolvable, projectedToRepo })
    entries.push({
      runId: run.id,
      workspaceId: run.workspaceId,
      status: run.status,
      terminal,
      projectedToRepo,
      workspaceResolvable,
      localRunDirPath: dir?.path ?? core.localRunDir(runsRoot, run),
      localRunDirPresent: dir !== null,
      storeRowPresent: true,
      category,
      residueReasons: reasons({ terminal, workspaceResolvable, projectedToRepo }),
      backfillSalvageable: category === 'pre-projection' ? salvageable(run, workspaceResolvable) : null,
      resolvedWorkspacePath: workspace?.path ?? null,
      portableRun: portable ? { displayNumber: portable.run.displayNumber, status: portable.status } : null,
      storeRows: {
        sessions: run.sessionCount,
        workItems: run.workItemCount,
        commits: run.commitCount,
        events: run.eventCount,
        faultEvents: run.faultEventCount,
      },
      createdAt: run.createdAt,
      endedAt: run.endedAt,
      priorityId: run.priorityId,
      playbookId: run.playbookId,
      ticketId: run.ticketId,
    })
  }

  const summary = summarize(entries, rows.length, dirs.length, await portableFootprint(workspaces))
  const manifest = {
    kind: 'legacy-local-runs-cleanup-inventory',
    mode: 'dry-run-report-only',
    generatedAt,
    repoRoot,
    localRoot,
    dbPath,
    runsRoot,
    safety: {
      destructiveAction: false,
      dbOpenMode: 'read-only',
      writes: [manifestPath],
      liveExcludedCount: summary.liveExcluded.count,
      liveExcludedRunIds: summary.liveExcluded.runIds,
    },
    summary,
    entries,
  }
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  printSummary(manifestPath, summary)
}

function readRuns(dbPath, DatabaseSync) {
  const db = new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=ro`, { readOnly: true })
  try {
    return db
      .prepare(
        `SELECT r.id, r.workspace_id, r.priority_id, r.playbook_id, r.ticket_id, r.status, r.created_at, r.ended_at,
                (SELECT COUNT(*) FROM session s WHERE s.run_id = r.id) AS session_count,
                (SELECT COUNT(*) FROM work_item w WHERE w.run_id = r.id) AS work_item_count,
                (SELECT COUNT(*) FROM commit_link c WHERE c.run_id = r.id) AS commit_count,
                (SELECT COUNT(*) FROM event e WHERE e.run_id = r.id) AS event_count,
                (SELECT COUNT(*) FROM event e WHERE e.run_id = r.id AND e.type = 'fault-triaged') AS fault_event_count
           FROM run r
          ORDER BY r.created_at DESC, r.id DESC`,
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        priorityId: String(row.priority_id),
        playbookId: nullable(row.playbook_id),
        ticketId: nullable(row.ticket_id),
        status: String(row.status),
        createdAt: Number(row.created_at),
        endedAt: row.ended_at === null ? null : Number(row.ended_at),
        sessionCount: Number(row.session_count),
        workItemCount: Number(row.work_item_count),
        commitCount: Number(row.commit_count),
        eventCount: Number(row.event_count),
        faultEventCount: Number(row.fault_event_count),
      }))
  } finally {
    db.close()
  }
}

async function readRunDirs(runsRoot) {
  const workspaceEntries = await readdirOrEmpty(runsRoot)
  const dirs = []
  for (const workspaceEntry of workspaceEntries.sort(byName)) {
    if (!workspaceEntry.isDirectory()) continue
    const workspacePath = join(runsRoot, workspaceEntry.name)
    if (workspaceEntry.name.startsWith('run_')) {
      dirs.push({ runId: workspaceEntry.name, workspaceIdFromPath: null, path: workspacePath })
      continue
    }
    for (const runEntry of (await readdirOrEmpty(workspacePath)).sort(byName)) {
      if (runEntry.isDirectory()) dirs.push({ runId: runEntry.name, workspaceIdFromPath: workspaceEntry.name, path: join(workspacePath, runEntry.name) })
    }
  }
  return dirs
}

async function portableFootprint(workspaces) {
  const byWorkspace = {}
  let total = 0
  for (const workspace of workspaces) {
    const path = join(workspace.path, 'cocoder', 'runs')
    const count = await countPortableRuns(path)
    byWorkspace[workspace.id] = { path, count }
    total += count
  }
  return { total, byWorkspace }
}

async function countPortableRuns(runsDir) {
  let count = 0
  for (const entry of await readdirOrEmpty(runsDir)) {
    if (!entry.isDirectory() || !/^\d+-run_/.test(entry.name)) continue
    try {
      if ((await stat(join(runsDir, entry.name, 'run.json'))).isFile()) count += 1
    } catch {
      // Malformed portable directories are not projected run records.
    }
  }
  return count
}

function classify({ terminal, workspaceResolvable, projectedToRepo }) {
  if (!terminal) return 'live-excluded'
  if (!workspaceResolvable && !projectedToRepo) return 'both'
  if (!workspaceResolvable) return 'orphan-workspace'
  return projectedToRepo ? 'projected' : 'pre-projection'
}

function reasons({ terminal, workspaceResolvable, projectedToRepo }) {
  if (!terminal) return []
  return [!projectedToRepo ? 'pre-projection' : null, !workspaceResolvable ? 'orphan-workspace' : null].filter(Boolean)
}

function salvageable(run, workspaceResolvable) {
  return workspaceResolvable && terminalStatuses.has(run.status) && Boolean(run.id && run.workspaceId && run.priorityId) && Number.isFinite(run.createdAt)
}

function dirOnly(runId, dir) {
  return {
    runId,
    workspaceId: dir?.workspaceIdFromPath ?? null,
    status: null,
    terminal: null,
    projectedToRepo: null,
    workspaceResolvable: null,
    localRunDirPath: dir?.path ?? null,
    localRunDirPresent: dir !== null,
    storeRowPresent: false,
    category: 'directory-only-no-store-row',
    residueReasons: [],
    backfillSalvageable: null,
    resolvedWorkspacePath: null,
    portableRun: null,
    storeRows: null,
    createdAt: null,
    endedAt: null,
    priorityId: null,
    playbookId: null,
    ticketId: null,
  }
}

function summarize(entries, storeRunCount, localRunDirCount, portableRunDirs) {
  const categories = {}
  for (const category of [...residueCategories, 'projected', 'live-excluded', 'directory-only-no-store-row']) {
    const runIds = entries.filter((entry) => entry.category === category).map((entry) => entry.runId).sort(compareRunIds)
    categories[category] = { count: runIds.length, runIds }
  }
  const selected = (category) => new Set(categories[category].runIds)
  const allResidue = new Set(residueCategories.flatMap((category) => categories[category].runIds))
  return {
    current: {
      localRunEntries: entries.length,
      storeRunRows: storeRunCount,
      localRunDirs: localRunDirCount,
      projectedStoreRuns: entries.filter((entry) => entry.projectedToRepo === true).length,
      portableRunDirRecords: portableRunDirs.total,
      portableRunDirsByWorkspace: portableRunDirs.byWorkspace,
    },
    residue: Object.fromEntries(residueCategories.map((category) => [category, categories[category]])),
    liveExcluded: categories['live-excluded'],
    projected: categories.projected,
    directoryOnlyNoStoreRow: categories['directory-only-no-store-row'],
    postCleanupFootprints: {
      purgePreProjectionOnly: footprint(entries, selected('pre-projection'), storeRunCount, localRunDirCount),
      purgeOrphanWorkspaceOnly: footprint(entries, selected('orphan-workspace'), storeRunCount, localRunDirCount),
      purgeBothOnly: footprint(entries, selected('both'), storeRunCount, localRunDirCount),
      purgeAllResidue: footprint(entries, allResidue, storeRunCount, localRunDirCount),
    },
  }
}

function footprint(entries, selectedRunIds, storeRunCount, localRunDirCount) {
  const selected = entries.filter((entry) => selectedRunIds.has(entry.runId))
  const selectedStoreRows = selected.filter((entry) => entry.storeRowPresent).length
  const selectedLocalRunDirs = selected.filter((entry) => entry.localRunDirPresent).length
  return { selectedRuns: selected.length, selectedStoreRows, selectedLocalRunDirs, postStoreRunRows: storeRunCount - selectedStoreRows, postLocalRunDirs: localRunDirCount - selectedLocalRunDirs }
}

function printSummary(manifestPath, summary) {
  console.log('Legacy local runs cleanup inventory (dry-run/report only)')
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Current local runs: entries=${summary.current.localRunEntries} storeRows=${summary.current.storeRunRows} runDirs=${summary.current.localRunDirs}`)
  console.log(`Projected cocoder/runs: storeRowsProjected=${summary.current.projectedStoreRuns} portableRunDirs=${summary.current.portableRunDirRecords}`)
  console.log(`Residue: pre-projection=${summary.residue['pre-projection'].count} orphan-workspace=${summary.residue['orphan-workspace'].count} both=${summary.residue.both.count}`)
  console.log(`Live/non-terminal excluded: ${summary.liveExcluded.count}`)
  console.log(`Live/non-terminal excluded IDs: ${summary.liveExcluded.runIds.length > 0 ? summary.liveExcluded.runIds.join(', ') : '(none)'}`)
  console.log('Post-cleanup dry-run footprints:')
  for (const [name, data] of Object.entries(summary.postCleanupFootprints)) console.log(`  ${name}: selected=${data.selectedRuns} storeRows=${data.postStoreRunRows} runDirs=${data.postLocalRunDirs}`)
  console.log('No deletion, DB mutation, or backfill performed.')
}

async function readdirOrEmpty(path) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    return []
  }
}

function nullable(value) { return value === null ? null : String(value) }

function compareRunIds(left, right) {
  const l = numericRunId(left)
  const r = numericRunId(right)
  return l !== null && r !== null && l !== r ? l - r : left.localeCompare(right)
}

function numericRunId(runId) {
  const match = /^run_(\d+)$/.exec(runId)
  return match ? Number.parseInt(match[1], 10) : null
}

function byName(left, right) { return left.name.localeCompare(right.name) }
