import { portableRunPaths } from './paths.js'
import { writePortableRun, type PortableCommitRow, type PortableEventRow, type PortableRunFile, type PortableSessionRow, type PortableTargetKind, type PortableWorkItemRow } from './runs.js'
import { redactEventData } from './event-redaction.js'
import { writeJsonLines } from './json.js'
import type { CommitLink, Run, RunEvent, RunStatus, RunStore, Session, WorkItem } from '../types.js'

export interface WritePortableRunHistoryInput {
  readonly primaryRoot: string
  readonly store: RunStore
  readonly run: Run
  readonly displayNumber: number
  readonly sessionDisplayNumbers: ReadonlyMap<string, number>
  readonly terminal?: {
    readonly status: RunStatus
    readonly endedAt: number
  }
}

export async function writePortableRunHistory(input: WritePortableRunHistoryInput): Promise<void> {
  const storedRun = input.store.getRun(input.run.id) ?? input.run
  const run = input.terminal ? { ...storedRun, status: input.terminal.status, endedAt: input.terminal.endedAt } : storedRun
  const paths = portableRunPaths(input.primaryRoot, input.displayNumber, run.id)
  await writePortableRun(input.primaryRoot, portableRunFile(run, input.displayNumber))
  await writeJsonLines(paths.sessionsFile, listPortableRunSessions(input.store, run.id).map((session) => portableSessionRow(session, input.sessionDisplayNumbers)))
  await writeJsonLines(paths.workItemsFile, input.store.listWorkItems(run.id).sort(compareWorkItems).map(portableWorkItemRow))
  await writeJsonLines(paths.commitsFile, input.store.listCommitLinks(run.id).sort(compareCommits).map(portableCommitRow))
  await writeJsonLines(paths.eventsFile, input.store.listEvents(run.id).sort(compareEvents).map(portableEventRow))
}

export function buildPortableSessionDisplayNumbers(store: RunStore, runs: readonly Run[]): ReadonlyMap<string, number> {
  const sessions = runs.flatMap((run) => listPortableRunSessions(store, run.id)).sort(compareSessions)
  return new Map(sessions.map((session, index) => [session.id, index + 1]))
}

export function listPortableRunSessions(store: RunStore, runId: string): Session[] {
  return store.listSessions(runId).sort(compareSessions)
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

function portableSessionRow(session: Session, sessionNumbers: ReadonlyMap<string, number>): PortableSessionRow {
  const displayNumber = sessionNumbers.get(session.id)
  if (displayNumber === undefined) throw new Error(`Missing portable display number for session ${session.id}`)
  return { session: { id: session.id, displayNumber }, runId: session.runId, persona: session.persona, startedAt: session.startedAt, exitCode: session.exitCode }
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
  return { id: commit.id, runId: commit.runId, workItemId: commit.workItemId, commitSha: commit.commitSha, message: commit.message, files: commit.files, createdAt: commit.createdAt }
}

function portableEventRow(event: RunEvent): PortableEventRow {
  return { id: event.id, runId: event.runId, type: event.type, at: event.at, data: redactEventData(event.data) }
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
