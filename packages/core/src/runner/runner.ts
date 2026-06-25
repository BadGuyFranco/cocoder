// The runner (ADR-0004 "runner · launch composition", refined by ADR-0013). No longer one-shot: Oscar
// drives Bob through a MULTI-ATOM loop while the runner watches Bob's live progress (the monitor),
// verifies each atom (ADR-0013 verify gate), commits per atom, and ends on Oscar's own wrap-up decision with a
// resumable pickup brief (continuation; ADR-0002 C1 / F8).
//
//   load → preflight → spawn Oscar + standby Bob (+ optional Deb observer)
//   loop (bounded): await directive → if wrapup, stop
//                   → delegate atom → MONITOR Bob live → verify (gate) → commit per atom → ask next
//   wrap-up: write pickup.md + run record
//
// The verify-gate is load-bearing: an atom's commit runs ONLY on Oscar's `pass` (the orchestrator is the
// quality gate; there is no human backstop). All collaborators are injected (SessionHost, Git, RunStore,
// adapters, IO, the Judge) so the orchestration is unit-testable without real cmux/CLIs/models.
import type { Adapter } from '../adapter/index.js'
import { COCODER_GOVERNANCE_AUTHOR, commitFiles, recordSuccessfulCommit, runCommitGate } from '../commit-gate/index.js'
import type { AuditWriteBoundary, CommitGateResult, Git } from '../commit-gate/index.js'
import type { Priority } from '../priorities/index.js'
import type { PersonaRunMode, PlayAssignment, ResolvedPersona } from '../personas/index.js'
import { dispatchPlay, listEffectivePlays, renderPlayManifest, type DispatchPlayResult, type HeadlessRunInput } from '../plays/index.js'
import type { Play, PlaySources } from '../plays/index.js'
import {
  archiveConfirmationAction,
  closeoutCitesCheckableSignal,
  deriveTicketCloseDecision,
  deriveWrapDisposition,
  deriveWrapupRunStatus,
  formatInvalidFounderCloseoutFallback,
  founderCloseoutFromFirstContractHeading,
  validatePlayOutput,
  type CloseoutLaunchTarget,
  type TicketCloseDecision,
} from '../plays/founder-closeout.js'
import {
  allocatePortableSessionDisplayNumber,
  coCoderRunReference,
  listPortableRunSessions,
  recordPortableRunCreation,
  readPortableRunById,
  runDisplayName,
  writePortableRunHistory,
  type Run,
  type RunStatus,
  type RunStore,
  type Workspace,
} from '../store/index.js'
import { effectiveScope, partitionByScope } from '../write-scope/index.js'
import type { SessionHost } from '../session-host/index.js'
import { exec as execChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RunnerIO } from './io.js'
import { createHeadlessBuilderDriver, createPaneBuilderDriver, type BuilderDriver } from './builder-driver.js'
import { executeAgentStep, type AgentStepActiveAtom, type AgentStepResume } from './agent-step.js'
import {
  FounderHeldError,
  founderStopSignalPath,
  isFounderHeldError,
  readFounderStopSignal,
  readResumeState,
  resumeStatePath,
  writeResumeState,
  type PreDispatchResumeState,
  type ResumeState,
} from './founder-stop.js'
import { parseDirective, type Directive } from './directive.js'
import { declaredOutOfScopeWritePaths } from './dispatch-scope.js'
import { groupLabel as formatGroupLabel, paneLabel, type RunLabelTarget } from './labels.js'
import { type Judge, makeHeuristicJudge, runMonitor } from './monitor.js'
import { createHeadlessOscarDriver, createPaneOscarDriver, type OscarDriver } from './oscar-driver.js'
import { spawnObserver } from './observer.js'
import {
  buildBuilderStandbyPrompt,
  buildArtifactDispatch,
  buildLandingOutcome,
  buildNextOrWrapDispatch,
  buildOrchestratorPrompt,
  buildWrapupDelivery,
  commitMessage,
} from './prompts.js'
import { renderRunRecord } from './record.js'
import { type DebStatus, type RunnerPhase, deriveRunSummary, deriveTerminalProjection, renderDebStatus } from './status.js'
import { captureDebTerminalSnapshot, renderDebTerminalSnapshotMarkdown } from './terminal-snapshot.js'
import { isStopRequestedError } from './stop.js'
import { triageFault, type TriageDeps } from './triage.js'
import {
  PreRunIntegrityError,
  preRunConflictWarnings,
  runPreRunGovernanceChecks,
  type PreRunGovernanceCheck,
  type PreRunIntegrityIssue,
} from './pre-run-integrity.js'

const exec = promisify(execChildProcess)
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Build the per-atom Judge (ADR-0013). Injected so tests use a scripted fake and cli/daemon get the
 *  real heuristic. Tier 1 = a cheap idle/sentinel heuristic; semantic judgment stays at the verify-gate. */
export type MakeJudge = (ctx: { atomIndex: number; doneSentinel: string; task: string }) => Judge

export interface CriterionResult {
  readonly exitCode: number
  readonly output: string
}

