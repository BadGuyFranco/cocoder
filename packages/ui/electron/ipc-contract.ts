// The one typed seam between renderer and main. Channel names + payload types live here and are
// imported by main, preload, AND renderer — so a renamed channel is a compile error, not a runtime
// surprise. Only plain JSON crosses the bridge; auth tokens never appear in any payload (main attaches
// them). Domain types are local to @cocoder/ui (the prompt forbids editing @cocoder/core here).

export const CHANNELS = {
  health: 'oz:health',
  daemonGet: 'oz:daemon:get',
  daemonPost: 'oz:daemon:post',
  daemonPut: 'oz:daemon:put',
  daemonDelete: 'oz:daemon:delete',
  ozEvent: 'oz:event',
  chatSend: 'oz:chat:send',
  personasAssignmentsSave: 'oz:personas:assignments:save',
  prioritiesCreate: 'oz:priorities:create',
  prioritiesReorder: 'oz:priorities:reorder',
  prioritiesOrder: 'oz:priorities:order',
  workspacesUpdate: 'oz:workspaces:update',
  workspacesCreate: 'oz:workspaces:create',
  workspacesDelete: 'oz:workspaces:delete',
  settingsGet: 'oz:settings:get',
  settingsSet: 'oz:settings:set',
} as const

// --- daemon result envelope: errors are DATA, not thrown, so the UI renders 202/409/400 honestly ---
export interface DaemonOk<T> {
  readonly ok: true
  readonly status: number
  readonly data: T
}
export interface DaemonErr {
  readonly ok: false
  readonly status: number
  readonly error: string
}
export type DaemonResult<T> = DaemonOk<T> | DaemonErr

// --- connection / health ---
export type ConnectionState = 'connected' | 'connecting' | 'offline' | 'fixtures'
export interface HealthStatus {
  readonly state: ConnectionState
  readonly sha?: string
  readonly error?: string
}

export interface OzEventHint {
  readonly type: string
  readonly runId?: string
  readonly workspaceId?: string
  readonly ts: string
  readonly status?: string
  readonly disposition?: string
}

// --- domain shapes (wired to the LIVE daemon's actual responses, not assumptions) ---
export interface Workspace {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly roots?: readonly WorkspaceRoot[]
}
export type WorkspaceRole = 'primary' | 'writable' | 'readonly'
export interface WorkspaceRoot {
  readonly name: string
  readonly path: string
  readonly rawPath: string
  readonly role: WorkspaceRole
  readonly description?: string
}
export interface WorkspaceFolder {
  readonly name?: string
  readonly path: string
  readonly role: WorkspaceRole
  readonly description?: string
}
export interface Priority {
  readonly id: string
  readonly title: string
  readonly scopeNarrowing: string | null
  readonly goal: string
}
export type RunStatus = 'running' | 'completed' | 'failed'
export interface RunSummary {
  readonly id: string
  readonly workspaceId: string
  readonly priorityId: string
  readonly status: RunStatus | string
  readonly createdAt: number
  readonly endedAt: number | null
}
export interface RunSession {
  readonly id: string
  readonly runId: string
  readonly persona: string
  readonly sessionRef: string
  readonly startedAt: number
  readonly exitCode: number | null
  readonly deepLinkable: boolean
}
export interface WorkItem {
  readonly id: string
  readonly runId: string
  readonly sourcePersona: string
  readonly targetPersona: string
  readonly task: string
  readonly writeScope: readonly string[]
  readonly status: string
  readonly createdAt: number
}
export interface CommitLink {
  readonly id: string
  readonly runId: string
  readonly workItemId: string
  readonly commitSha: string
  readonly message: string
  readonly files: readonly string[]
  readonly createdAt: number
}
export interface RunEvent {
  readonly id: string
  readonly runId: string
  readonly type: string
  readonly data: Record<string, unknown>
  readonly at: number
}
export interface RunFiles {
  readonly oscarOut: string | null
  readonly oscarErr: string | null
  readonly bobOut: string | null
  readonly bobErr: string | null
  readonly pickup: string | null
  readonly record: string | null
}
export interface RunDiff {
  readonly sha: string
  readonly diff: string
}
export interface RunDetail {
  readonly run: RunSummary
  readonly sessions: readonly RunSession[]
  readonly workItems: readonly WorkItem[]
  readonly commitLinks: readonly CommitLink[]
  readonly events: readonly RunEvent[]
  readonly files: RunFiles
  readonly diffs: readonly RunDiff[]
}
// personas[] is empty in reality; the live data is the assignments map.
export interface PersonaAssignment {
  readonly cli: string
  readonly model: string
  readonly mode?: 'visible' | 'headless'
  readonly enabled?: boolean
  readonly plays?: Record<string, { cli: string; model: string }>
}
export interface Play {
  readonly id: string
  readonly label: string
  readonly kind: 'headless' | 'interactive'
  readonly writeScope: readonly string[]
}
export interface PersonasResponse {
  readonly workspace: Workspace
  readonly personas: readonly { id: string; label: string; role: string }[]
  readonly assignments: Record<string, PersonaAssignment>
}
export interface PlaysResponse {
  readonly workspace: Workspace
  readonly plays: readonly Play[]
}
export interface CliCheckView {
  readonly ok: boolean
  readonly detail: string
}
export interface CliModelsView {
  readonly canEnumerate: boolean
  readonly models: readonly string[]
  readonly detail: string
}
export interface CliRunReadinessView {
  readonly mechanism: string
  readonly flags: readonly string[]
  readonly managesUserConfig: boolean
  readonly detail: string
}
export interface CliView {
  readonly id: string
  readonly tested: boolean
  readonly testedAt: number | null
  readonly install: CliCheckView
  readonly auth: CliCheckView
  readonly models: CliModelsView
  readonly configManaged: CliRunReadinessView
  readonly headlessCapable: boolean
}
export interface ClisResponse {
  readonly clis: readonly CliView[]
}
export interface CliTestResponse {
  readonly cli: CliView
}

