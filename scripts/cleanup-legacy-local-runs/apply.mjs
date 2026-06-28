import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function applyPurge(deps) {
  const {
    manifestPath,
    generatedAt,
    repoRoot,
    localRoot,
    dbPath,
    runsRoot,
    workspaces,
    workspaceById,
    projectionChecker,
    core,
    entries,
    summary,
    residueCategories,
    compareRunIds,
    classify,
    terminalStatuses,
    readRuns,
    readRunDirs,
    buildEntries,
    summarize,
    portableFootprint,
  } = deps
  const selected = entries.filter((entry) => residueCategories.includes(entry.category)).sort((left, right) => compareRunIds(left.runId, right.runId))
  const result = await purgeSelectedRuns({ selected, core, dbPath, runsRoot, workspaceById, projectionChecker, classify, terminalStatuses, residueCategories })
  const postRows = readRuns(dbPath, (await import('node:sqlite')).DatabaseSync)
  const postDirs = await readRunDirs(runsRoot)
  const postEntries = await buildEntries({ rows: postRows, dirs: postDirs, runsRoot, workspaceById, projectionChecker, core })
  const postSummary = summarize(postEntries, postRows.length, postDirs.length, await portableFootprint(workspaces))
  const applySummary = summarizePurge({ selected, ...result, postSummary })

  await writePurgeManifest({
    manifestPath,
    generatedAt,
    repoRoot,
    localRoot,
    dbPath,
    runsRoot,
    summary,
    applySummary,
    postSummary,
    ...result,
  })
}

async function purgeSelectedRuns({ selected, core, dbPath, runsRoot, workspaceById, projectionChecker, classify, terminalStatuses, residueCategories }) {
  const store = core.openRunStore(dbPath)
  const purged = []
  const skipped = []
  const failures = []

  try {
    for (const entry of selected) await purgeOneRun({ entry, store, core, runsRoot, workspaceById, projectionChecker, classify, terminalStatuses, residueCategories, purged, skipped, failures })
  } finally {
    store.close()
  }

  return { purged, skipped, failures }
}

async function purgeOneRun({ entry, store, core, runsRoot, workspaceById, projectionChecker, classify, terminalStatuses, residueCategories, purged, skipped, failures }) {
  const run = store.getRun(entry.runId)
  if (run === null) {
    skipped.push({ runId: entry.runId, reason: 'store-row-absent-at-apply' })
    return
  }

  const category = await liveResidueCategory({ run, workspaceById, projectionChecker, classify, terminalStatuses })
  if (!residueCategories.includes(category)) {
    skipped.push({ runId: run.id, reason: `no-longer-residue:${category}`, status: run.status })
    return
  }

  const rowsBefore = entry.storeRows ?? { sessions: 0, workItems: 0, commits: 0, events: 0, faultEvents: 0 }
  try {
    const dirResult = core.removeLocalRunDir(runsRoot, run.id)
    const pruneResult = store.pruneRunRows(run.id)
    purged.push({
      runId: run.id,
      category,
      localRunDirRemoved: dirResult.removed,
      storeRowsPruned: prunedRows(rowsBefore, pruneResult),
      runRowKept: pruneResult.runRowKept,
      faultEventsKept: pruneResult.faultEventsKept,
    })
  } catch (error) {
    const failure = { runId: run.id, category, error: errorMessage(error), sqliteBusy: isSqliteBusy(error) }
    failures.push(failure)
    console.error(`cleanup purge skipped ${run.id}: ${failure.error}`)
  }
}

async function writePurgeManifest({ manifestPath, generatedAt, repoRoot, localRoot, dbPath, runsRoot, summary, applySummary, purged, skipped, failures, postSummary }) {
  const manifest = {
    kind: 'legacy-local-runs-cleanup-purge',
    mode: 'apply',
    generatedAt,
    repoRoot,
    localRoot,
    dbPath,
    runsRoot,
    safety: {
      destructiveAction: true,
      dbOpenMode: 'read-write',
      dbBusyTimeoutMs: 5000,
      writes: [manifestPath],
      liveExcludedCount: summary.liveExcluded.count,
      liveExcludedRunIds: summary.liveExcluded.runIds,
      selectionPolicy: 'terminal residue only; rechecked immediately before each purge',
    },
    preSummary: summary,
    applySummary,
    purged,
    skipped,
    failures,
    postSummary,
  }
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  printPurgeSummary(manifestPath, applySummary, postSummary)
}

async function liveResidueCategory({ run, workspaceById, projectionChecker, classify, terminalStatuses }) {
  const terminal = terminalStatuses.has(run.status)
  if (!terminal) return 'live-excluded'

  const workspaceResolvable = workspaceById.has(run.workspaceId)
  const projectedToRepo = await projectionChecker(run)
  return classify({ terminal, workspaceResolvable, projectedToRepo })
}

function prunedRows(rowsBefore, pruneResult) {
  return {
    runRows: pruneResult.runRowKept ? 0 : 1,
    sessions: rowsBefore.sessions,
    workItems: rowsBefore.workItems,
    commits: rowsBefore.commits,
    events: Math.max(0, rowsBefore.events - pruneResult.faultEventsKept),
  }
}

function summarizePurge({ selected, purged, skipped, failures, postSummary }) {
  return {
    selected: selected.length,
    dirsRemoved: purged.filter((entry) => entry.localRunDirRemoved !== null).length,
    rowsFullyRemoved: purged.filter((entry) => entry.runRowKept === false).length,
    rowsFaultPreserved: purged.filter((entry) => entry.runRowKept === true).length,
    skipped: skipped.length,
    failures: failures.length,
    actualPostFootprint: {
      localRunEntries: postSummary.current.localRunEntries,
      storeRunRows: postSummary.current.storeRunRows,
      localRunDirs: postSummary.current.localRunDirs,
      residue: postSummary.residue,
      liveExcluded: postSummary.liveExcluded,
    },
  }
}

function printPurgeSummary(manifestPath, applySummary, postSummary) {
  console.log('Legacy local runs cleanup purge (--apply)')
  console.log(`Manifest: ${manifestPath}`)
  console.log(
    `Purged: selected=${applySummary.selected} dirsRemoved=${applySummary.dirsRemoved} rowsFullyRemoved=${applySummary.rowsFullyRemoved} rowsFaultPreserved=${applySummary.rowsFaultPreserved} skipped=${applySummary.skipped} failures=${applySummary.failures}`,
  )
  console.log(`Actual post footprint: entries=${postSummary.current.localRunEntries} storeRows=${postSummary.current.storeRunRows} runDirs=${postSummary.current.localRunDirs}`)
  console.log(`Post residue: pre-projection=${postSummary.residue['pre-projection'].count} orphan-workspace=${postSummary.residue['orphan-workspace'].count} both=${postSummary.residue.both.count}`)
  console.log(`Live/non-terminal excluded: ${postSummary.liveExcluded.count}`)
  console.log(`Live/non-terminal excluded IDs: ${postSummary.liveExcluded.runIds.length > 0 ? postSummary.liveExcluded.runIds.join(', ') : '(none)'}`)
}

function isSqliteBusy(error) {
  if (!error || typeof error !== 'object') return false
  if ('code' in error && error.code === 'ERR_SQLITE_BUSY') return true
  if ('sqliteCode' in error && error.sqliteCode === 'SQLITE_BUSY') return true
  return error instanceof Error && error.message.includes('SQLITE_BUSY')
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