export interface UiBundleBuildInput {
  readonly cwd: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

export interface RunnerDeps {
  readonly store: RunStore
  readonly sessionHost: SessionHost
  readonly git: Git
  readonly getAdapter: (cli: string) => Adapter
  readonly io: RunnerIO
  /** Runs a headless Play's command as a captured subprocess (passed through to dispatchPlay).
   *  Default (undefined) spawns the real process; tests inject a fake. */
  readonly runHeadless?: (input: HeadlessRunInput) => Promise<DispatchPlayResult>
  /** How to build the per-atom monitor judge. Defaults to the tier-1 heuristic. */
  readonly makeJudge?: MakeJudge
  /** Executes a loop directive's scripted criterion in the run worktree. Non-zero means "keep iterating". */
  readonly execCriterion?: (command: string, cwd: string) => Promise<CriterionResult>
  /** Rebuilds the launched Oz UI bundle after a run lands packages/ui changes. Tests inject this; the
   *  default runs `pnpm --dir packages/ui build` in the workspace repo. */
  readonly buildUiBundle?: (input: UiBundleBuildInput) => Promise<CriterionResult>
  /** Clock injected for deterministic loop wall-clock budget tests. */
  readonly now?: () => number
  readonly timeouts?: {
    orchestrationMs?: number
    wrapupMs?: number
    buildMs?: number
    pollMs?: number
    monitorCadenceMs?: number
    minNudgeIntervalMs?: number
  }
  /** Loop backstops (deterministic — the bound is the spine's; the "enough" judgment stays Oscar's). */
  readonly limits?: { maxAtoms?: number; maxConsecutiveRejects?: number; stuckAfter?: number }
  readonly log?: (msg: string) => void
  /** Fired synchronously the instant the run row is created (before any await), so a fire-and-forget
   *  caller (the Oz daemon) learns the runId for its 202 response WITHOUT pre-creating a second row. */
  readonly onRunCreated?: (run: Run) => void
  readonly signal?: AbortSignal
}

export interface RunInput {
  readonly workspace: Workspace
  readonly priority: Priority
  readonly oscar: ResolvedPersona
  readonly bob: ResolvedPersona
  readonly deb?: ResolvedPersona
  readonly sharedStandards: string
  /** Engine install home; run worktree dirs live under <engineHome>/local/worktrees for every workspace.
   *  Direct runner callers that omit this retain the historical dogfood shape: engine home == workspace
   *  repo. The daemon always passes this explicitly because it knows the install home. */
  readonly engineHome?: string
  /** runs root; the run dir is <runsRoot>/<runId>. */
  readonly runsRoot: string
  /** Optional founder-provided free-text instruction for this run; not persisted in the store. */
  readonly task?: string | null
  /** Optional compatibility priority id for synthetic targets whose real discriminator is another field. */
  readonly storePriorityId?: string | null
  /** Optional open ticket target; stored on the run row while the synthetic priority drives Oscar. */
  readonly ticketId?: string | null
  /** Display target for the run's cmux group label. Optional so direct callers retain compatibility. */
  readonly target?: RunLabelTarget
  /** A prior run's pickup brief to resume from (ADR-0002 C1 / F8), woven into Oscar's prompt. */
  readonly pickup?: string | null
  /** Resolved wrap-up Play + per-(persona, Play) assignment; when present, the runner dispatches the Play to author closeout. */
  readonly playSources?: PlaySources
  readonly wrapPlay?: Play
  readonly wrapPlayAssignment?: PlayAssignment
  readonly wrapPlayPersonaMode?: PersonaRunMode
  /** Pre-run dirt policy for the FOUNDER's own uncommitted work (founder directive 2026-06-20).
   *  Default (false): the founder is a trusted actor — builder-scope dirt they left in the tree is
   *  snapshotted to its own founder-authored commit and the launch proceeds (never blocked, never lost,
   *  never mixed into an agent's atom commit). True restores the old hard-stop: refuse the launch and make
   *  the founder commit/stash by hand — for shared repos or CI that want a manual gate. Agent governance
   *  (the verify gate, quarantine, write-scope flagging) is unaffected either way. */
  readonly strictPreRunDirt?: boolean
  /** Explicit founder override for fatal pre-run integrity findings. Warnings always proceed. */
  readonly allowPreRunIntegrityErrors?: boolean
  /** Loader-backed checks for governance files the assembled launch will depend on. */
  readonly preRunGovernanceChecks?: readonly PreRunGovernanceCheck[]
  /** Re-enter an existing held run at its durable resume-state marker. Runner-core only; callers choose when to pass it. */
  readonly resumeRunId?: string
}

export interface RunResult {
  readonly runId: string
  readonly status: RunStatus
  readonly ticketCloseDecision: TicketCloseDecision
  /** The last atom's commit sha (or null if nothing committed). */
  readonly committedSha: string | null
  /** Every atom commit sha, in order. */
  readonly committedShas: readonly string[]
  /** All in-scope files committed across atoms. */
  readonly committedFiles: readonly string[]
  /** All out-of-scope files held back across atoms. */
  readonly outOfScope: readonly string[]
  readonly selfCommitted: boolean
  /** Number of atoms delegated (verified or not). */
  readonly atoms: number
  /** The resumable pickup brief path (continuation; F8). */
  readonly pickupPath: string | null
  readonly recordPath: string
}

type PreVerdictAgentStepResume = Extract<AgentStepResume, { readonly park: 'pre-verdict' }>

function readReadyDirective(path: string): Directive | undefined {
  if (!existsSync(path)) return undefined
  try {
    return parseDirective(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function resumeStateAtomNumber(park: ResumeState): number {
  return park.park === 'pre-dispatch' ? park.atomNumber : park.activeAtomNumber
}

export class PreflightError extends Error {
  constructor(persona: string, detail: string) {
    super(`preflight failed for "${persona}": ${detail}`)
    this.name = 'PreflightError'
  }
}

export class MissingObjectiveError extends Error {
  constructor(priorityId: string) {
    super(`priority "${priorityId}" has no Objective — refusing to launch`)
    this.name = 'MissingObjectiveError'
  }
}

/** Thrown for cases a direct-mode run (ADR-0023 §2) genuinely cannot start: a non-git primary root, a
 *  detached HEAD (no branch to commit to), or — only under `strictPreRunDirt` — uncommitted founder WIP
 *  that overlaps the run's commit scope. By default founder WIP is no longer a refusal: it is
 *  snapshotted to the founder's own commit before the run (see the launch guard), so an ordinary launch
 *  is never blocked by the founder's own uncommitted work. Also thrown if a pre-run snapshot itself
 *  fails to commit. */
export class DirtyWorkingTreeError extends Error {
  constructor(repo: string, detail: string) {
    super(`refusing direct-mode launch in "${repo}": ${detail}`)
    this.name = 'DirtyWorkingTreeError'
  }
}

export { PreRunIntegrityError, type PreRunGovernanceCheck, type PreRunIntegrityIssue }

// Interactive sessions are human-watched, so an atom may take many minutes — these are generous
// BACKSTOPS, not tight headless budgets. A dead pane is caught immediately by the monitor's liveness
// check; a timeout only guards a run abandoned with a still-alive pane. Default 4h, matching CoBuilder.
const DEFAULTS = {
  orchestrationMs: 14_400_000,
  wrapupMs: 14_400_000,
  buildMs: 14_400_000,
  pollMs: 1500,
  monitorCadenceMs: 15_000,
  minNudgeIntervalMs: 60_000,
}
const LIMITS = { maxAtoms: 12, maxConsecutiveRejects: 3, stuckAfter: 4 }
const OSCAR_IDLE_NUDGE = "You've gone quiet — write the next directive (or your verify verdict), or wrap up."
const CRITERION_TIMEOUT_MS = 900_000
const UI_BUNDLE_BUILD_COMMAND = 'pnpm --dir packages/ui build'
const MAX_UI_BUILD_OUTPUT = 12_000

const defaultMakeJudge =
  (stuckAfter: number): MakeJudge =>
  ({ doneSentinel }) =>
    makeHeuristicJudge({
      doneSentinel,
      stuckAfter,
      nudge: 'You seem stalled — what is blocking you? Keep going, or say what you need.',
    })

async function defaultExecCriterion(command: string, cwd: string): Promise<CriterionResult> {
  try {
    const result = await exec(command, { cwd, timeout: CRITERION_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
    return { exitCode: 0, output: `${result.stdout}${result.stderr}` }
  } catch (error) {
    const err = error as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown }
    const code = typeof err.code === 'number' ? err.code : 1
    const output = `${typeof err.stdout === 'string' ? err.stdout : ''}${typeof err.stderr === 'string' ? err.stderr : ''}${err.message === undefined ? '' : `\n${String(err.message)}`}`
    return { exitCode: code === 0 ? 1 : code, output }
  }
}

async function defaultBuildUiBundle(input: UiBundleBuildInput): Promise<CriterionResult> {
  try {
    const result = await exec(UI_BUNDLE_BUILD_COMMAND, {
      cwd: input.cwd,
      timeout: input.timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      signal: input.signal,
    })
    return { exitCode: 0, output: `${result.stdout}${result.stderr}` }
  } catch (error) {
    const err = error as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown }
    const code = typeof err.code === 'number' ? err.code : 1
    const output = `${typeof err.stdout === 'string' ? err.stdout : ''}${typeof err.stderr === 'string' ? err.stderr : ''}${err.message === undefined ? '' : `\n${String(err.message)}`}`
    return { exitCode: code === 0 ? 1 : code, output }
  }
}

const isPackagesUiPath = (file: string): boolean => file === 'packages/ui' || file.startsWith('packages/ui/')
const isUiAppPath = (file: string): boolean => file === 'packages/ui/app' || file.startsWith('packages/ui/app/')
const clipped = (text: string, max = MAX_UI_BUILD_OUTPUT): string => (text.length > max ? `${text.slice(0, max)}\n…truncated…` : text)
const PORTABLE_RUN_HISTORY_SCOPE = ['cocoder/workspace.json', 'cocoder/counters.json', 'cocoder/runs/**'] as const
const withPortableRunHistoryScope = (scope: readonly string[]): readonly string[] => [...scope, ...PORTABLE_RUN_HISTORY_SCOPE]

const defaultRunLabelTarget = (input: RunInput): RunLabelTarget => {
  if (input.target) return input.target
  if (input.ticketId) return { type: 'ticket', slug: input.ticketId }
  if (input.priority.id === 'adhoc-session') return { type: 'ad-hoc', slug: input.priority.id }
  return { type: 'priority', slug: input.priority.id }
}

const ONBOARDING_RECON_PATH = 'cocoder/audit/recon.md'
const ONBOARDING_SPEND_APPROVAL_PATH = 'cocoder/audit/spend-approval.json'
const ONBOARDING_SPEND_BLOCK_MESSAGE =
  `recon complete; spend approval required before expensive read — record approval at ${ONBOARDING_SPEND_APPROVAL_PATH}`

function hasValidSpendApproval(worktreePath: string): boolean {
  const path = join(worktreePath, ONBOARDING_SPEND_APPROVAL_PATH)
  if (!existsSync(path)) return false
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return typeof parsed === 'object' && parsed !== null && (parsed as { approved?: unknown }).approved === true
  } catch {
    return false
  }
}

function onboardingSpendBlockMessage(worktreePath: string, auditWriteBoundary: AuditWriteBoundary | undefined): string | null {
  if (auditWriteBoundary === undefined) return null
  if (!existsSync(join(worktreePath, ONBOARDING_RECON_PATH))) return null
  return hasValidSpendApproval(worktreePath) ? null : ONBOARDING_SPEND_BLOCK_MESSAGE
}

const referencedFeedEventTypes = (text: string): readonly string[] => {
  const eventTypes = new Set<string>()
  for (const match of text.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/gi)) {
    const before = text.slice(Math.max(0, match.index - 48), match.index)
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 48)
    if (/\b(?:event|events|feed|status)\b/i.test(`${before} ${after}`)) eventTypes.add(match[1]!.toLowerCase())
  }
  return [...eventTypes]
}

const validateDebNudgeEvidence = (req: { readonly message: string; readonly rationale: string }, status: DebStatus | null): { readonly ok: true } | { readonly ok: false; readonly missingEventTypes: readonly string[] } => {
  const referenced = referencedFeedEventTypes(`${req.message}\n${req.rationale}`)
  if (referenced.length === 0) return { ok: true }
  const recentTypes = new Set((status?.recentEvents ?? []).map((event) => event.type))
  const missingEventTypes = referenced.filter((type) => !recentTypes.has(type))
  return missingEventTypes.length === 0 ? { ok: true } : { ok: false, missingEventTypes }
}

export async function runRun(deps: RunnerDeps, input: RunInput): Promise<RunResult> {
  if (input.priority.objective === null) throw new MissingObjectiveError(input.priority.id)

  const { store, sessionHost, git, getAdapter, io } = deps
  const t = { ...DEFAULTS, ...deps.timeouts }
  const limits = { ...LIMITS, ...deps.limits }
  const makeJudge = deps.makeJudge ?? defaultMakeJudge(limits.stuckAfter)
  const execCriterion = deps.execCriterion ?? defaultExecCriterion
  const buildUiBundle = deps.buildUiBundle ?? defaultBuildUiBundle
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  const { workspace, priority, oscar, bob, deb, sharedStandards, runsRoot } = input
  const engineHome = input.engineHome ?? workspace.path
  const closeoutTarget: CloseoutLaunchTarget = input.ticketId ? 'ticket' : 'priority'

  store.upsertWorkspace(workspace)
  const resumeRunId = input.resumeRunId ?? null
  const existingRun = resumeRunId === null ? null : store.getRun(resumeRunId)
  if (resumeRunId !== null && existingRun === null) throw new Error(`Cannot resume missing run ${resumeRunId}`)
  if (existingRun !== null && existingRun.status !== 'held') throw new Error(`Cannot resume run ${existingRun.id} from status ${existingRun.status}; expected held`)
  const run = existingRun ?? store.createRun({ workspaceId: workspace.id, priorityId: input.storePriorityId ?? priority.id, ticketId: input.ticketId ?? null })
  if (existingRun === null) deps.onRunCreated?.(run) // synchronous, before the first await — the daemon captures runId here
  const runDir = join(runsRoot, run.id)
  await io.ensureRunDir(runDir)
  const resumeState = existingRun === null ? null : await readResumeState(runDir)
  if (existingRun !== null && resumeState === null) throw new Error(`Cannot resume run ${run.id}; missing resume-state.json`)
  if (existingRun === null) {
    store.recordEvent({ runId: run.id, type: 'run-start', data: { priority: priority.id, runDir } })
    log(`run ${run.id} started (priority ${priority.id})`)
  } else {
    if (resumeState === null) throw new Error(`Cannot resume run ${run.id}; missing resume-state.json`)
    log(`run ${run.id} resume requested at ${resumeState.park} atom ${resumeStateAtomNumber(resumeState)}`)
  }

  // Preflight both CLIs — fail fast with a clear reason (kills the F10 mid-run class).
  for (const p of [oscar, bob]) {
    const pf = await getAdapter(p.cli).preflight(p.model)
    store.recordEvent({ runId: run.id, type: 'preflight', data: { persona: p.id, cli: p.cli, ok: pf.ok, checks: pf.checks } })
    if (!pf.ok) {
      store.setRunStatus(run.id, 'failed')
      const failed = pf.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ')
      throw new PreflightError(p.id, failed)
    }
  }

  const scope = effectiveScope(bob.writeScope, priority.scopeNarrowing) // known at launch (constant per run)
  const auditWriteBoundary: AuditWriteBoundary | undefined =
    priority.auditWriteBoundary === undefined ? undefined : { label: priority.id, scope: priority.auditWriteBoundary }

  // Execution context — ONE mode (founder directive 2026-06-15; ADR-0023 supersedes ADR-0015): agents run in
  // the active checkout on the active branch and the commit-gate commits straight onto it, so committed
  // work is on that branch BY CONSTRUCTION and no code path can hold it off-branch. There is no isolation
  // lane, no run worktree, no branch→trunk landing step — and therefore no strand class. If the repo is
  // shared (a GitHub collaboration repo), the founder checks out a feature branch; the engine commits to
  // it and pushes (non-gating, below) — the merge to the shared main is GitHub's PR review, not the engine's.
  const workspaceRepo = workspace.path
  if (!(await git.isGitRepo(workspaceRepo))) {
    store.setRunStatus(run.id, 'failed')
    store.recordEvent({ runId: run.id, type: 'direct-mode-refused', data: { reason: 'not-a-git-repo' } })
    throw new DirtyWorkingTreeError(workspaceRepo, 'primary root is not a git repository - initialize it first (run `git init`)')
  }
  const trunkSha = await git.headSha(workspaceRepo)
  const trunkBranch = await git.currentBranch(workspaceRepo)
  if (trunkBranch === null) {
    store.setRunStatus(run.id, 'failed')
    store.recordEvent({ runId: run.id, type: 'direct-mode-refused', data: { reason: 'detached-head' } })
    throw new DirtyWorkingTreeError(workspaceRepo, 'the checkout is on a detached HEAD; a run needs a branch. Check out a branch first.')
  }
  // Launch guard, SCOPED to the union of everything that will commit this run. FOUNDER vs AGENT (founder
  // directive 2026-06-20): the founder is a TRUSTED actor — their uncommitted work is PRESERVED, never
  // refused and never mixed into an agent's atom commit. Both builder-scope dirt (founder WIP) and
  // governance-only dirt are self-healed with their own pre-run snapshot (ADR-0029 founder-pre-run
  // snapshot lineage, preserving ADR-0024's governance snapshot) before the
  // quarantine baseline, so the whole-tree gate and quarantine only ever see AGENT-produced changes.
  // (Quarantine already excludes dirtyAtStart — line ~1110 — so the old "refuse to protect founder WIP"
  // rationale was stale; the real residual risk was the gate folding founder WIP into an atom commit,
  // which the founder snapshot removes. strictPreRunDirt restores the hard-stop for shared repos / CI.)
  const committingScopes = [scope, oscar.writeScope, deb?.writeScope ?? [], input.wrapPlay?.writeScope ?? [], PORTABLE_RUN_HISTORY_SCOPE].flat()
  const changedAtStart = resumeState === null ? await git.changedFiles(workspaceRepo) : []
  const integrityWarnings = await preRunConflictWarnings(workspaceRepo, changedAtStart)
  for (const warning of integrityWarnings) {
    store.recordEvent({ runId: run.id, type: 'pre-run-integrity-warning', data: warning })
    log(`pre-run integrity warning: ${warning.detail}`)
  }
  const fatalIntegrityIssues = runPreRunGovernanceChecks(input.preRunGovernanceChecks ?? [])
  if (fatalIntegrityIssues.length > 0) {
    store.recordEvent({
      runId: run.id,
      type: input.allowPreRunIntegrityErrors ? 'pre-run-integrity-override' : 'pre-run-integrity-refused',
      data: { issues: fatalIntegrityIssues },
    })
    if (!input.allowPreRunIntegrityErrors) {
      store.setRunStatus(run.id, 'failed')
      throw new PreRunIntegrityError(fatalIntegrityIssues)
    }
    log(`pre-run integrity override: ${fatalIntegrityIssues.map((issue) => issue.detail).join('; ')}`)
  }
  const { inScope: dirtyInScope } = partitionByScope(changedAtStart, committingScopes)
  const { inScope: builderDirt, outOfScope: governanceDirt } = partitionByScope(dirtyInScope, scope)
  let dirtyAtStartFiles = changedAtStart
  if (builderDirt.length > 0) {
    if (input.strictPreRunDirt) {
      store.setRunStatus(run.id, 'failed')
      store.recordEvent({ runId: run.id, type: 'dirty-working-tree', data: { files: dirtyInScope } })
      throw new DirtyWorkingTreeError(
        workspaceRepo,
        `${dirtyInScope.length} uncommitted in-scope file(s) (${dirtyInScope.slice(0, 5).join(', ')}${dirtyInScope.length > 5 ? ', …' : ''}). Commit or stash them first (strictPreRunDirt).`,
      )
    }
    // The founder's own work → their own commit. Omit the author so it lands under the founder's git
    // identity (it is genuinely theirs), distinct from the cocoder-governance author used just below.
    const receipt = await commitFiles(git, workspaceRepo, builderDirt, 'founder: pre-run WIP snapshot')
    if (!receipt.committed || receipt.committedSha === null) {
      store.setRunStatus(run.id, 'failed')
      store.recordEvent({ runId: run.id, type: 'founder-presnapshot-failed', data: { files: builderDirt, reason: receipt.error } })
      throw new DirtyWorkingTreeError(workspaceRepo, `unable to snapshot founder WIP before launch: ${receipt.error ?? 'no commit created'}`)
    }
    store.recordEvent({ runId: run.id, type: 'founder-presnapshot', data: { files: receipt.committedFiles, sha: receipt.committedSha } })
    dirtyAtStartFiles = await git.changedFiles(workspaceRepo)
  }
  if (governanceDirt.length > 0) {
    const receipt = await commitFiles(git, workspaceRepo, governanceDirt, 'governance: pre-run snapshot', COCODER_GOVERNANCE_AUTHOR)
    if (!receipt.committed || receipt.committedSha === null) {
      store.setRunStatus(run.id, 'failed')
      store.recordEvent({ runId: run.id, type: 'governance-presnapshot-failed', data: { files: governanceDirt, reason: receipt.error } })
      throw new DirtyWorkingTreeError(workspaceRepo, `unable to snapshot governance dirt before launch: ${receipt.error ?? 'no commit created'}`)
    }
    store.recordEvent({ runId: run.id, type: 'governance-presnapshot', data: { files: receipt.committedFiles, sha: receipt.committedSha } })
    dirtyAtStartFiles = await git.changedFiles(workspaceRepo)
  }
  let portableRunDisplayNumber: number
  try {
    if (resumeState === null) {
      portableRunDisplayNumber = await recordPortableRunCreation({ primaryRoot: workspace.path, workspace, run })
    } else {
      const portableRun = await readPortableRunById(workspace.path, run.id)
      portableRunDisplayNumber = portableRun?.run.displayNumber ?? (await recordPortableRunCreation({ primaryRoot: workspace.path, workspace, run }))
    }
  } catch (err) {
    store.setRunStatus(run.id, 'failed')
    throw err
  }
  const runDisplay = { id: run.id, displayNumber: portableRunDisplayNumber }
  const runReference = coCoderRunReference(runDisplay)
  const dirtyAtStart = new Set([
    ...dirtyAtStartFiles,
    'cocoder/workspace.json',
    'cocoder/counters.json',
    `cocoder/runs/${portableRunDisplayNumber}-${run.id}/run.json`,
  ])
  // Bound to the active checkout/branch; kept as named locals so the prompts/drivers/observer (which take
  // a cwd + branch name) need no change — they always describe the one real branch the run commits to.
  const worktreePath = workspaceRepo
  const runBranch = trunkBranch
  store.recordEvent({ runId: run.id, type: 'direct-mode', data: { branch: trunkBranch, trunkSha } })
  log(`committing directly to ${trunkBranch} (${trunkSha.slice(0, 8)})`)
  // Display-only cmux workspace label. The grouping key below remains the durable run id.
  const groupLabel = formatGroupLabel({ workspaceName: workspace.name || workspace.id, target: defaultRunLabelTarget(input), run: runDisplay })
  const playSources = input.playSources ?? {
    baseDir: join(engineHome, 'packages', 'personas', 'base', 'plays'),
    deltaDir: join(workspace.path, 'cocoder', 'plays', 'deltas'),
    repoPlayDir: join(workspace.path, 'cocoder', 'plays'),
  }
  const effectivePlays = listEffectivePlays(playSources)
  const oscarPlayManifest = renderPlayManifest(effectivePlays, oscar.id)
  const bobPlayManifest = renderPlayManifest(effectivePlays, bob.id)
  const debPlayManifest = deb ? renderPlayManifest(effectivePlays, deb.id) : '(none)'

  // Spawn Oscar (full loop prompt → writes the first directive), Bob on standby beside it, optional Deb.
  const oscarLaunchPrompt = buildOrchestratorPrompt({
    sharedStandards,
    oscarBody: oscar.body,
    playManifest: oscarPlayManifest,
    priorityId: priority.id,
    priorityTitle: priority.title,
    priorityGoal: priority.goal,
    task: input.task ?? null,
    firstDirectivePath: join(runDir, 'directive-0.json'),
    builderLabel: bob.label,
    builderCli: bob.cli,
    oscarWriteScope: oscar.writeScope,
    runId: run.id,
    runBranch,
    cocoderHome: engineHome,
    pickup: input.pickup ?? null,
  })
  let oscarDriver: OscarDriver
  if (oscar.mode === 'headless') {
    oscarDriver = createHeadlessOscarDriver({
      getAdapter,
      oscar,
      cwd: worktreePath,
      runDir,
      launchPrompt: oscarLaunchPrompt,
      turnPrompt: {
        sharedStandards,
        oscarBody: oscar.body,
        playManifest: oscarPlayManifest,
        priorityTitle: priority.title,
        priorityGoal: priority.goal,
        task: input.task ?? null,
        builderLabel: bob.label,
        builderCli: bob.cli,
        oscarWriteScope: oscar.writeScope,
        runId: run.id,
        runBranch,
      },
      runHeadless: deps.runHeadless,
      signal: deps.signal,
    })
    store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: oscar.id, ref: oscarDriver.refId, mode: 'headless' } })
  } else {
    const oscarCmd = getAdapter(oscar.cli).build({
      persona: oscar.id,
      prompt: oscarLaunchPrompt,
      model: oscar.model,
      cwd: worktreePath,
      outPath: join(runDir, 'oscar.out'),
    })
    const oscarRef = await sessionHost.spawn({
      persona: oscar.id,
      command: oscarCmd.command,
      args: oscarCmd.args,
      cwd: worktreePath,
      group: run.id,
      groupLabel,
      label: paneLabel(oscar),
    })
    oscarDriver = createPaneOscarDriver(sessionHost, oscarRef)
    store.createSession({ runId: run.id, persona: oscar.id, sessionRef: oscarRef.id, workspaceRef: oscarRef.workspaceRef ?? null })
    store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: oscar.id, ref: oscarRef.id } })
  }

  let bobDriver: BuilderDriver
  if (bob.mode === 'headless') {
    bobDriver = createHeadlessBuilderDriver({ getAdapter, bob, cwd: worktreePath, runDir, scope, sharedStandards, playManifest: bobPlayManifest, runBranch, runHeadless: deps.runHeadless, signal: deps.signal })
    store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: bob.id, ref: bobDriver.refId, mode: 'headless' } })
  } else {
    const bobCmd = getAdapter(bob.cli).build({
      persona: bob.id,
      prompt: buildBuilderStandbyPrompt({ sharedStandards, bobBody: bob.body, playManifest: bobPlayManifest, scope, runBranch }),
      model: bob.model,
      cwd: worktreePath,
      outPath: join(runDir, 'bob.out'),
    })
    const bobRef = await sessionHost.spawn({
      persona: bob.id,
      command: bobCmd.command,
      args: bobCmd.args,
      cwd: worktreePath,
      group: run.id, // same workspace as Oscar → splits in beside it (warm, on standby)
      groupLabel,
      label: paneLabel(bob),
    })
    store.createSession({ runId: run.id, persona: bob.id, sessionRef: bobRef.id, workspaceRef: bobRef.workspaceRef ?? null })
    store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: bob.id, ref: bobRef.id } })
    bobDriver = createPaneBuilderDriver(sessionHost, bobRef)
  }
  const debRef = deb
    ? await spawnObserver({ store, sessionHost, getAdapter, run, workspace, priority, task: input.task ?? null, deb, sharedStandards, playManifest: debPlayManifest, runDir, groupLabel, cwd: worktreePath, runBranch })
    : null
  await oscarDriver.show()
  log(`oscar + bob spawned (${oscarDriver.refId}, ${bobDriver.refId}); awaiting first directive, bob on standby`)

  const oscarAlive = (): Promise<boolean> => oscarDriver.alive()
  // Every terminal fault funnels through here: record it, let Deb triage it (if present), then fail. Any
  // commits already made this run are on the active branch (committed by the gate as they happened) — there
  // is no run branch and nothing to strand, so a fault just marks the run failed.
  const fail = async (type: string, message: string, atomIndex: number | null = null): Promise<never> => {
    store.recordEvent({ runId: run.id, type, data: atomIndex !== null ? { message, atom: atomIndex } : { message } })
    await triageFault(triageDeps, type, atomIndex, message)
    store.setRunStatus(run.id, 'failed')
    store.recordEvent({
      runId: run.id,
      type: 'run-end',
      data: { status: 'failed', atoms: atomIndex === null ? n : Math.max(n, atomIndex + 1), committedShas, outOfScope, selfCommitted },
    })
    await refreshStatus('faulted', atomIndex, null, `run failed after ${type}; no WRAP-UP READY artifact will be emitted for this run`)
    try {
      await projectAndCommitPortableRunHistory({ endedAt: now() })
    } catch (err) {
      store.recordEvent({ runId: run.id, type: 'portable-history-commit-failed', data: { message: err instanceof Error ? err.message : String(err) } })
    }
    throw new Error(message)
  }

  const rebuildUiBundleIfNeeded = async (): Promise<void> => {
    const touchedUi = committedFiles.some(isPackagesUiPath)
    if (!touchedUi) return

    const before = new Set(await git.changedFiles(workspaceRepo))
    store.recordEvent({ runId: run.id, type: 'ui-bundle-rebuild-started', data: { command: UI_BUNDLE_BUILD_COMMAND } })
    log(`packages/ui changed; rebuilding launched UI bundle (${UI_BUNDLE_BUILD_COMMAND})`)

    const result = await buildUiBundle({ cwd: workspaceRepo, timeoutMs: t.buildMs, signal: deps.signal })
    if (result.exitCode !== 0) {
      const output = clipped(result.output)
      store.recordEvent({ runId: run.id, type: 'ui-bundle-rebuild-failed', data: { command: UI_BUNDLE_BUILD_COMMAND, exitCode: result.exitCode, output } })
      return await fail('ui-bundle-rebuild-failed', `Oz UI bundle rebuild failed: \`${UI_BUNDLE_BUILD_COMMAND}\` exited ${result.exitCode}.\n${output}`)
    }

    const after = await git.changedFiles(workspaceRepo)
    const newlyChanged = after.filter((file) => !before.has(file))
    const appClobber = newlyChanged.filter(isUiAppPath)
    if (appClobber.length > 0) {
      let restored = false
      let restoreError: string | null = null
      try {
        await git.restoreToHead(workspaceRepo, appClobber)
        restored = true
      } catch (err) {
        restoreError = err instanceof Error ? err.message : String(err)
      }
      store.recordEvent({
        runId: run.id,
        type: 'ui-bundle-rebuild-clobber-blocked',
        data: { command: UI_BUNDLE_BUILD_COMMAND, files: appClobber, restored, restoreError },
      })
      return await fail(
        'ui-bundle-rebuild-clobber-blocked',
        `Oz UI bundle rebuild was blocked because \`${UI_BUNDLE_BUILD_COMMAND}\` dirtied committed app source: ${appClobber.join(', ')}.${restored ? ' The source files were restored to HEAD.' : restoreError ? ` Restore failed: ${restoreError}` : ''}`,
      )
    }

    store.recordEvent({ runId: run.id, type: 'ui-bundle-rebuild-succeeded', data: { command: UI_BUNDLE_BUILD_COMMAND, output: clipped(result.output) } })
  }

  // Deb (tier 2): when present, the runner is her eyes, wakes her on status changes, lets her recommend
  // Oscar-only nudges, and hands her faults to triage. Deb never writes the store directly; the runner
  // records verdicts and gate-commits scoped repairs/tickets. Absent Deb → unchanged behavior.
  const debAlive = async (): Promise<boolean> => (debRef ? (await sessionHost.status(debRef)).state === 'running' : false)
  let faultSeq = 0

  // Runner-owned nudge surfaces (ADR-0016/0017): Deb and Oz write separate request files. Deb's is
  // consumed by the full-run Deb watcher; Oz's is consumed by the Oscar await watchdog. Independent seq
  // counters keep one writer's delivery from consuming the other.
  const debScopes = { oscar: oscar.writeScope, bob: scope, deb: deb?.writeScope ?? [] }
  const debNudgePath = join(runDir, 'deb-nudge.json')
  const ozNudgePath = join(runDir, 'oz-nudge.json')
  let lastDebNudgeSeq = 0
  let lastOzNudgeSeq = 0
  let lastDebWakeKey: string | null = null
  let lastDebWakeAt = Number.NEGATIVE_INFINITY
  let lastDebBoundaryAt = Number.NEGATIVE_INFINITY
  let lastDebStatus: DebStatus | null = null
  type DebWake = { readonly kind: string; readonly detail: string }
  const writeDebEvidence = async (phase: RunnerPhase, activeAtom: number | null, activeTask: string | null, waitCondition: string): Promise<void> => {
    const { json, markdown } = renderDebStatus({ store, runId: run.id, runDisplay, priority, scopes: debScopes, phase, activeAtom, activeTask, waitCondition })
    await io.writeDebStatus(runDir, json, markdown)
    const terminalSnapshot = await captureDebTerminalSnapshot({
      runId: run.id,
      readers: [
        { label: 'oscar', refId: oscarDriver.refId, readScreen: () => oscarDriver.readScreen() },
        { label: 'bob', refId: bobDriver.refId, readScreen: () => bobDriver.readScreen() },
      ],
    })
    await io.writeDebTerminalSnapshot(runDir, terminalSnapshot, renderDebTerminalSnapshotMarkdown(terminalSnapshot))
    lastDebStatus = json
    store.recordEvent({
      runId: run.id,
      type: 'deb-status',
      data: {
        phase,
        activeAtom,
        waitCondition,
        oscar: json.oscar,
        bob: json.bob,
        verify: json.verify,
        watchActive: json.watch.active,
        terminalSnapshot: 'deb-terminal-snapshot.json',
      },
    })
  }
  const recordDebWatchDispatch = (kind: string, detail: string): boolean => {
    if (!debRef) return false
    const key = `${kind}:${detail}`
    if (key === lastDebWakeKey) return false
    lastDebWakeKey = key
    lastDebWakeAt = now()
    store.recordEvent({ runId: run.id, type: 'deb-watch-dispatch', data: { kind, detail } })
    return true
  }
  const sendDebWatch = (kind: string, detail: string): void => {
    if (!debRef) return
    void sessionHost
      .sendInput(
        debRef,
        `DEB WATCH - ${detail}\nRead ${join(runDir, 'deb-terminal-snapshot.json')} for current Oscar/Bob terminal evidence, then ${join(runDir, 'deb-status.json')} for state/timestamps. If you recommend a narrow Oscar intervention, write ${debNudgePath}.`,
      )
      .catch((err: unknown) => {
        store.recordEvent({ runId: run.id, type: 'deb-watch-dispatch-failed', data: { kind, detail, message: err instanceof Error ? err.message : String(err) } })
      })
  }
  const refreshStatus = async (phase: RunnerPhase, activeAtom: number | null, activeTask: string | null, waitCondition: string, wake?: DebWake): Promise<void> => {
    if (!debRef) return // status feed exists only for a Deb-backed run
    try {
      lastDebBoundaryAt = now()
      const shouldWakeDeb = wake === undefined ? false : recordDebWatchDispatch(wake.kind, wake.detail)
      await writeDebEvidence(phase, activeAtom, activeTask, waitCondition)
      if (shouldWakeDeb && wake !== undefined) sendDebWatch(wake.kind, wake.detail)
    } catch {
      /* status is a convenience projection — never let a render hiccup fail the run */
    }
  }

  // The fault/triage funnel + its disposition renderer now live in ./triage.ts (WS5.2). runRun threads
  // its captured state in as an explicit deps record; faultSeq stays a runRun-local mutated through a
  // nextFaultSeq() accessor so the monotonic fault counter survives the extraction. `fail` (below) and
  // the wrapup-format-invalid / max-consecutive-rejects paths all call the extracted triageFault(deps,…).
  const triageDeps: TriageDeps = {
    debRef,
    deb,
    nextFaultSeq: () => faultSeq++,
    refreshStatus,
    store,
    workspace,
    run,
    git,
    worktreePath,
    io,
    runDir,
    sessionHost,
    debAlive,
    auditWriteBoundary,
    runReference,
    runBranch,
    withPortableRunHistoryScope,
    timeouts: t,
    signal: deps.signal,
  }

  let activeAtom: AgentStepActiveAtom | null = null
  let debWatcherStopped = false
  let stopDebWatcherSleep: (() => void) | null = null
  const debWatcherStoppedPromise = new Promise<void>((resolve) => {
    stopDebWatcherSleep = resolve
  })
  let debWatcher: Promise<void> = Promise.resolve()
  const startDebWatcher = (): Promise<void> => {
    if (!debRef || !deb) return Promise.resolve()
    const debWatchTimeoutMs = Math.max(t.orchestrationMs, t.buildMs, t.wrapupMs) * (limits.maxAtoms + 2)
    store.recordEvent({ runId: run.id, type: 'deb-watch-started', data: { target: oscar.id } })
    let pendingDebNudge: { message: string; rationale: string; seq: number } | null = null
    return runMonitor(
      {
        readScreen: async () => {
          if (debWatcherStopped) throw new Error('deb watcher stopped')
          return await oscarDriver.readScreen()
        },
        judge: async () => {
          if (debWatcherStopped) return { state: 'done', note: 'deb watcher stopped' }
          const debReq = await io.readNudgeRequest(debNudgePath)
          if (debReq && debReq.seq > lastDebNudgeSeq) {
            const evidence = validateDebNudgeEvidence(debReq, lastDebStatus)
            if (!evidence.ok) {
              lastDebNudgeSeq = debReq.seq
              pendingDebNudge = null
              store.recordEvent({
                runId: run.id,
                type: 'deb-nudge-rejected',
                data: {
                  seq: debReq.seq,
                  target: debReq.target,
                  reason: 'rationale referenced feed event absent from recent Deb status events',
                  missingEventTypes: evidence.missingEventTypes,
                  recentEventTypes: (lastDebStatus?.recentEvents ?? []).map((event) => event.type),
                },
              })
              return { state: 'progressing', note: `deb nudge seq ${debReq.seq} rejected: missing feed event ${evidence.missingEventTypes.join(', ')}` }
            }
            const lastDebGraceAt = Math.max(lastDebWakeAt, lastDebBoundaryAt)
            if (now() - lastDebGraceAt < t.minNudgeIntervalMs) {
              pendingDebNudge = null
              return { state: 'progressing', note: `deb nudge seq ${debReq.seq} waiting for boundary grace` }
            }
            pendingDebNudge = { message: debReq.message, rationale: debReq.rationale, seq: debReq.seq }
            return { state: 'stuck', note: `deb recommends a nudge (seq ${debReq.seq})`, nudge: debReq.message }
          }
          pendingDebNudge = null
          return { state: 'progressing' }
        },
        isAlive: oscarAlive,
        nudge: (text) => oscarDriver.nudge(text),
        onAssessment: (a) => {
          if (a.state !== 'progressing') {
            store.recordEvent({ runId: run.id, type: 'oscar-monitor-assessment', data: { persona: deb.id, stage: 'watch', atom: activeAtom?.index ?? null, state: a.state, note: a.note ?? null } })
          }
        },
        onNudge: (text) => {
          const authored = pendingDebNudge !== null && text === pendingDebNudge.message ? pendingDebNudge : null
          if (authored) lastDebNudgeSeq = authored.seq
          store.recordEvent({
            runId: run.id,
            type: 'oscar-nudge',
            data: authored
              ? { persona: deb.id, stage: 'watch', atom: activeAtom?.index ?? null, text, source: 'deb', rationale: authored.rationale, seq: authored.seq }
              : { persona: deb.id, stage: 'watch', atom: activeAtom?.index ?? null, text, source: 'deb-watch' },
          })
        },
        sleep: (ms) =>
          Promise.race([
            new Promise<void>((resolve) => {
              setTimeout(resolve, ms)
            }),
            debWatcherStoppedPromise,
          ]),
      },
      { task: `watch Oscar for ${priority.id}`, cadenceMs: t.monitorCadenceMs, timeoutMs: debWatchTimeoutMs, minNudgeIntervalMs: t.minNudgeIntervalMs, signal: deps.signal },
    )
      .then((outcome) => {
        store.recordEvent({ runId: run.id, type: 'deb-watch-stopped', data: { reason: outcome.reason, samples: outcome.samples } })
      })
      .catch((err: unknown) => {
        if (isStopRequestedError(err)) return
        store.recordEvent({ runId: run.id, type: 'deb-watch-error', data: { message: err instanceof Error ? err.message : String(err) } })
      })
  }
  const stopDebWatcher = async (): Promise<void> => {
    debWatcherStopped = true
    stopDebWatcherSleep?.()
    await debWatcher
  }
  type OscarNudgeSource = 'oz' | 'deb'
  const awaitOscarWithNudgeWatchdog = async <T>(
    stage: 'directive' | 'verify',
    atomIndex: number,
    task: string,
    awaitOscar: () => Promise<T>,
  ): Promise<T> => {
    const debPersona = deb?.id
    const hasDebWatcher = debRef !== null && debPersona !== undefined
    const eventPersona = (source: OscarNudgeSource | 'idle'): string => (source === 'oz' ? 'oz' : (debPersona ?? 'deb'))
    const phase: RunnerPhase = stage === 'verify' ? 'verifying' : 'awaiting-directive'

    let stopped = false
    let stopSleep: (() => void) | null = null
    const stoppedPromise = new Promise<void>((resolve) => {
      stopSleep = resolve
    })
    const stop = (): void => {
      stopped = true
      stopSleep?.()
    }
    // The recommendation currently being delivered, if any — set by the judge when it picks up a fresh
    // nudge file, read by onNudge to attribute delivery (vs the generic idle fallback).
    let pendingNudgeReq: { source: OscarNudgeSource; message: string; rationale: string; seq: number } | null = null
    const monitor = runMonitor(
      {
        readScreen: async () => {
          if (stopped) throw new Error('oscar await settled')
          return hasDebWatcher ? await oscarDriver.readScreen() : ''
        },
        judge: async (sample) => {
          if (stopped) return { state: 'done', note: 'oscar await settled' }
          if ((await readFounderStopSignal(runDir)) !== null) {
            return { state: 'done', note: 'founder stop registered' }
          }
          // Oz-authored nudges take priority over the generic idle prompt. Deb-authored nudges are
          // consumed by the full-run Deb watcher so they stay visible during Bob build too.
          const ozReq = await io.readNudgeRequest(ozNudgePath)
          if (ozReq && ozReq.seq > lastOzNudgeSeq) {
            pendingNudgeReq = { source: 'oz', message: ozReq.message, rationale: ozReq.rationale, seq: ozReq.seq }
            return { state: 'stuck', note: `oz recommends a nudge (seq ${ozReq.seq})`, nudge: ozReq.message }
          }
          pendingNudgeReq = null
          if (hasDebWatcher && sample.idleStreak > 0) {
            return { state: 'stuck', note: `no oscar screen change for ${sample.idleStreak} sample(s)`, nudge: OSCAR_IDLE_NUDGE }
          }
          return { state: 'progressing' }
        },
        isAlive: oscarAlive,
        nudge: (text) => oscarDriver.nudge(text),
        onAssessment: (a) => {
          const waitCondition = `awaiting Oscar's ${stage} for atom ${atomIndex}`
          if (a.state !== 'progressing') {
            store.recordEvent({ runId: run.id, type: 'oscar-monitor-assessment', data: { persona: hasDebWatcher ? debPersona : 'oz', stage, atom: atomIndex, state: a.state, note: a.note ?? null } })
          }
          void refreshStatus(phase, atomIndex, task, waitCondition, hasDebWatcher && a.state === 'stuck' ? { kind: 'stall', detail: `${phase} atom ${atomIndex}: ${waitCondition}` } : undefined)
        },
        onNudge: (text) => {
          const authored = pendingNudgeReq !== null && text === pendingNudgeReq.message ? pendingNudgeReq : null
          if (authored?.source === 'oz') lastOzNudgeSeq = authored.seq
          if (authored?.source === 'deb') lastDebNudgeSeq = authored.seq
          const source = authored?.source ?? 'idle'
          store.recordEvent({
            runId: run.id,
            type: 'oscar-nudge',
            data: authored
              ? { persona: eventPersona(authored.source), stage, atom: atomIndex, text, source, rationale: authored.rationale, seq: authored.seq }
              : { persona: eventPersona('idle'), stage, atom: atomIndex, text, source },
          })
        },
        sleep: (ms) =>
          Promise.race([
            new Promise<void>((resolve) => {
              setTimeout(resolve, ms)
            }),
            stoppedPromise,
          ]),
      },
      { task, cadenceMs: t.monitorCadenceMs, timeoutMs: t.orchestrationMs, minNudgeIntervalMs: t.minNudgeIntervalMs, signal: deps.signal },
    ).catch((err: unknown) => {
      if (isStopRequestedError(err)) return
      store.recordEvent({ runId: run.id, type: 'oscar-monitor-error', data: { persona: hasDebWatcher ? debPersona : 'oz', stage, atom: atomIndex, message: err instanceof Error ? err.message : String(err) } })
    })

    try {
      return await awaitOscar()
    } finally {
      stop()
      await monitor
    }
  }

  const preDispatchPark = (atomNumber: number, directivePath: string, directive?: Directive): PreDispatchResumeState => {
    const readyDirective = directive ?? readReadyDirective(directivePath)
    return readyDirective === undefined ? { park: 'pre-dispatch', atomNumber } : { park: 'pre-dispatch', atomNumber, directive: readyDirective }
  }

  const throwIfFounderStopRegistered = async (atomNumber: number, directivePath: string, directive?: Directive): Promise<void> => {
    const signal = await readFounderStopSignal(runDir)
    if (signal !== null) throw new FounderHeldError(preDispatchPark(atomNumber, directivePath, directive))
  }

  const awaitDirectiveOrFounderHold = async (directivePath: string, atomNumber: number): Promise<Directive> => {
    await throwIfFounderStopRegistered(atomNumber, directivePath)
    let settled = false
    let wake = (): void => {}
    const settledPromise = new Promise<void>((resolve) => {
      wake = resolve
    })
    const watchFounderStop = async (): Promise<never> => {
      while (!settled) {
        await throwIfFounderStopRegistered(atomNumber, directivePath)
        await Promise.race([sleep(t.pollMs), settledPromise])
      }
      return await new Promise<never>(() => {})
    }
    try {
      const directive = await Promise.race([
        io.awaitDirective(directivePath, { timeoutMs: t.orchestrationMs, pollMs: t.pollMs, isAlive: oscarAlive, signal: deps.signal }),
        watchFounderStop(),
      ])
      await throwIfFounderStopRegistered(atomNumber, directivePath, directive)
      return directive
    } finally {
      settled = true
      wake()
    }
  }

  // ── The multi-atom loop ───────────────────────────────────────────────────────────────────────
  const lastHeldEnd = resumeState === null
    ? null
    : ([...store.listEvents(run.id)].reverse().find((event) => {
        const data = event.data as { status?: unknown } | null
        return event.type === 'run-end' && data !== null && data.status === 'held'
      })?.data as { committedShas?: unknown; outOfScope?: unknown; selfCommitted?: unknown } | undefined) ?? null
  const committedShas: string[] = Array.isArray(lastHeldEnd?.committedShas) ? lastHeldEnd.committedShas.filter((sha): sha is string => typeof sha === 'string') : []
  const committedFiles: string[] = []
  const outOfScope: string[] = Array.isArray(lastHeldEnd?.outOfScope) ? lastHeldEnd.outOfScope.filter((file): file is string => typeof file === 'string') : []
  let selfCommitted = lastHeldEnd?.selfCommitted === true
  let pickup: string | null = null
  let terminalStatus: RunStatus = 'completed'
  let ticketCloseDecision: TicketCloseDecision = 'none'
  let n = resumeState === null ? 0 : resumeStateAtomNumber(resumeState)
  let pendingResumeState: ResumeState | null = resumeState
  let consecutiveRejects = 0
  debWatcher = startDebWatcher()
  // `dirtyAtStart` (the founder's pre-existing uncommitted edits) was captured at launch from the same
  // single start-of-run snapshot as the guard above. Quarantine must never revert these (data loss) — only
  // the atom's own produced changes. After a passing atom commits, the tree is clean, so that one snapshot
  // covers every later atom's quarantine.

  const absorbGateResult = (gate: CommitGateResult): void => {
    if (gate.committedSha) committedShas.push(gate.committedSha)
    committedFiles.push(...gate.committedFiles)
    // outOfLane is now a pure visibility flag (the paths committed out of lane), unioned across atoms.
    // No more "clear prior holdback" dance — nothing is held back, so there is nothing to clear.
    for (const f of gate.outOfLane) if (!outOfScope.includes(f)) outOfScope.push(f)
    selfCommitted = selfCommitted || gate.selfCommitted
  }

  const clearResumeArtifacts = async (park: ResumeState): Promise<void> => {
    await rm(founderStopSignalPath(runDir), { force: true })
    await rm(resumeStatePath(runDir), { force: true })
    store.setRunStatus(run.id, 'running')
    store.recordEvent({ runId: run.id, type: 'run-resumed', data: { park: park.park, atom: resumeStateAtomNumber(park) } })
    log(`run ${run.id} resumed at ${park.park} atom ${resumeStateAtomNumber(park)}`)
  }

  const stringResumeField = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Cannot resume run ${run.id}; resume-state ${field} must be a non-empty string`)
    return value
  }

  const resumeVerifyRequest = (park: ResumeState): PreVerdictAgentStepResume | undefined => {
    if (park.park !== 'pre-verdict') return undefined
    return {
      park: 'pre-verdict',
      verifyPath: stringResumeField(park.verifyRequest.verifyPath, 'verifyRequest.verifyPath'),
      directivePath: stringResumeField(park.verifyRequest.directivePath, 'verifyRequest.directivePath'),
    }
  }

  const directiveForPreVerdictResume = (park: ResumeState): Extract<Directive, { readonly kind: 'delegate' }> => {
    const verifyResume = resumeVerifyRequest(park)
    const persisted = verifyResume === undefined ? undefined : readReadyDirective(verifyResume.directivePath)
    if (persisted?.kind === 'delegate') return persisted
    const openWorkItem = [...store.listWorkItems(run.id)].reverse().find((item) => item.status === 'open')
    return { kind: 'delegate', task: openWorkItem?.task ?? `resume atom ${resumeStateAtomNumber(park)}` }
  }

  const commitOscarSupport = async (headBefore: string): Promise<CommitGateResult | null> => {
    if (oscar.writeScope.length === 0) return null
    const gate = await runCommitGate({
      git,
      store,
      cwd: worktreePath,
      runId: run.id,
      workItemId: null,
      scope: withPortableRunHistoryScope(oscar.writeScope),
      message: `oscar-support: ${priority.id} via CoCoder run ${runReference}`,
      headBefore,
      auditWriteBoundary,
    })
    absorbGateResult(gate)
    if (gate.committedSha || gate.outOfLane.length > 0 || gate.selfCommitted) {
      store.recordEvent({
        runId: run.id,
        type: 'oscar-support-commit',
        data: { committedSha: gate.committedSha, files: gate.committedFiles, outOfScope: gate.outOfLane, selfCommitted: gate.selfCommitted },
      })
    }
    return gate
  }

  // Non-gating push (founder directive 2026-06-15): after the run settles, push the active branch to its
  // upstream IF one exists. This is the ONLY thing a branch is for — sharing on a remote (e.g. a GitHub
  // collaboration repo). It NEVER gates: a push failure (no remote, offline, rejected) is recorded and the
  // run still reports its real status. The merge to a shared main is GitHub's PR review, not the engine's.
  const pushActiveBranchIfRemote = async (): Promise<void> => {
    try {
      if (!(await git.hasUpstream(workspaceRepo, runBranch))) return
      const res = await git.push(workspaceRepo, runBranch)
      store.recordEvent({ runId: run.id, type: res.ok ? 'branch-pushed' : 'branch-push-failed', data: { branch: runBranch, detail: res.detail } })
      log(res.ok ? `pushed ${runBranch} to upstream` : `push of ${runBranch} failed (non-gating): ${res.detail}`)
    } catch (err) {
      store.recordEvent({ runId: run.id, type: 'branch-push-failed', data: { branch: runBranch, detail: err instanceof Error ? err.message : String(err) } })
    }
  }

  // WS1.3 (runner-decoupling): re-base the portable run-history surface on the event log. The terminal run
  // status the `run.json` surface carries is DERIVED from the `run-end` event every caller records just
  // above — not threaded in from a runner local — so the surface projects ONE source. `endedAt` stays
  // imperative: the `run-end` event's wall-clock `at` differs from the captured `endedAt`, so deriving it
  // would shift the surface (this step is behavior-preserving — no surface may move).
  const projectAndCommitPortableRunHistory = async (terminal: { readonly endedAt: number }): Promise<void> => {
    const summary = deriveRunSummary(store.listEvents(run.id))
    if (!summary) throw new Error(`Cannot project portable run history for ${run.id}: no terminal run-end event`)
    const sessionDisplayNumbers = new Map<string, number>()
    for (const session of listPortableRunSessions(store, run.id)) {
      sessionDisplayNumbers.set(session.id, await allocatePortableSessionDisplayNumber(workspace.path))
    }
    const headBefore = await git.headSha(worktreePath)
    await writePortableRunHistory({
      primaryRoot: workspace.path,
      store,
      run,
      displayNumber: portableRunDisplayNumber,
      sessionDisplayNumbers,
      terminal: { status: summary.status, endedAt: terminal.endedAt },
    })
    const message = `run-history: ${run.id} via CoCoder ${runReference}`
    const files = [
      'cocoder/counters.json',
      'cocoder/workspace.json',
      `cocoder/runs/${portableRunDisplayNumber}-${run.id}/run.json`,
      `cocoder/runs/${portableRunDisplayNumber}-${run.id}/commits.jsonl`,
      `cocoder/runs/${portableRunDisplayNumber}-${run.id}/events.jsonl`,
      `cocoder/runs/${portableRunDisplayNumber}-${run.id}/sessions.jsonl`,
      `cocoder/runs/${portableRunDisplayNumber}-${run.id}/work-items.jsonl`,
    ]
    // Detect a self-commit BEFORE the commit (commitFiles moves HEAD), then centralize the standard
    // success-path recording in the helper (WS3.3). P4 keeps its OWN failure convention — THROW on a spine
    // error — right after the helper: error ⟹ null sha, so the helper records no link/commit before it.
    const headNow = await git.headSha(worktreePath)
    const historySelfCommitted = headNow !== headBefore
    const receipt = await commitFiles(git, worktreePath, files, message, COCODER_GOVERNANCE_AUTHOR)
    recordSuccessfulCommit(store, { runId: run.id, workItemId: null, message, committedSha: receipt.committedSha, committedFiles: receipt.committedFiles, selfCommit: historySelfCommitted ? { headBefore, headNow } : null })
    if (receipt.error) throw new Error(`run-history commit failed: ${receipt.error}`)
    if (historySelfCommitted) selfCommitted = true
  }

  const quarantineAtom = async (atomIndex: number, headBefore: string, selfCommitEvent: string): Promise<void> => {
    // If the atom SELF-committed (HEAD moved under trust-the-CLI), the working-tree quarantine can't
    // undo it — surface that so it isn't silently carried in history.
    if ((await git.headSha(worktreePath)) !== headBefore) {
      store.recordEvent({ runId: run.id, type: selfCommitEvent, data: { atom: atomIndex, headBefore } })
    }
    // QUARANTINE (atom isolation): discard everything THIS rejected atom touched — regardless of scope —
    // so it can't ride into a LATER passing atom's commit (the gate now commits the whole tree, so an
    // out-of-lane edit by a failed atom would otherwise land). A founder's PRE-EXISTING uncommitted edit
    // (dirty at run start) is not the atom's work — exclude it so quarantine never destroys it.
    const produced = (await git.changedFiles(worktreePath)).filter((f) => !dirtyAtStart.has(f))
    if (produced.length === 0) return
    const quarantineDir = join(runDir, 'quarantine', `atom-${atomIndex}`)
    try {
      await git.restoreToHead(worktreePath, produced, { quarantineDir })
      store.recordEvent({
        runId: run.id,
        type: 'atom-quarantined',
        data: { atom: atomIndex, files: produced, quarantineDir, recovery: { tracked: 'HEAD', untracked: quarantineDir } },
      })
    } catch (err) {
      store.recordEvent({ runId: run.id, type: 'atom-quarantine-failed', data: { atom: atomIndex, files: produced, quarantineDir, reason: String(err) } })
    }
  }

  const stopRun = async (): Promise<RunResult> => {
    // A still-running one-shot child must die before quarantine resets the worktree; pane cleanup
    // remains daemon-side after settle.
    if (bobDriver.kind === 'headless') await bobDriver.kill().catch(() => {})
    const stoppedAtom = activeAtom
    const atoms = stoppedAtom ? Math.max(n, stoppedAtom.index + 1) : n
    store.recordEvent({ runId: run.id, type: 'run-stopped', data: { atom: stoppedAtom?.index ?? null } })
    if (stoppedAtom) {
      store.setWorkItemStatus(stoppedAtom.workItemId, 'abandoned')
      await quarantineAtom(stoppedAtom.index, stoppedAtom.headBefore, 'atom-self-committed-stopped')
    }
    const status: RunStatus = 'stopped'
    const endedAt = now()
    await rebuildUiBundleIfNeeded()
    store.recordEvent({
      runId: run.id,
      type: 'run-end',
      data: { status, atoms, committedShas, outOfScope, selfCommitted },
    })
    await projectAndCommitPortableRunHistory({ endedAt })
    store.setRunStatus(run.id, status)
    // Any commits already made are on the active branch; push them (non-gating) so a shared remote sees them.
    await pushActiveBranchIfRemote()
    const recordPath = await io.writeRunRecord(runDir, renderRunRecord(store, run.id, { workspace, priority, displayNumber: portableRunDisplayNumber }))
    // WS1.2: derive the terminal (phase, activeAtom) from the event log so the Deb feed reflects the stop
    // instead of its stale pre-stop phase. Done AFTER portable run-history + record.md are written so neither
    // sibling surface picks up this terminal deb-status event — the feed is the only intended WS1 shift.
    const terminalProjection = deriveTerminalProjection(store.listEvents(run.id))
    if (terminalProjection) await refreshStatus(terminalProjection.phase, terminalProjection.activeAtom, null, 'run stopped')
    log(`run ${run.id} stopped; ${committedShas.length} commit(s) over ${atoms} atom(s); record at ${recordPath}`)
    return {
      runId: run.id,
      status,
      committedSha: committedShas.at(-1) ?? null,
      ticketCloseDecision: 'none',
      committedShas,
      committedFiles,
      outOfScope,
      selfCommitted,
      atoms,
      pickupPath: null,
      recordPath,
    }
  }

  const holdRun = async (park: ResumeState): Promise<RunResult> => {
    const atoms = resumeStateAtomNumber(park) + (park.park === 'pre-dispatch' ? 0 : 1)
    await writeResumeState(runDir, park)
    store.recordEvent({ runId: run.id, type: 'run-held', data: { park: park.park, atom: resumeStateAtomNumber(park) } })
    const status: RunStatus = 'held'
    const endedAt = now()
    await rebuildUiBundleIfNeeded()
    store.recordEvent({
      runId: run.id,
      type: 'run-end',
      data: { status, atoms, committedShas, outOfScope, selfCommitted },
    })
    await projectAndCommitPortableRunHistory({ endedAt })
    store.setRunStatus(run.id, status)
    await pushActiveBranchIfRemote()
    const recordPath = await io.writeRunRecord(runDir, renderRunRecord(store, run.id, { workspace, priority, displayNumber: portableRunDisplayNumber }))
    // WS1.2: derive the terminal (phase, activeAtom) from the event log so the Deb feed reflects the hold
    // instead of its stale pre-hold phase. Done AFTER portable run-history + record.md are written so neither
    // sibling surface picks up this terminal deb-status event — the feed is the only intended WS1 shift.
    const terminalProjection = deriveTerminalProjection(store.listEvents(run.id))
    if (terminalProjection) await refreshStatus(terminalProjection.phase, terminalProjection.activeAtom, null, 'run held; awaiting a founder directive to resume')
    log(`run ${run.id} held; ${committedShas.length} commit(s) over ${atoms} atom(s); record at ${recordPath}`)
    return {
      runId: run.id,
      status,
      committedSha: committedShas.at(-1) ?? null,
      ticketCloseDecision: 'none',
      committedShas,
      committedFiles,
      outOfScope,
      selfCommitted,
      atoms,
      pickupPath: null,
      recordPath,
    }
  }

  try {
    if (pendingResumeState !== null) await clearResumeArtifacts(pendingResumeState)
    await refreshStatus('awaiting-directive', n, null, pendingResumeState === null ? 'awaiting first directive' : `resuming atom ${n}`)

    for (;;) {
    let directivePath = join(runDir, `directive-${n}.json`)
    await refreshStatus('awaiting-directive', n, null, `awaiting directive ${n}`)
    let directive: Directive
    let stepResume: AgentStepResume | undefined
    try {
      if (pendingResumeState?.park === 'pre-dispatch' && pendingResumeState.directive !== undefined) {
        directive = pendingResumeState.directive
        store.recordEvent({ runId: run.id, type: 'directive-resumed', data: { atom: n, park: pendingResumeState.park, directivePath } })
      } else if (pendingResumeState?.park === 'during-exec') {
        directive = pendingResumeState.directive
        stepResume = { park: 'during-exec' }
        store.recordEvent({ runId: run.id, type: 'directive-resumed', data: { atom: n, park: pendingResumeState.park, directivePath } })
      } else if (pendingResumeState?.park === 'pre-verdict') {
        const verifyResume = resumeVerifyRequest(pendingResumeState)
        if (verifyResume === undefined) throw new Error(`Cannot resume run ${run.id}; invalid pre-verdict resume marker`)
        directivePath = verifyResume.directivePath
        directive = directiveForPreVerdictResume(pendingResumeState)
        stepResume = verifyResume
        store.recordEvent({ runId: run.id, type: 'verify-resumed', data: { atom: n, park: pendingResumeState.park, verifyPath: verifyResume.verifyPath, directivePath } })
      } else {
        directive = await awaitOscarWithNudgeWatchdog('directive', n, `awaiting directive ${n}`, () => awaitDirectiveOrFounderHold(directivePath, n))
      }
    } catch (err) {
      if (isFounderHeldError(err)) throw err
      if (isStopRequestedError(err)) throw err
      // First directive failed → tear down the idle standby builder; KEEP Deb alive so she can triage.
      if (n === 0) await bobDriver.kill().catch(() => {})
      return await fail('directive-timeout', String(err), n)
    }
    pendingResumeState = null

    if (directive.kind === 'wrapup') {
      const headBeforeOscarSupport = await git.headSha(worktreePath)
      await commitOscarSupport(headBeforeOscarSupport)
      if (input.wrapPlay && input.wrapPlayAssignment) {
        const task =
          `${runDisplayName(runDisplay)} on priority ${priority.id}. ${n} atom(s) were delegated; commits so far: ${committedShas.join(', ') || 'none'}.\n\n` +
          `Oscar's notes for this wrap-up:\n${directive.pickup ?? ''}`
        const dispatchWrapPlay = async (wrapTask: string, outName: string): Promise<{ candidatePickup: string | null; outPath: string }> => {
          const headBeforeWrap = await git.headSha(worktreePath)
          const outPath = join(runDir, outName)
          const res = await dispatchPlay(
            { sessionHost, getAdapter, runHeadless: deps.runHeadless },
            {
              play: input.wrapPlay!,
              assignment: input.wrapPlayAssignment!,
              personaMode: input.wrapPlayPersonaMode,
              persona: oscar.id,
              task: wrapTask,
              cwd: worktreePath,
              outPath,
              group: run.id,
              timeoutMs: t.wrapupMs,
              signal: deps.signal,
            },
          )
          const wrapGate = await runCommitGate({
            git,
            store,
            cwd: worktreePath,
            runId: run.id,
            workItemId: null,
            scope: withPortableRunHistoryScope(input.wrapPlay!.writeScope),
            message: commitMessage(priority.id, runDisplay, n),
            headBefore: headBeforeWrap,
            auditWriteBoundary,
          })
          absorbGateResult(wrapGate)
          return { candidatePickup: res.output && res.output.trim() ? res.output : (directive.pickup ?? null), outPath }
        }
        let { candidatePickup, outPath: wrapOut } = await dispatchWrapPlay(task, 'wrapup-out.txt')
        let outputValidation = validatePlayOutput({ play: input.wrapPlay, output: candidatePickup, cwd: worktreePath, isTicket: closeoutTarget === 'ticket' })
        if (outputValidation && outputValidation.issues.length > 0) {
          store.recordEvent({ runId: run.id, type: 'wrapup-format-repair-attempt', data: { play: input.wrapPlay.id, issues: outputValidation.issues, outPath: wrapOut } })
          const retryTask = [
            task,
            '',
            'The previous wrap-up output FAILED founder closeout format validation. Repair the same closeout content; do not start over blindly.',
            '',
            'Validation issues:',
            ...outputValidation.issues.map((issue) => `- ${issue}`),
            '',
            'Previous invalid output:',
            candidatePickup ?? '',
          ].join('\n')
          const repairContract = outputValidation.founderCloseoutContract
          ;({ candidatePickup, outPath: wrapOut } = await dispatchWrapPlay(retryTask, 'wrapup-out-retry.txt'))
          if (candidatePickup && repairContract) {
            candidatePickup = founderCloseoutFromFirstContractHeading(candidatePickup, repairContract)
          }
          outputValidation = validatePlayOutput({ play: input.wrapPlay, output: candidatePickup, cwd: worktreePath, isTicket: closeoutTarget === 'ticket' })
        }
        if (outputValidation && outputValidation.issues.length > 0) {
          const contract = outputValidation.founderCloseoutContract
          if (!contract) throw new Error(`Play "${input.wrapPlay.id}" outputValidator "${input.wrapPlay.outputValidator?.ref}" cannot format a founder closeout fallback`)
          store.recordEvent({ runId: run.id, type: 'wrapup-format-invalid', data: { play: input.wrapPlay.id, issues: outputValidation.issues, outPath: wrapOut } })
          pickup = formatInvalidFounderCloseoutFallback({ priorityId: priority.id, ticketId: input.ticketId ?? null, target: closeoutTarget, atoms: n, commits: committedShas, issues: outputValidation.issues, contract })
          terminalStatus = 'failed'
          ticketCloseDecision = 'none'
          await triageFault(triageDeps, 'wrapup-format-invalid', n, `wrap-up Play "${input.wrapPlay.id}" produced malformed founder closeout: ${outputValidation.issues.join('; ')}`)
        } else {
          pickup = candidatePickup
          if (outputValidation?.founderCloseoutContract && pickup) {
            const buildAtoms = store.listEvents(run.id).filter((event) => event.type === 'builder-dispatch').length
            const signal = closeoutCitesCheckableSignal(pickup)
            const disposition = deriveWrapDisposition(pickup, outputValidation.founderCloseoutContract, closeoutTarget)
            const action = archiveConfirmationAction({ workspaceId: workspace.id, runId: run.id, priorityId: priority.id, disposition })
            store.recordEvent({ runId: run.id, type: 'wrap-disposition', data: { disposition, buildAtoms, signal, ...(action ? { action } : {}) } })
            terminalStatus = deriveWrapupRunStatus(pickup, outputValidation.founderCloseoutContract, terminalStatus, closeoutTarget)
            ticketCloseDecision = deriveTicketCloseDecision(pickup, outputValidation.founderCloseoutContract, closeoutTarget)
          }
        }
        store.recordEvent({ runId: run.id, type: 'wrapup', data: { atoms: n, forced: false, play: input.wrapPlay.id } })
        log(`wrap-up play ${input.wrapPlay.id} ran after ${n} atom(s)`)
      } else {
        pickup = directive.pickup
        store.recordEvent({ runId: run.id, type: 'wrapup', data: { atoms: n, forced: false } })
        log(`oscar wrapped up after ${n} atom(s)`)
      }
      await refreshStatus('wrapped', n, null, 'wrap-up prepared; final delivery pending landing outcome')
      break
    }

    // Delegate/monitor/verify/commit one atom. `atomIndex` is this atom's stable 0-based index; `n` is the
    // count of delegated atoms (and the NEXT directive index).
    const atomIndex = n
    if (directive.writePaths !== undefined) {
      const outOfScopeDeclaredPaths = declaredOutOfScopeWritePaths(directive.writePaths, scope)
      if (outOfScopeDeclaredPaths.length > 0) {
        const scopeLabel = scope.length > 0 ? scope.join(', ') : '(read-only)'
        const message = `delegate writePaths out of Bob's effective scope: ${outOfScopeDeclaredPaths.join(', ')}; effective scope: ${scopeLabel}`
        store.recordEvent({
          runId: run.id,
          type: 'builder-scope-conflict',
          data: {
            atom: atomIndex,
            requiredPaths: directive.writePaths,
            outOfScopePaths: outOfScopeDeclaredPaths,
            scope,
            owner: 'deb-triage',
            message,
          },
        })
        await refreshStatus('faulted', atomIndex, directive.task, message)
        log(`atom ${atomIndex} blocked before dispatch: ${message}`)
        return await fail('builder-scope-conflict', message, atomIndex)
      }
    }
    const spendBlockMessage = onboardingSpendBlockMessage(worktreePath, auditWriteBoundary)
    const step = spendBlockMessage === null
      ? await executeAgentStep({
          atomIndex,
          directivePath,
          directive,
          runId: run.id,
          priorityId: priority.id,
          runDisplayNumber: portableRunDisplayNumber,
          oscarId: oscar.id,
          bobId: bob.id,
          runDir,
          worktreePath,
          scope,
          commitScope: withPortableRunHistoryScope(scope),
          auditWriteBoundary,
          store,
          git,
          io,
          bobDriver,
          oscarDriver,
          makeJudge,
          execCriterion,
          awaitOscarWithNudgeWatchdog,
          oscarAlive,
          refreshStatus,
          quarantineAtom,
          absorbGateResult,
          fail,
          setActiveAtom: (atom: AgentStepActiveAtom | null) => {
            activeAtom = atom
          },
          now,
          timeouts: t,
          signal: deps.signal,
          log,
          resume: stepResume,
        })
      : await (async () => {
          store.recordEvent({
            runId: run.id,
            type: 'onboarding-spend-approval-required',
            data: {
              atom: atomIndex,
              message: spendBlockMessage,
              reconPath: ONBOARDING_RECON_PATH,
              approvalPath: ONBOARDING_SPEND_APPROVAL_PATH,
            },
          })
          await refreshStatus('awaiting-founder', atomIndex, directive.task, spendBlockMessage)
          log(`atom ${atomIndex} blocked before dispatch: ${spendBlockMessage}`)
          return { kind: 'blocked' as const, outcomeLine: spendBlockMessage }
        })()
    n += 1
    if (step.kind === 'verified') {
      consecutiveRejects = step.verdict === 'fail' ? consecutiveRejects + 1 : 0
    }

    // Deterministic backstops — the bound is the spine's; the "enough" judgment stays Oscar's.
    if (step.kind === 'verified' && consecutiveRejects >= limits.maxConsecutiveRejects) {
      await triageFault(triageDeps, 'max-consecutive-rejects', atomIndex, step.reason ?? 'repeated rejections') // Deb triages the stuck-loop
      pickup = `Run stopped: ${consecutiveRejects} atoms rejected in a row (last: ${step.reason ?? 'no reason'}). Re-scope the work and start fresh.`
      store.recordEvent({ runId: run.id, type: 'wrapup', data: { atoms: n, forced: true, reason: 'max-consecutive-rejects' } })
      break
    }
    if (n >= limits.maxAtoms) {
      pickup = `Run stopped at the ${limits.maxAtoms}-atom backstop. Continue from here in a fresh session.`
      store.recordEvent({ runId: run.id, type: 'wrapup', data: { atoms: n, forced: true, reason: 'max-atoms' } })
      break
    }

    // Ask Oscar for the next turn (names the exact next directive path — the numbered handshake).
    await throwIfFounderStopRegistered(n, join(runDir, `directive-${n}.json`))
    await oscarDriver.show()
    await oscarDriver.send(buildNextOrWrapDispatch(join(runDir, `directive-${n}.json`), step.outcomeLine))
  }
  } catch (err) {
    await stopDebWatcher()
    if (isFounderHeldError(err)) return await holdRun(err.park)
    if (isStopRequestedError(err)) return await stopRun()
    throw err
  }

  // ── Wrap-up: pickup brief (continuation; F8) + run record ───────────────────────────────────────
  const pickupPath = pickup ? await io.writePickup(runDir, pickup) : null
  await rebuildUiBundleIfNeeded()
  const status: RunStatus = terminalStatus
  const endedAt = now()

  // ── Authoritative outcome ─────────────────────────────────────────────────────────────────────────
  // The founder-facing TRUTH, DERIVED from settled state. Work is on the active branch by construction —
  // there is no separate landing that could fail. Out-of-lane paths were COMMITTED (scope is advisory) and
  // flagged for visibility, never withheld.
  {
    const flagged = outOfScope.length > 0 ? `Committed out-of-lane (flagged, NOT held back): ${outOfScope.join(', ')}.` : 'Nothing out of lane.'
    const nCommits = committedShas.length
    const outcome = `✅ COMMITTED on \`${runBranch}\` — ${nCommits} commit(s) on the active branch (no landing step; work is on the branch by construction). ${flagged}`
    store.recordEvent({ runId: run.id, type: 'landing-outcome', data: { landed: true, status, outOfScope, outcome } })
    if (pickup && pickup.trim() !== '') {
      await io.writeRunArtifact(runDir, 'landing-outcome-delivery.md', buildLandingOutcome(run.id, outcome))
      if (oscarDriver.kind === 'headless') {
        store.recordEvent({ runId: run.id, type: 'wrapup-delivery-skipped', data: { reason: 'headless-oscar' } })
      } else {
        const deliveryPath = await io.writeRunArtifact(runDir, 'wrapup-delivery.md', buildWrapupDelivery(runDisplay, pickup, outcome))
        await oscarDriver.show().catch(() => {})
        await oscarDriver.send(buildArtifactDispatch('WRAP-UP READY', deliveryPath)).catch(() => {})
        store.recordEvent({ runId: run.id, type: 'wrapup-delivery-dispatch', data: { ref: oscarDriver.refId, path: deliveryPath } })
      }
      await refreshStatus('wrapped', n, null, 'wrap-up delivered after landing outcome; Oscar remains reachable for founder questions and in-scope Surface-A edits until explicit teardown')
    }
  }
  await stopDebWatcher()

  store.recordEvent({
    runId: run.id,
    type: 'run-end',
    data: { status, atoms: n, committedShas, outOfScope, selfCommitted },
  })
  await projectAndCommitPortableRunHistory({ endedAt })
  store.setRunStatus(run.id, status)
  // Every atom + Oscar-support + run-history commit already landed on the active branch as it was made
  // (the commit-gate ran with cwd = the active checkout). There is no run branch to integrate, no landing
  // step, and nothing that can strand. Push to a shared remote if one exists (non-gating).
  await pushActiveBranchIfRemote()
  const recordPath = await io.writeRunRecord(runDir, renderRunRecord(store, run.id, { workspace, priority, displayNumber: portableRunDisplayNumber }))
  log(`run ${run.id} ${status}; ${committedShas.length} commit(s) over ${n} atom(s); record at ${recordPath}`)

  return {
    runId: run.id,
    status,
    committedSha: committedShas.at(-1) ?? null,
    ticketCloseDecision,
    committedShas,
    committedFiles,
    outOfScope,
    selfCommitted,
    atoms: n,
    pickupPath,
    recordPath,
  }
}