// --- chat (slice 1 stub) ---
export interface ChatMessage {
  readonly role: 'founder' | 'oz'
  readonly text: string
  readonly at: number
}
export interface OzChatReply {
  readonly reply: string
  readonly ok: boolean
  readonly command: string
  readonly action?: unknown
}

// --- local settings (slice 7, client-only prefs) ---
export interface Settings {
  readonly pollIntervalMs: number
  readonly defaultWorkspaceId: string | null
}
export const DEFAULT_SETTINGS: Settings = { pollIntervalMs: 2500, defaultWorkspaceId: null }

// --- the typed surface preload exposes on window.oz and the renderer consumes ---
export interface OzApi {
  health(): Promise<HealthStatus>
  daemonGet<T = unknown>(path: string): Promise<DaemonResult<T>>
  daemonPost<T = unknown>(path: string, body?: unknown): Promise<DaemonResult<T>>
  daemonPut<T = unknown>(path: string, body?: unknown): Promise<DaemonResult<T>>
  daemonDelete<T = unknown>(path: string): Promise<DaemonResult<T>>
  onOzEvent?(cb: (event: OzEventHint) => void): () => void
  chatSend(workspaceId: string, text: string): Promise<ChatMessage>
  personasAssignmentsSave(workspaceId: string, assignments: Record<string, PersonaAssignment>): Promise<DaemonResult<Record<string, PersonaAssignment>>>
  prioritiesCreate(workspaceId: string, priority: { title: string; goal?: string }): Promise<DaemonResult<Priority>>
  prioritiesReorder(workspaceId: string, order: readonly string[]): Promise<readonly string[]>
  prioritiesOrder(workspaceId: string): Promise<readonly string[]>
  workspacesUpdate(workspaceId: string, folders: readonly WorkspaceFolder[]): Promise<DaemonResult<Workspace>>
  workspacesCreate(workspaceId: string, folders: readonly WorkspaceFolder[]): Promise<DaemonResult<{ workspace: Workspace; legacyHidden: readonly string[] }>>
  workspacesDelete(workspaceId: string): Promise<DaemonResult<true>>
  settingsGet(): Promise<Settings>
  settingsSet(patch: Partial<Settings>): Promise<Settings>
}
