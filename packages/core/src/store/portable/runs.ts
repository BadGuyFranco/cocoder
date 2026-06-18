import { readdir } from 'node:fs/promises'
import { portableRunDirName, portableRunPaths, portableWorkspacePaths } from './paths.js'
import { appendJsonLine, isMissingFile, type JsonValue, readJsonLines, readOptionalJson, writeJson } from './json.js'
import type { RunStatus, WorkItemStatus } from '../types.js'

export type PortableTargetKind = 'priority' | 'playbook' | 'ticket'

export interface PortableRunFile {
  readonly run: {
    readonly id: string
    readonly displayNumber: number
  }
  readonly workspace: {
    readonly id: string
  }
  readonly target: {
    readonly kind: PortableTargetKind
  }
  readonly priorityId: string
  readonly playbookId: string | null
  readonly ticketId: string | null
  readonly status: RunStatus
  readonly createdAt: number
  readonly endedAt: number | null
}

export interface PortableSessionRow {
  readonly session: {
    readonly id: string
    readonly displayNumber: number
  }
  readonly runId: string
  readonly persona: string
  readonly startedAt: number
  readonly exitCode: number | null
}

export interface PortableWorkItemRow {
  readonly id: string
  readonly runId: string
  readonly sourcePersona: string
  readonly targetPersona: string
  readonly task: string
  readonly writeScope: readonly string[]
  readonly status: WorkItemStatus
  readonly createdAt: number
}

export interface PortableCommitRow {
  readonly id: string
  readonly runId: string
  readonly workItemId: string | null
  readonly commitSha: string
  readonly message: string
  readonly files: readonly string[]
  readonly createdAt: number
}

export interface PortableEventRow {
  readonly id: string
  readonly runId: string
  readonly type: string
  readonly at: number
  readonly data: JsonValue
}

type JsonlName = 'sessions' | 'workItems' | 'commits' | 'events'

export async function readPortableRun(primaryRoot: string, displayNumber: number, runId: string): Promise<PortableRunFile | null> {
  return readOptionalJson<PortableRunFile>(portableRunPaths(primaryRoot, displayNumber, runId).runFile)
}

export async function readPortableRunById(primaryRoot: string, runId: string): Promise<PortableRunFile | null> {
  const { runsDir } = portableWorkspacePaths(primaryRoot)
  let entries: string[]
  try {
    entries = await readdir(runsDir)
  } catch (error: unknown) {
    if (isMissingFile(error)) return null
    throw error
  }

  for (const name of entries) {
    if (!name.endsWith(`-${runId}`)) continue
    const displayNumber = Number.parseInt(name.slice(0, name.length - runId.length - 1), 10)
    if (!Number.isSafeInteger(displayNumber) || displayNumber < 1) continue
    if (name !== portableRunDirName(displayNumber, runId)) continue
    const run = await readPortableRun(primaryRoot, displayNumber, runId)
    if (run?.run.id === runId) return run
  }
  return null
}

export async function writePortableRun(primaryRoot: string, run: PortableRunFile): Promise<void> {
  await writeJson(portableRunPaths(primaryRoot, run.run.displayNumber, run.run.id).runFile, run)
}

export async function appendPortableSessions(
  primaryRoot: string,
  displayNumber: number,
  runId: string,
  rows: readonly PortableSessionRow[],
): Promise<void> {
  await appendPortableRows(primaryRoot, displayNumber, runId, 'sessions', rows)
}

export function readPortableSessions(primaryRoot: string, displayNumber: number, runId: string): Promise<PortableSessionRow[]> {
  return readPortableRows(primaryRoot, displayNumber, runId, 'sessions')
}

export async function appendPortableWorkItems(
  primaryRoot: string,
  displayNumber: number,
  runId: string,
  rows: readonly PortableWorkItemRow[],
): Promise<void> {
  await appendPortableRows(primaryRoot, displayNumber, runId, 'workItems', rows)
}

export function readPortableWorkItems(primaryRoot: string, displayNumber: number, runId: string): Promise<PortableWorkItemRow[]> {
  return readPortableRows(primaryRoot, displayNumber, runId, 'workItems')
}

export async function appendPortableCommits(
  primaryRoot: string,
  displayNumber: number,
  runId: string,
  rows: readonly PortableCommitRow[],
): Promise<void> {
  await appendPortableRows(primaryRoot, displayNumber, runId, 'commits', rows)
}

export function readPortableCommits(primaryRoot: string, displayNumber: number, runId: string): Promise<PortableCommitRow[]> {
  return readPortableRows(primaryRoot, displayNumber, runId, 'commits')
}

export async function appendPortableEvents(
  primaryRoot: string,
  displayNumber: number,
  runId: string,
  rows: readonly PortableEventRow[],
): Promise<void> {
  await appendPortableRows(primaryRoot, displayNumber, runId, 'events', rows)
}

export function readPortableEvents(primaryRoot: string, displayNumber: number, runId: string): Promise<PortableEventRow[]> {
  return readPortableRows(primaryRoot, displayNumber, runId, 'events')
}

async function appendPortableRows<T>(
  primaryRoot: string,
  displayNumber: number,
  runId: string,
  name: JsonlName,
  rows: readonly T[],
): Promise<void> {
  const path = jsonlPath(primaryRoot, displayNumber, runId, name)
  for (const row of rows) await appendJsonLine(path, row)
}

function readPortableRows<T>(primaryRoot: string, displayNumber: number, runId: string, name: JsonlName): Promise<T[]> {
  return readJsonLines<T>(jsonlPath(primaryRoot, displayNumber, runId, name))
}

function jsonlPath(primaryRoot: string, displayNumber: number, runId: string, name: JsonlName): string {
  const paths = portableRunPaths(primaryRoot, displayNumber, runId)
  if (name === 'sessions') return paths.sessionsFile
  if (name === 'workItems') return paths.workItemsFile
  if (name === 'commits') return paths.commitsFile
  return paths.eventsFile
}
