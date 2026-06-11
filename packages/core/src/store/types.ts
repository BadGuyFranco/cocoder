// Operational data model (ADR-0003). The RunStore port is expressed in DOMAIN types only —
// no node:sqlite types leak across it, so the storage engine (node:sqlite now, better-sqlite3
// or a daemon-served conn later) is swappable. Governance is referenced by stable id
// (workspaceId, priorityId, persona) — never copied (the F1/F4 rule).

export type RunStatus = 'running' | 'completed' | 'pending-scope-decision' | 'pending-landing' | 'failed' | 'stopped'
export type WorkItemStatus = 'open' | 'done' | 'abandoned'

// The branch→trunk integration sub-lifecycle (ADR-0015 §6). ORTHOGONAL to RunStatus:
// RunStatus is authoritative for the founder-facing disposition. `completed` means the accepted
// work is visible on trunk/main; integrationStatus proves how it landed. If atom verification
// passes but branch→trunk integration escalates, RunStatus is `pending-landing` — never completed.
//   pending    — branch created, not yet integrated (the default for every run + all legacy rows)
//   resolving  — a non-fast-forward merge is being resolved by the merge-conflict Play
//   verifying  — the merged tree is in the whole-tree integration verify (§3)
//   merged     — branch landed on trunk (verified)
//   escalated  — integration needs founder attention (semantic divergence, or verify fail-closed);
//                implies RunStatus `pending-landing`, never completed.
export type IntegrationStatus = 'pending' | 'resolving' | 'verifying' | 'merged' | 'escalated'

// A commit_link row discriminator (ADR-0015 §6): an ordinary in-scope atom commit, or the
// branch→trunk merge commit (which has no work_item_id and carries merge_sha + trunk_parent).
export type CommitKind = 'atom' | 'merge'

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
  // Isolated working state (ADR-0015). Durable so a relaunched agent rebinds to the right
  // worktree (§6 crash-resume). Null until the worktree is created at launch; legacy rows
  // (pre-ADR-0015) hydrate to null/'pending'.
  readonly worktreePath: string | null // absolute path to local/worktrees/<runId>
  readonly runBranch: string | null // the run's branch, created from trunk tip at launch
  readonly integrationStatus: IntegrationStatus
}

/** RunStatus is authoritative for run-process terminality; integrationStatus is the orthogonal
 *  branch→trunk sub-state. A run's work is on the shipped line only when BOTH say so. One home
 *  for this predicate so no surface re-derives terminality from two columns (F1/F3/L3). */
export function isFullyLanded(run: Run): boolean {
  return run.status === 'completed' && run.integrationStatus === 'merged'
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

/** Run↔commit linkage is a FIRST-CLASS explicit row (fixes F6) — never path-reconstructed. */
export interface CommitLink {
  readonly id: string
  readonly runId: string
  readonly workItemId: string | null // null for a merge link (a merge has no work item)
  readonly commitSha: string
  readonly message: string
  readonly files: readonly string[]
  readonly createdAt: number
  // ADR-0015 §6 merge linkage. kind='atom' for ordinary commits (the default; legacy rows
  // hydrate to 'atom'); kind='merge' for the branch→trunk merge, which carries the merge SHA
  // and the trunk parent it landed on.
  readonly kind: CommitKind
  readonly mergeSha: string | null
  readonly trunkParent: string | null
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

  createRun(input: { workspaceId: string; priorityId: string }): Run
  setRunStatus(runId: string, status: RunStatus): void
  /** Persist the run's isolated working state once the worktree is created at launch (ADR-0015 §1/§6). */
  setWorktree(runId: string, worktreePath: string, runBranch: string): void
  /** Transition the branch→trunk integration sub-state (ADR-0015 §6). */
  setIntegrationStatus(runId: string, status: IntegrationStatus): void
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
    // ADR-0015 §6: omitted ⇒ 'atom' (back-compat). A 'merge' link carries the merge SHA +
    // trunk parent and has no workItemId.
    kind?: CommitKind
    mergeSha?: string | null
    trunkParent?: string | null
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
