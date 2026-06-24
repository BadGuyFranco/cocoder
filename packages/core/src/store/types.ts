// Operational data model (ADR-0003). The RunStore port is expressed in DOMAIN types only —
// no node:sqlite types leak across it, so the storage engine (node:sqlite now, better-sqlite3
// or a daemon-served conn later) is swappable. Governance is referenced by stable id
// (workspaceId, priorityId, persona) — never copied (the F1/F4 rule).

// `pending-scope-decision` was RETIRED (founder directive 2026-06-15): scope is advisory, the spine never
// withholds. The isolation lane + its `pending-landing` / branch→trunk integration sub-lifecycle were
// REMOVED (founder directive 2026-06-15; ADR-0023 supersedes ADR-0015): there is ONE mode — commit straight to
// the checked-out branch, always — so committed work is on that branch by construction and no code path
// can hold it off-branch. There is no strand state for anything to wait on. RunStatus is therefore the
// whole story. ADR-0037 owns the halt vocabulary: `held` means the loop paused mid-flight and resume
// re-enters at the parked atom (non-terminal, panes open); `wrapup` is a logical close where this launch's
// work is complete and resume is a fresh launch; `stopped` is terminal stopRun() (active atom abandoned +
// quarantined); teardown is pane/session lifecycle, never a run disposition.
export type RunStatus = 'running' | 'awaiting-founder' | 'awaiting-archive-confirmation' | 'completed' | 'failed' | 'stopped' | 'held'
export type WorkItemStatus = 'open' | 'done' | 'abandoned'

export interface Workspace {
  readonly id: string // stable slug, e.g. "cocoder"
  readonly path: string // absolute repo path
  readonly name: string
}

export interface Run {
  readonly id: string
  readonly workspaceId: string
  /** `ticketId`/`playbookId` are target discriminators: ticketId wins, then playbookId, then priority.
   *  `priorityId` stays required for SQLite compatibility, but consumers must never infer run kind from it. */
  readonly priorityId: string
  readonly playbookId: string | null
  readonly ticketId: string | null
  readonly status: RunStatus
  readonly createdAt: number // epoch ms
  readonly endedAt: number | null
}

export interface Session {
  readonly id: string
  readonly runId: string
  readonly persona: string // persona id (governance ref)
  readonly sessionRef: string // SessionHost ref id (e.g. cmux surface)
  readonly workspaceRef: string | null // container ref (cmux workspace) — durable for cross-restart close
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

/** Run↔commit linkage is a FIRST-CLASS explicit row (fixes F6) — never path-reconstructed. Every commit
 *  lands directly on the checked-out branch; there is no branch→trunk merge link (the isolation lane that
 *  produced them was removed — founder directive 2026-06-15). */
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

/** A prior triaged fault, projected for cross-run recurrence detection (ADR-0016 §recurrence). Derived
 *  from `fault-triaged` events across a workspace's runs — the durable memory that lets Deb escalate a
 *  fault on its SECOND occurrence instead of logging it as a one-off forever. */
export interface FaultRecord {
  readonly runId: string
  readonly fingerprint: string | null // null for legacy events recorded before fingerprinting
  readonly faultType: string
  readonly disposition: string
  readonly at: number
}

export interface RunStore {
  upsertWorkspace(ws: Workspace): void

  createRun(input: { workspaceId: string; priorityId: string; playbookId?: string | null; ticketId?: string | null }): Run
  setRunStatus(runId: string, status: RunStatus): void
  getRun(runId: string): Run | null
  /** Cross-run read (newest-first), optionally scoped to a workspace (ADR-0003: one WHERE).
   *  Powers Oz's run-list surface and the daemon's startup orphan reconciliation. */
  listRuns(filter?: { workspaceId?: string; limit?: number }): Run[]

  createSession(input: { runId: string; persona: string; sessionRef: string; workspaceRef?: string | null }): Session
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
  /** Cross-run fault memory (ADR-0016 §recurrence): every `fault-triaged` event across a workspace's
   *  runs, newest-last, for recurrence detection. One WHERE (ADR-0003); the runner fingerprints + counts. */
  listFaultHistory(workspaceId: string): FaultRecord[]

  close(): void
}
