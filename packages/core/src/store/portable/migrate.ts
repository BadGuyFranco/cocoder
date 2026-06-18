import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { portableRunPaths } from './paths.js'
import { ensurePortableWorkspace } from './workspace.js'
import { writePortableCounters } from './counters.js'
import {
  writePortableRun,
  type PortableCommitRow,
  type PortableEventRow,
  type PortableRunFile,
  type PortableSessionRow,
  type PortableTargetKind,
  type PortableWorkItemRow,
} from './runs.js'
import { redactEventData } from './event-redaction.js'
import { isMissingFile, writeJsonLines } from './json.js'
import type { CommitLink, Run, RunEvent, RunStore, Session, WorkItem } from '../types.js'

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
  const sessionNumbers = sessionDisplayNumbers(input.store, runs)
  let sessionsExported = 0

  for (const [index, run] of runs.entries()) {
    const displayNumber = index + 1
    const paths = portableRunPaths(input.primaryRoot, displayNumber, run.id)
    await writePortableRun(input.primaryRoot, portableRunFile(run, displayNumber))

    const sessions = input.store.listSessions(run.id).sort(compareSessions)
    sessionsExported += sessions.length
    await writeJsonLines(paths.sessionsFile, sessions.map((session) => portableSessionRow(session, sessionNumbers)))
    await writeJsonLines(paths.workItemsFile, input.store.listWorkItems(run.id).sort(compareWorkItems).map(portableWorkItemRow))
    await writeJsonLines(paths.commitsFile, input.store.listCommitLinks(run.id).sort(compareCommits).map(portableCommitRow))
    await writeJsonLines(paths.eventsFile, input.store.listEvents(run.id).sort(compareEvents).map(portableEventRow))
  }

  await writePortableCounters(input.primaryRoot, {
    schemaVersion: 1,
    nextTicketNumber: (await maxTicketNumber(input.primaryRoot)) + 1,
    nextRunDisplayNumber: runs.length + 1,
    nextSessionDisplayNumber: sessionsExported + 1,
  })

  return { runsExported: runs.length, sessionsExported }
}

function portableRunFile(run: Run, displayNumber: number): PortableRunFile {
  return {
    run: { id: run.id, displayNumber },
    workspace: { id: run.workspaceId },
    target: { kind: targetKind(run) },
    priorityId: run.priorityId,
    playbookId: run.playbookId,
    ticketId: run.ticketId,
    status: run.status,
    createdAt: run.createdAt,
    endedAt: run.endedAt,
  }
}

function targetKind(run: Run): PortableTargetKind {
  if (run.ticketId !== null) return 'ticket'
  if (run.playbookId !== null) return 'playbook'
  return 'priority'
}

function sessionDisplayNumbers(store: RunStore, runs: readonly Run[]): ReadonlyMap<string, number> {
  const sessions = runs.flatMap((run) => store.listSessions(run.id)).sort(compareSessions)
  return new Map(sessions.map((session, index) => [session.id, index + 1]))
}

function portableSessionRow(session: Session, sessionNumbers: ReadonlyMap<string, number>): PortableSessionRow {
  const displayNumber = sessionNumbers.get(session.id)
  if (displayNumber === undefined) throw new Error(`Missing portable display number for session ${session.id}`)
  return {
    session: { id: session.id, displayNumber },
    runId: session.runId,
    persona: session.persona,
    startedAt: session.startedAt,
    exitCode: session.exitCode,
  }
}

function portableWorkItemRow(item: WorkItem): PortableWorkItemRow {
  return {
    id: item.id,
    runId: item.runId,
    sourcePersona: item.sourcePersona,
    targetPersona: item.targetPersona,
    task: item.task,
    writeScope: item.writeScope,
    status: item.status,
    createdAt: item.createdAt,
  }
}

function portableCommitRow(commit: CommitLink): PortableCommitRow {
  return {
    id: commit.id,
    runId: commit.runId,
    workItemId: commit.workItemId,
    commitSha: commit.commitSha,
    message: commit.message,
    files: commit.files,
    createdAt: commit.createdAt,
  }
}

function portableEventRow(event: RunEvent): PortableEventRow {
  return {
    id: event.id,
    runId: event.runId,
    type: event.type,
    at: event.at,
    data: redactEventData(event.data),
  }
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

function compareSessions(a: Session, b: Session): number {
  return compareNumber(a.startedAt, b.startedAt) || a.id.localeCompare(b.id)
}

function compareWorkItems(a: WorkItem, b: WorkItem): number {
  return compareNumber(a.createdAt, b.createdAt) || a.id.localeCompare(b.id)
}

function compareCommits(a: CommitLink, b: CommitLink): number {
  return compareNumber(a.createdAt, b.createdAt) || a.id.localeCompare(b.id)
}

function compareEvents(a: RunEvent, b: RunEvent): number {
  return compareNumber(a.at, b.at) || a.id.localeCompare(b.id)
}

function compareNumber(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1
}
