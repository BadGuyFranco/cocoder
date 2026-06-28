export const terminalStatuses = new Set(['completed', 'failed', 'stopped'])
export const residueCategories = ['pre-projection', 'orphan-workspace', 'both']

export async function buildEntries({ rows, dirs, runsRoot, workspaceById, projectionChecker, core }) {
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

  return entries
}

export function classify({ terminal, workspaceResolvable, projectedToRepo }) {
  if (!terminal) return 'live-excluded'
  if (!workspaceResolvable && !projectedToRepo) return 'both'
  if (!workspaceResolvable) return 'orphan-workspace'
  return projectedToRepo ? 'projected' : 'pre-projection'
}

export function compareRunIds(left, right) {
  const l = numericRunId(left)
  const r = numericRunId(right)
  return l !== null && r !== null && l !== r ? l - r : left.localeCompare(right)
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

function numericRunId(runId) {
  const match = /^run_(\d+)$/.exec(runId)
  return match ? Number.parseInt(match[1], 10) : null
}
