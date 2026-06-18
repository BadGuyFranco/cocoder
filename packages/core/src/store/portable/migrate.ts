import { readdir } from 'node:fs/promises'
import { ensurePortableWorkspace } from './workspace.js'
import { rebuildPortableCounters } from './counters.js'
import { listPortableRunSessions, writePortableRunHistory } from './projection.js'
import { isMissingFile } from './json.js'
import { portableWorkspacePaths } from './paths.js'
import { readPortableRun, readPortableSessions } from './runs.js'
import type { Run, RunStore, Session } from '../types.js'

export interface MigrateWorkspacePortableHistoryInput {
  readonly primaryRoot: string
  readonly workspace: {
    readonly id: string
    readonly name: string
  }
  readonly store: RunStore
}

export interface MigrateWorkspacePortableHistoryResult {
  readonly runsExported: number
  readonly sessionsExported: number
}

export async function migrateWorkspacePortableHistory(
  input: MigrateWorkspacePortableHistoryInput,
): Promise<MigrateWorkspacePortableHistoryResult> {
  await ensurePortableWorkspace(input.primaryRoot, input.workspace)

  const runs = input.store.listRuns({ workspaceId: input.workspace.id }).sort(compareRunsForDisplay)
  const existing = await scanPortableHistory(input.primaryRoot)
  const missingRuns = runs.filter((run) => !existing.runDisplayNumbers.has(run.id))
  const sessionNumbers = buildMissingSessionDisplayNumbers(input.store, missingRuns, existing.maxSessionDisplayNumber)
  let sessionsExported = 0
  let nextRunDisplayNumber = existing.maxRunDisplayNumber + 1

  for (const run of missingRuns) {
    const displayNumber = nextRunDisplayNumber
    nextRunDisplayNumber += 1
    sessionsExported += input.store.listSessions(run.id).length
    await writePortableRunHistory({ primaryRoot: input.primaryRoot, store: input.store, run, displayNumber, sessionDisplayNumbers: sessionNumbers })
  }

  await rebuildPortableCounters(input.primaryRoot)

  return { runsExported: missingRuns.length, sessionsExported }
}

interface ExistingPortableHistory {
  readonly runDisplayNumbers: ReadonlyMap<string, number>
  readonly maxRunDisplayNumber: number
  readonly maxSessionDisplayNumber: number
}

async function scanPortableHistory(primaryRoot: string): Promise<ExistingPortableHistory> {
  const runsDir = portableWorkspacePaths(primaryRoot).runsDir
  let entries: string[]
  try {
    entries = await readdir(runsDir)
  } catch (error: unknown) {
    if (isMissingFile(error)) return { runDisplayNumbers: new Map(), maxRunDisplayNumber: 0, maxSessionDisplayNumber: 0 }
    throw error
  }

  let maxRunDisplayNumber = 0
  let maxSessionDisplayNumber = 0
  const runDisplayNumbers = new Map<string, number>()
  for (const entry of entries) {
    const parsed = parsePortableRunDir(entry)
    if (parsed === null) continue
    maxRunDisplayNumber = Math.max(maxRunDisplayNumber, parsed.displayNumber)
    const portable = await readPortableRun(primaryRoot, parsed.displayNumber, parsed.runId)
    if (portable === null) continue
    maxRunDisplayNumber = Math.max(maxRunDisplayNumber, portable.run.displayNumber)
    runDisplayNumbers.set(portable.run.id, portable.run.displayNumber)
    const sessions = await readPortableSessions(primaryRoot, parsed.displayNumber, parsed.runId)
    maxSessionDisplayNumber = sessions.reduce((max, row) => Math.max(max, row.session.displayNumber), maxSessionDisplayNumber)
  }

  return { runDisplayNumbers, maxRunDisplayNumber, maxSessionDisplayNumber }
}

function buildMissingSessionDisplayNumbers(store: RunStore, missingRuns: readonly Run[], maxExistingSessionDisplayNumber: number): ReadonlyMap<string, number> {
  const sessions = missingRuns.flatMap((run) => listPortableRunSessions(store, run.id)).sort(compareSessionsForDisplay)
  return new Map(sessions.map((session, index) => [session.id, maxExistingSessionDisplayNumber + index + 1]))
}

function parsePortableRunDir(name: string): { readonly displayNumber: number; readonly runId: string } | null {
  const separator = name.indexOf('-')
  if (separator <= 0 || separator === name.length - 1) return null
  const displayNumber = Number.parseInt(name.slice(0, separator), 10)
  if (!Number.isSafeInteger(displayNumber) || displayNumber < 1) return null
  return { displayNumber, runId: name.slice(separator + 1) }
}

function compareRunsForDisplay(a: Run, b: Run): number {
  return compareNumber(a.createdAt, b.createdAt) || a.id.localeCompare(b.id)
}

function compareSessionsForDisplay(a: Session, b: Session): number {
  return compareNumber(a.startedAt, b.startedAt) || a.id.localeCompare(b.id)
}

function compareNumber(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1
}
