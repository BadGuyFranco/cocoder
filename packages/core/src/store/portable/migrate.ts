import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ensurePortableWorkspace } from './workspace.js'
import { writePortableCounters } from './counters.js'
import { buildPortableSessionDisplayNumbers, writePortableRunHistory } from './projection.js'
import { isMissingFile } from './json.js'
import type { Run, RunStore } from '../types.js'

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
  const sessionNumbers = buildPortableSessionDisplayNumbers(input.store, runs)
  let sessionsExported = 0

  for (const [index, run] of runs.entries()) {
    const displayNumber = index + 1
    sessionsExported += input.store.listSessions(run.id).length
    await writePortableRunHistory({ primaryRoot: input.primaryRoot, store: input.store, run, displayNumber, sessionDisplayNumbers: sessionNumbers })
  }

  await writePortableCounters(input.primaryRoot, {
    schemaVersion: 1,
    nextTicketNumber: (await maxTicketNumber(input.primaryRoot)) + 1,
    nextRunDisplayNumber: runs.length + 1,
    nextSessionDisplayNumber: sessionsExported + 1,
  })

  return { runsExported: runs.length, sessionsExported }
}

async function maxTicketNumber(primaryRoot: string): Promise<number> {
  const ticketDirs = [
    join(primaryRoot, 'cocoder', 'tickets', 'open'),
    join(primaryRoot, 'cocoder', 'tickets', 'closed'),
  ]
  const maxima = await Promise.all(ticketDirs.map((dir) => maxLeadingNumberInDir(dir)))
  return Math.max(0, ...maxima)
}

async function maxLeadingNumberInDir(dir: string): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error: unknown) {
    if (isMissingFile(error)) return 0
    throw error
  }
  return entries.reduce((max, name) => Math.max(max, leadingNumber(name)), 0)
}

function leadingNumber(name: string): number {
  const match = /^(\d+)/.exec(name)
  return match === null ? 0 : Number(match[1])
}

function compareRunsForDisplay(a: Run, b: Run): number {
  return compareNumber(a.createdAt, b.createdAt) || a.id.localeCompare(b.id)
}

function compareNumber(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1
}
