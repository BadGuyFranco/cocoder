// Operational data model (ADR-0003). The RunStore port is expressed in DOMAIN types only —
// no node:sqlite types leak across it, so the storage engine (node:sqlite now, better-sqlite3
// or a daemon-served conn later) is swappable. Governance is referenced by stable id
// (workspaceId, priorityId, persona) — never copied (the F1/F4 rule).

export type RunStatus = 'running' | 'completed' | 'pending-scope-decision' | 'failed'
export type WorkItemStatus = 'open' | 'done' | 'abandoned'

export interface Workspace {
  readonly id: string // stable slug, e.g. "cocoder"
  readonly path: string // absolute repo path
  readonly name: string
}

export interface Run {
  readonly id: string
  readonly workspaceId: string
  readonly priorityId: string
  readonly status: RunStatus
  readonly createdAt: number // epoch ms
  readonly endedAt: number | null
}

export interface Session {
  readonly id: string
  readonly runId: string
  readonly persona: string // persona id (governance ref)
  readonly sessionRef: string // SessionHost ref id (e.g. cmux surface)
  readonly startedAt: number
  readonly exitCode: number | null
}

export interface WorkItem {
  readonly id: string
  readonly runId: string
  readonly sourcePersona: string
  readonly targetPersona: string
  readonly task: string
  readonly writeScope: readonly string[] // allow-list globs
  readonly status: WorkItemStatus
  readonly createdAt: number
}

/** Run↔commit linkage is a FIRST-CLASS explicit row (fixes F6) — never path-reconstructed. */
export interface CommitLink {
  readonly id: string
  readonly runId: string
  readonly workItemId: string | null
  readonly commitSha: string
  readonly message: string
  readonly files: readonly string[]
  readonly createdAt: number
}

export interface RunEvent {
  readonly id: string
  readonly runId: string
  readonly type: string
  readonly data: unknown // JSON-serialisable
  readonly at: number
}

export interface RunStore {
  upsertWorkspace(ws: Workspace): void

  createRun(input: { workspaceId: string; priorityId: string }): Run
  setRunStatus(runId: string, status: RunStatus): void
  getRun(runId: string): Run | null

  createSession(input: { runId: string; persona: string; sessionRef: string }): Session
  setSessionExit(sessionId: string, exitCode: number): void

  createWorkItem(input: {
    runId: string
    sourcePersona: string
    targetPersona: string
    task: string
    writeScope: readonly string[]
  }): WorkItem
  setWorkItemStatus(workItemId: string, status: WorkItemStatus): void

  recordCommitLink(input: {
    runId: string
    workItemId?: string | null
    commitSha: string
    message: string
    files: readonly string[]
  }): CommitLink

  recordEvent(input: { runId: string; type: string; data?: unknown }): RunEvent

  // Read side — used to render the write-once run receipt (ADR-0003 projection).
  listSessions(runId: string): Session[]
  listWorkItems(runId: string): WorkItem[]
  listCommitLinks(runId: string): CommitLink[]
  listEvents(runId: string): RunEvent[]

  close(): void
}
