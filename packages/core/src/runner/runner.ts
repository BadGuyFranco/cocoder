// The runner (ADR-0004 "runner · launch composition", refined by ADR-0013). No longer one-shot: Oscar
// drives Bob through a MULTI-ATOM loop while the runner watches Bob's live progress (the monitor),
// verifies each atom (ADR-0011), commits per atom, and ends on Oscar's own wrap-up decision with a
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
import { COCODER_GOVERNANCE_AUTHOR, commitFiles, runCommitGate } from '../commit-gate/index.js'
import type { AuditWriteBoundary, CommitGateResult, Git } from '../commit-gate/index.js'
import type { Priority } from '../priorities/index.js'
import type { PersonaRunMode, PlayAssignment, ResolvedPersona } from '../personas/index.js'
import { dispatchPlay, listEffectivePlays, renderPlayManifest, type DispatchPlayResult, type HeadlessRunInput } from '../plays/index.js'
import type { Play, PlaySources } from '../plays/index.js'
import {
  allocatePortableSessionDisplayNumber,
  listPortableRunSessions,
  recordPortableRunCreation,
  writePortableRunHistory,
  type Run,
  type RunStatus,
  type RunStore,
  type Workspace,
} from '../store/index.js'
import { effectiveScope, partitionByScope } from '../write-scope/index.js'
import type { SessionHost, SessionRef } from '../session-host/index.js'
import { exec as execChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RunnerIO } from './io.js'
import { createHeadlessBuilderDriver, createPaneBuilderDriver, type BuilderDriver } from './builder-driver.js'
import { executeAgentStep, type AgentStepActiveAtom } from './agent-step.js'
import { groupLabel as formatGroupLabel, paneLabel, type RunLabelTarget } from './labels.js'
import { type Judge, makeHeuristicJudge, runMonitor } from './monitor.js'
import { createHeadlessOscarDriver, createPaneOscarDriver, type OscarDriver } from './oscar-driver.js'
import { spawnObserver } from './observer.js'
import {
  buildBuilderStandbyPrompt,
  buildArtifactDispatch,
  buildDebTriageDispatch,
  buildLandingOutcome,
  buildNextOrWrapDispatch,
  buildOrchestratorPrompt,
  buildWrapupDelivery,
  commitMessage,
} from './prompts.js'
import { renderRunRecord } from './record.js'
import { type RunnerPhase, renderDebStatus } from './status.js'
import { isStopRequestedError } from './stop.js'
import { faultFingerprint } from './fingerprint.js'
import type { Triage } from './triage.js'

const exec = promisify(execChildProcess)

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
}

export interface RunResult {
  readonly runId: string
  readonly status: RunStatus
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

type FounderCloseoutRole =
  | 'title'
  | 'atomComplete'
  | 'runStatus'
  | 'whatChanged'
  | 'whatRemains'
  | 'nextStep'
  | 'decisionNeeded'
  | 'commitState'
  | 'teardownReadiness'
  | 'judgment'

const FOUNDER_CLOSEOUT_ROLES: readonly FounderCloseoutRole[] = [
  'title',
  'atomComplete',
  'runStatus',
  'whatChanged',
  'whatRemains',
  'nextStep',
  'decisionNeeded',
  'commitState',
  'teardownReadiness',
  'judgment',
]

interface FounderCloseoutContract {
  readonly sections: readonly string[]
  readonly labels: Readonly<Record<FounderCloseoutRole, string>>
  readonly orderedRoles: readonly FounderCloseoutRole[]
  readonly finalLine: string
}

function section(contract: FounderCloseoutContract, role: FounderCloseoutRole): string {
  return contract.labels[role]
}

function founderCloseoutRole(label: string): FounderCloseoutRole | null {
  const normalized = label
    .replace(/\*/g, '')
    .replace(/:/g, '')
    .trim()
    .toLowerCase()
  if (normalized === 'founder completion brief') return 'title'
  if (normalized === 'atom complete') return 'atomComplete'
  if (normalized === 'run status') return 'runStatus'
  if (normalized === 'what changed') return 'whatChanged'
  if (normalized === 'what remains') return 'whatRemains'
  if (normalized === 'recommended next step') return 'nextStep'
  if (normalized === 'founder decision needed') return 'decisionNeeded'
  if (normalized === 'commit state') return 'commitState'
  if (normalized === 'teardown readiness') return 'teardownReadiness'
  if (normalized === 'judgment') return 'judgment'
  return null
}

function parseFounderCloseoutContract(play: Play): FounderCloseoutContract {
  const fences = [...play.body.matchAll(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g)]
  for (const fence of fences) {
    const body = fence[1] ?? ''
    const sections = [...body.matchAll(/^\*\*[^*\n]+?\*\*\s*$/gm)].map((match) => match[0].trim())
    const unknownSections: string[] = []
    const roleEntries = sections.flatMap((label): readonly [FounderCloseoutRole, string][] => {
      const role = founderCloseoutRole(label)
      if (!role) unknownSections.push(label)
      return role ? [[role, label]] : []
    })
    const labels = Object.fromEntries(roleEntries) as Partial<Record<FounderCloseoutRole, string>>
    const missingRoles = FOUNDER_CLOSEOUT_ROLES.filter((role) => !labels[role])
    if (missingRoles.length === unknownSections.length) {
      for (const [index, role] of missingRoles.entries()) {
        labels[role] = unknownSections[index]
      }
    }
    const orderedRoles = sections.flatMap((label): FounderCloseoutRole[] => {
      const role = founderCloseoutRole(label)
      if (role) return [role]
      const fallback = Object.entries(labels).find(([, candidateLabel]) => candidateLabel === label)?.[0] as FounderCloseoutRole | undefined
      return fallback ? [fallback] : []
    })
    const finalLine = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1)
    if (
      labels.title &&
      labels.atomComplete &&
      labels.runStatus &&
      labels.whatChanged &&
      labels.whatRemains &&
      labels.nextStep &&
      labels.decisionNeeded &&
      labels.commitState &&
      labels.teardownReadiness &&
      labels.judgment &&
      finalLine &&
      !finalLine.startsWith('**')
    ) {
      return {
        sections,
        labels: labels as Record<FounderCloseoutRole, string>,
        orderedRoles,
        finalLine,
      }
    }
  }
  throw new Error(`wrap-up Play "${play.id}" does not contain a fenced founder closeout contract`)
}

function founderCloseoutSection(markdown: string, contract: FounderCloseoutContract, section: string): string | null {
  const start = markdown.indexOf(section)
  if (start < 0) return null
  const contentStart = start + section.length
  const nextStarts = contract.sections.map((candidate) => markdown.indexOf(candidate, contentStart)).filter((index) => index >= 0)
  const contentEnd = nextStarts.length > 0 ? Math.min(...nextStarts) : markdown.length
  return markdown.slice(contentStart, contentEnd).trim()
}

function launchableNextIssue(cwd: string, next: string, contract: FounderCloseoutContract): string | null {
  const label = section(contract, 'nextStep')
  const escapedFinal = contract.finalLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const line = next.replace(new RegExp(`\\n*${escapedFinal}\\s*$`, 'i'), '').trim()
  const priority = line.match(/^Priority:\s*`([a-z0-9][a-z0-9-]*)`\s+[-–—]\s+(.+)$/i)
  if (priority) {
    const slug = priority[1]
    const focus = priority[2]?.trim() ?? ''
    if (focus.length < 12) return `${label} priority focus is too vague`
    return existsSync(join(cwd, 'cocoder', 'priorities', `${slug}.md`)) ? null : `${label} priority "${slug}" is not launchable`
  }

  const barePriority = line.match(/^Priority:\s*`([a-z0-9][a-z0-9-]*)`$/i)
  if (barePriority) return `${label} must name the concrete focus after the priority slug`

  const ticket = line.match(/^Ticket:\s*`([0-9]{4})`\s+[-–—]\s+(.+)$/)
  if (ticket) {
    const id = ticket[1]
    const focus = ticket[2]?.trim() ?? ''
    if (focus.length < 12) return `${label} ticket focus is too vague`
    const openDir = join(cwd, 'cocoder', 'tickets', 'open')
    const exists = existsSync(openDir) && readdirSync(openDir).some((file) => file.startsWith(`${id}-`) && file.endsWith('.md'))
    return exists ? null : `${label} ticket "${id}" is not open/ready to run`
  }

  const bareTicket = line.match(/^Ticket:\s*`([0-9]{4})`$/)
  if (bareTicket) return `${label} must name the concrete focus after the ticket id`

  return `${label} must be exactly Priority: \`slug\` — <focus> or Ticket: \`NNNN\` — <focus>`
}

function sentenceCount(text: string): number {
  const matches = text.match(/[.!?](?=\s|$)/g)
  return matches?.length ?? (text.trim() === '' ? 0 : 1)
}

function hasAtomOrImplementationLabel(line: string): boolean {
  const bulletText = line.replace(/^[-*]\s+/, '').trim()
  return (
    /^\*\*[^*\n]+:\*\*/.test(bulletText) ||
    /^(?:atom|item)\s+\d+[a-z]?\b\s*[:(-]/i.test(bulletText) ||
    /^[A-Z]\d+[a-z]?\b\s*[:)-]/.test(bulletText) ||
    /^(?:core|daemon|ui|docs|runner|adapter|ipc)\s+\d+(?:\/\d+)?\b\s*[:(-]/i.test(bulletText)
  )
}

function founderCloseoutFormatIssues(markdown: string, cwd: string, contract: FounderCloseoutContract): string[] {
  const issues: string[] = []
  let priorIndex = -1
  for (const label of contract.sections) {
    const index = markdown.indexOf(label)
    if (index < 0) {
      issues.push(`missing ${label}`)
      continue
    }
    if (index <= priorIndex) issues.push(`${label} is out of order`)
    priorIndex = index
  }
  if (!markdown.trimEnd().endsWith(contract.finalLine)) issues.push(`missing final "${contract.finalLine}" line`)

  const title = section(contract, 'title')
  if (!markdown.trimStart().startsWith(title)) {
    issues.push(`${title} must be first`)
  }

  const whatChangedLabel = section(contract, 'whatChanged')
  const whatChanged = founderCloseoutSection(markdown, contract, whatChangedLabel)
  if (whatChanged && whatChanged.length > 180) issues.push(`${whatChangedLabel} is too long for a founder brief`)
  if (whatChanged && sentenceCount(whatChanged) > 1) issues.push(`${whatChangedLabel} must be one sentence`)
  if (whatChanged && /\b(atom\s+\d+|[0-9a-f]{7,40}|core\s+\d+\/\d+|daemon\s+\d+\/\d+|ui\s+\d+\/\d+)\b/i.test(whatChanged)) {
    issues.push(`${whatChangedLabel} contains ledger/test-matrix detail`)
  }

  const runStatusLabel = section(contract, 'runStatus')
  const runStatus = founderCloseoutSection(markdown, contract, runStatusLabel)
  if (runStatus && /\b(roughly|about|around)?\s*\d+%|\b\d+\s*percent\b/i.test(runStatus)) {
    issues.push(`${runStatusLabel} must not estimate percentage complete`)
  }

  const whatRemainsLabel = section(contract, 'whatRemains')
  const whatRemains = founderCloseoutSection(markdown, contract, whatRemainsLabel)
  if (whatRemains && /^[*-]\s*optional\b/im.test(whatRemains)) {
    issues.push(`${whatRemainsLabel} includes optional work instead of required gaps`)
  }
  if (whatRemains) {
    const bulletLines = whatRemains.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[-*]\s+/.test(line))
    if (bulletLines.length > 3) issues.push(`${whatRemainsLabel} has too many bullets`)
    if (bulletLines.some(hasAtomOrImplementationLabel)) {
      issues.push(`${whatRemainsLabel} contains atom/implementation labels`)
    }
  }

  const nextStepLabel = section(contract, 'nextStep')
  const next = founderCloseoutSection(markdown, contract, nextStepLabel)
  if (next) {
    const escapedFinal = contract.finalLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const nextWithoutStandingBy = next.replace(new RegExp(`\\n*${escapedFinal}\\s*$`, 'i'), '').trim()
    const nonEmptyLines = nextWithoutStandingBy.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (nonEmptyLines.length !== 1) issues.push(`${nextStepLabel} must be exactly one action line`)
    if (/\b(optionally|and\/or)\b/i.test(nextWithoutStandingBy)) issues.push(`${nextStepLabel} must not offer optional or multi-choice actions`)
    const issue = launchableNextIssue(cwd, next, contract)
    if (issue) issues.push(issue)
  }
  return issues
}

export interface PlayOutputValidationInput {
  readonly play: Play
  readonly output: string | null
  readonly cwd: string
}

export interface PlayOutputValidationResult {
  readonly issues: readonly string[]
  readonly founderCloseoutContract?: FounderCloseoutContract
}

type PlayOutputValidatorFn = (input: PlayOutputValidationInput) => PlayOutputValidationResult

const PLAY_OUTPUT_VALIDATORS: Readonly<Partial<Record<string, PlayOutputValidatorFn>>> = {
  'validators/founder-closeout': (input) => {
    const contract = parseFounderCloseoutContract(input.play)
    return {
      issues: input.output ? founderCloseoutFormatIssues(input.output, input.cwd, contract) : ['empty wrap-up output'],
      founderCloseoutContract: contract,
    }
  },
}

export function validatePlayOutput(input: PlayOutputValidationInput): PlayOutputValidationResult | null {
  const ref = input.play.outputValidator?.ref
  if (!ref) return null
  const validator = PLAY_OUTPUT_VALIDATORS[ref]
  if (!validator) throw new Error(`Play "${input.play.id}" declares unknown outputValidator "${ref}"`)
  return validator(input)
}

function formatInvalidFounderCloseoutFallback(input: {
  readonly priorityId: string
  readonly atoms: number
  readonly commits: readonly string[]
  readonly issues: readonly string[]
  readonly contract: FounderCloseoutContract
}): string {
  const issueLines = input.issues.map((issue) => `- ${issue}`).join('\n')
  const commitText = input.commits.length === 0 ? 'No commits were recorded before wrap-up.' : `${input.commits.length} commit(s) were recorded before wrap-up.`
  const content: Record<FounderCloseoutRole, string> = {
    title: '',
    atomComplete: 'No — the closeout brief needs repair before this can be treated as a clean completion.',
    runStatus: 'blocked',
    whatChanged: 'The runner blocked a malformed wrap-up brief instead of delivering a non-template closeout.',
    whatRemains: issueLines,
    nextStep: `Priority: \`${input.priorityId}\` — repair the malformed wrap-up brief`,
    decisionNeeded: 'None.',
    commitState: `${commitText} The runner reports the authoritative commit outcome after this brief.`,
    teardownReadiness: 'Standing by; teardown requires an explicit founder request.',
    judgment: 'The runner preserved the founder-facing template instead of passing through a nonconforming wrap-up.',
  }
  const body = input.contract.orderedRoles
    .map((role) => (role === 'title' ? section(input.contract, role) : `${section(input.contract, role)}\n${content[role]}`))
    .join('\n\n')
  return `${body}\n\n${input.contract.finalLine}`
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

/** A direct-mode run (ADR-0023 §2) refuses to launch when the active checkout has uncommitted changes
 *  that overlap the run's commit scope — committing or quarantining in place could otherwise sweep up or
 *  destroy the founder's WIP. The fix is one of: commit/stash the WIP, or launch with isolation. */
export class DirtyWorkingTreeError extends Error {
  constructor(repo: string, detail: string) {
    super(`refusing direct-mode launch in "${repo}": ${detail}`)
    this.name = 'DirtyWorkingTreeError'
  }
}

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

  store.upsertWorkspace(workspace)
  const run = store.createRun({ workspaceId: workspace.id, priorityId: input.storePriorityId ?? priority.id, ticketId: input.ticketId ?? null })
  deps.onRunCreated?.(run) // synchronous, before the first await — the daemon captures runId here
  const runDir = join(runsRoot, run.id)
  await io.ensureRunDir(runDir)
  store.recordEvent({ runId: run.id, type: 'run-start', data: { priority: priority.id, runDir } })
  log(`run ${run.id} started (priority ${priority.id})`)

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

  // Execution context — ONE mode (founder directive 2026-06-15, correcting ADR-0015/0023): agents run in
  // the active checkout on the active branch and the commit-gate commits straight onto it, so committed
  // work is on that branch BY CONSTRUCTION and no code path can hold it off-branch. There is no isolation
  // lane, no run worktree, no branch→trunk landing step — and therefore no strand class. If the repo is
  // shared (a GitHub collaboration repo), the founder checks out a feature branch; the engine commits to
  // it and pushes (non-gating, below) — the merge to the shared main is GitHub's PR review, not the engine's.
  const workspaceRepo = workspace.path
  const trunkSha = await git.headSha(workspaceRepo)
  const trunkBranch = await git.currentBranch(workspaceRepo)
  if (trunkBranch === null) {
    store.setRunStatus(run.id, 'failed')
    store.recordEvent({ runId: run.id, type: 'direct-mode-refused', data: { reason: 'detached-head' } })
    throw new DirtyWorkingTreeError(workspaceRepo, 'the checkout is on a detached HEAD; a run needs a branch. Check out a branch first.')
  }
  // Launch guard, SCOPED to the union of everything that will commit this run. Builder-scope dirt is
  // still refused because the atom commit-gate/quarantine could sweep up or destroy founder WIP.
  // Governance-only dirt is self-healed with a pre-run snapshot (ADR-0024) before quarantine baseline.
  const committingScopes = [scope, oscar.writeScope, deb?.writeScope ?? [], input.wrapPlay?.writeScope ?? [], PORTABLE_RUN_HISTORY_SCOPE].flat()
  const changedAtStart = await git.changedFiles(workspaceRepo)
  const { inScope: dirtyInScope } = partitionByScope(changedAtStart, committingScopes)
  const { inScope: builderDirt, outOfScope: governanceDirt } = partitionByScope(dirtyInScope, scope)
  if (builderDirt.length > 0) {
    store.setRunStatus(run.id, 'failed')
    store.recordEvent({ runId: run.id, type: 'dirty-working-tree', data: { files: dirtyInScope } })
    throw new DirtyWorkingTreeError(
      workspaceRepo,
      `${dirtyInScope.length} uncommitted in-scope file(s) (${dirtyInScope.slice(0, 5).join(', ')}${dirtyInScope.length > 5 ? ', …' : ''}). Commit or stash them first.`,
    )
  }
  let dirtyAtStartFiles = changedAtStart
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
    portableRunDisplayNumber = await recordPortableRunCreation({ primaryRoot: workspace.path, workspace, run })
  } catch (err) {
    store.setRunStatus(run.id, 'failed')
    throw err
  }
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
  const groupLabel = formatGroupLabel({ workspaceName: workspace.name || workspace.id, target: defaultRunLabelTarget(input), runId: run.id })
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
    await triageFault(type, atomIndex, message)
    store.setRunStatus(run.id, 'failed')
    store.recordEvent({
      runId: run.id,
      type: 'run-end',
      data: { status: 'failed', atoms: atomIndex === null ? n : Math.max(n, atomIndex + 1), committedShas, outOfScope, selfCommitted },
    })
    try {
      await projectAndCommitPortableRunHistory({ status: 'failed', endedAt: now() })
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

  // Deb (tier 2): when present, the runner hands her each fault to triage. She READS the fault context +
  // emits a verdict (she never writes the store or applies a fix); the runner — the single writer
  // (ADR-0003) — records it and surfaces her disposition. Absent Deb → unchanged behavior.
  const debAlive = async (): Promise<boolean> => (debRef ? (await sessionHost.status(debRef)).state === 'running' : false)
  let faultSeq = 0

  // Runner-owned nudge surfaces (ADR-0016/0017): Deb and Oz write separate request files, both delivered
  // by the Oscar watchdog. Independent seq counters keep one writer's delivery from consuming the other.
  const debScopes = { oscar: oscar.writeScope, bob: scope, deb: deb?.writeScope ?? [] }
  const debNudgePath = join(runDir, 'deb-nudge.json')
  const ozNudgePath = join(runDir, 'oz-nudge.json')
  let lastDebNudgeSeq = 0
  let lastOzNudgeSeq = 0
  const refreshStatus = async (phase: RunnerPhase, activeAtom: number | null, activeTask: string | null, waitCondition: string): Promise<void> => {
    if (!debRef) return // status feed exists only for a Deb-backed run
    try {
      const { json, markdown } = renderDebStatus({ store, runId: run.id, priority, scopes: debScopes, phase, activeAtom, activeTask, waitCondition })
      await io.writeDebStatus(runDir, json, markdown)
    } catch {
      /* status is a convenience projection — never let a render hiccup fail the run */
    }
  }

  const renderDisposition = (faultType: string, atomIndex: number | null, v: Triage, gate: CommitGateResult | null, occurrence: number): string => {
    const where = atomIndex !== null ? ` (atom ${atomIndex})` : ''
    const lines = [`# Deb disposition: ${v.disposition}`, '']
    if (occurrence >= 2) lines.push(`> ⚠️ **RECURRENCE (#${occurrence})** — this fault matched ${occurrence - 1} prior run(s) by fingerprint; it is no longer a one-off.`, '')
    lines.push(`- **Fault:** ${faultType}${where}`, `- **Mode:** ${v.mode}`, `- **Summary:** ${v.summary}`, '')
    const isTicket = v.escalation === 'ticket' || v.escalation === 'recommend-priority'
    if (isTicket) {
      lines.push(v.escalation === 'recommend-priority' ? '## Escalation — recommends a NEW priority (needs your approval)' : '## Escalation — tracked follow-up ticket filed', '')
      if (v.ticketId) lines.push(`- **Ticket:** ${v.ticketId} (\`cocoder/tickets/\`)`)
      if (v.diagnosis) lines.push(`- **Diagnosis:** ${v.diagnosis}`)
      if (v.whyCocoderOwned) lines.push(`- **Why CoCoder-owned:** ${v.whyCocoderOwned}`)
      lines.push('')
    } else if (v.disposition === 'cocoder-bug' && v.mode === 'repair') {
      lines.push('## Scoped repair — APPLIED within Deb\'s write-scope', '')
      if (v.diagnosis) lines.push(`- **Diagnosis:** ${v.diagnosis}`)
      if (v.whyCocoderOwned) lines.push(`- **Why CoCoder-owned:** ${v.whyCocoderOwned}`)
      if (v.filesChanged && v.filesChanged.length) lines.push(`- **Files Deb changed:** ${v.filesChanged.join(', ')}`)
      if (v.verification) lines.push(`- **Verification:** ${v.verification}`)
      if (v.remainingRisk) lines.push(`- **Remaining risk:** ${v.remainingRisk}`)
      lines.push('')
    } else if (v.disposition === 'cocoder-bug') {
      lines.push('## Proposed fix — NOT applied; for founder review', '', '```diff', v.proposal ?? '(no diff provided)', '```', '')
    }
    if (gate) {
      if (gate.committedSha) lines.push(`Committed as \`${gate.committedSha}\` (files: ${gate.committedFiles.join(', ') || 'none'}) on branch \`${runBranch}\`. The run still fails — land it from that branch to bring the ${isTicket ? 'ticket' : 'repair'} to trunk.`, '')
      else lines.push('No in-scope changes were committed (nothing within Deb\'s write-scope changed).', '')
      if (gate.outOfScope.length > 0) lines.push(`**Committed out of Deb's lane (flagged, NOT withheld):** ${gate.outOfScope.join(', ')}`, '')
    }
    if (v.disposition === 'repo-bug') lines.push('## For the founder', '', v.summary, '')
    return lines.join('\n')
  }
  const triageFault = async (faultType: string, atomIndex: number | null, message: string): Promise<void> => {
    if (!debRef) return // no Deb on this run → no triage
    const i = faultSeq++
    await refreshStatus('faulted', atomIndex, null, `fault: ${faultType}`)
    try {
      // Cross-run recurrence (ADR-0016 §recurrence): fingerprint this fault + count prior matches across
      // the workspace's runs (the durable memory in the DB). occurrence>=2 → tell Deb to escalate instead
      // of logging another one-off; it is the same fault recurring, not a fresh surprise.
      const fingerprint = faultFingerprint(faultType, message)
      const priorRuns = store.listFaultHistory(workspace.id).filter((f) => f.fingerprint === fingerprint).map((f) => f.runId)
      const occurrence = priorRuns.length + 1
      if (occurrence >= 2) store.recordEvent({ runId: run.id, type: 'fault-recurrence', data: { fault: faultType, fingerprint, occurrence, priorRuns } })

      // Snapshot the worktree HEAD before Deb may edit (repair/ticket) so the commit-gate attributes only
      // her changes and detects any self-commit (ADR-0007).
      const headBeforeRepair = await git.headSha(worktreePath)
      await io.writeFaultContext(join(runDir, `fault-${i}.json`), { fault: faultType, atom: atomIndex, message, fingerprint, occurrence, priorRuns })
      await sessionHost.show(debRef)
      await sessionHost.sendInput(debRef, buildDebTriageDispatch(join(runDir, `fault-${i}.json`), join(runDir, `triage-${i}.json`), occurrence))
      store.recordEvent({ runId: run.id, type: 'triage-dispatch', data: { fault: faultType, atom: atomIndex, occurrence } })
      const verdict = await io.awaitTriage(join(runDir, `triage-${i}.json`), { timeoutMs: t.orchestrationMs, pollMs: t.pollMs, isAlive: debAlive, signal: deps.signal })
      // Record the fingerprint on the triaged event so FUTURE runs match this occurrence (closes the loop).
      store.recordEvent({ runId: run.id, type: 'fault-triaged', data: { fault: faultType, atom: atomIndex, disposition: verdict.disposition, mode: verdict.mode, summary: verdict.summary, fingerprint, occurrence } })
      // REPAIR / ESCALATION (ADR-0016): on a cocoder-bug Deb may have edited files within her write-scope —
      // a scoped fix (repair) and/or a tracked follow-up ticket (escalation). Gate-commit ONLY her in-scope
      // edits — anything outside (incl. target-repo product code) is held back + surfaced (ADR-0007), never
      // silently committed. Deb never rescues the run; the commit lands on the run branch for the founder.
      let gate: CommitGateResult | null = null
      const isRepair = verdict.disposition === 'cocoder-bug' && verdict.mode === 'repair'
      const isTicket = verdict.escalation === 'ticket' || verdict.escalation === 'recommend-priority'
      if (deb && deb.writeScope.length > 0 && (isRepair || isTicket)) {
        const kind = isTicket ? 'escalation' : 'repair'
        gate = await runCommitGate({
          git,
          store,
          cwd: worktreePath,
          runId: run.id,
          workItemId: null,
          scope: withPortableRunHistoryScope(deb.writeScope),
          message: `deb-${kind}: ${faultType}${atomIndex !== null ? ` (atom ${atomIndex})` : ''} occurrence ${occurrence}${verdict.ticketId ? ` → ticket ${verdict.ticketId}` : ''} via CoCoder run ${run.id}`,
          headBefore: headBeforeRepair,
          auditWriteBoundary,
        })
        store.recordEvent({ runId: run.id, type: 'deb-repair', data: { fault: faultType, atom: atomIndex, occurrence, escalation: verdict.escalation ?? null, ticketId: verdict.ticketId ?? null, committedSha: gate.committedSha, files: gate.committedFiles, outOfScope: gate.outOfScope } })
      }
      await io.writeDisposition(runDir, i, renderDisposition(faultType, atomIndex, verdict, gate, occurrence))
    } catch (err) {
      if (isStopRequestedError(err)) throw err
      store.recordEvent({ runId: run.id, type: 'triage-skipped', data: { fault: faultType, reason: err instanceof Error ? err.message : String(err) } })
    }
  }
  type OscarNudgeSource = 'oz' | 'deb'
  const awaitOscarWithNudgeWatchdog = async <T>(
    stage: 'directive' | 'verify',
    atomIndex: number,
    task: string,
    awaitOscar: () => Promise<T>,
  ): Promise<T> => {
    const debPersona = deb?.id
    const hasDebWatchdog = debRef !== null && debPersona !== undefined
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
          return hasDebWatchdog ? await oscarDriver.readScreen() : ''
        },
        judge: async (sample) => {
          if (stopped) return { state: 'done', note: 'oscar await settled' }
          // Authored nudges take priority over the generic idle prompt. Oz outranks Deb for same-sample
          // freshness, and Deb remains pending because its seq is not consumed until actually delivered.
          const ozReq = await io.readNudgeRequest(ozNudgePath)
          if (ozReq && ozReq.seq > lastOzNudgeSeq) {
            pendingNudgeReq = { source: 'oz', message: ozReq.message, rationale: ozReq.rationale, seq: ozReq.seq }
            return { state: 'stuck', note: `oz recommends a nudge (seq ${ozReq.seq})`, nudge: ozReq.message }
          }
          const debReq = hasDebWatchdog ? await io.readNudgeRequest(debNudgePath) : null
          if (debReq && debReq.seq > lastDebNudgeSeq) {
            pendingNudgeReq = { source: 'deb', message: debReq.message, rationale: debReq.rationale, seq: debReq.seq }
            return { state: 'stuck', note: `deb recommends a nudge (seq ${debReq.seq})`, nudge: debReq.message }
          }
          pendingNudgeReq = null
          if (hasDebWatchdog && sample.idleStreak > 0) {
            return { state: 'stuck', note: `no oscar screen change for ${sample.idleStreak} sample(s)`, nudge: OSCAR_IDLE_NUDGE }
          }
          return { state: 'progressing' }
        },
        isAlive: oscarAlive,
        nudge: (text) => oscarDriver.nudge(text),
        onAssessment: (a) => {
          if (a.state !== 'progressing') {
            store.recordEvent({ runId: run.id, type: 'oscar-monitor-assessment', data: { persona: hasDebWatchdog ? debPersona : 'oz', stage, atom: atomIndex, state: a.state, note: a.note ?? null } })
          }
          void refreshStatus(phase, atomIndex, task, `awaiting Oscar's ${stage} for atom ${atomIndex}`)
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
      store.recordEvent({ runId: run.id, type: 'oscar-monitor-error', data: { persona: hasDebWatchdog ? debPersona : 'oz', stage, atom: atomIndex, message: err instanceof Error ? err.message : String(err) } })
    })

    try {
      return await awaitOscar()
    } finally {
      stop()
      await monitor
    }
  }

  // ── The multi-atom loop ───────────────────────────────────────────────────────────────────────
  const committedShas: string[] = []
  const committedFiles: string[] = []
  const outOfScope: string[] = []
  let selfCommitted = false
  let pickup: string | null = null
  let terminalStatus: RunStatus = 'completed'
  let n = 0
  let consecutiveRejects = 0
  let activeAtom: AgentStepActiveAtom | null = null
  // `dirtyAtStart` (the founder's pre-existing uncommitted edits) was captured at launch from the same
  // single start-of-run snapshot as the guard above. Quarantine must never revert these (data loss) — only
  // the atom's own produced changes. After a passing atom commits, the tree is clean, so that one snapshot
  // covers every later atom's quarantine.

  const absorbGateResult = (gate: CommitGateResult): void => {
    if (gate.committedSha) committedShas.push(gate.committedSha)
    committedFiles.push(...gate.committedFiles)
    // outOfScope is now a pure visibility flag (the paths committed out of lane), unioned across atoms.
    // No more "clear prior holdback" dance — nothing is held back, so there is nothing to clear.
    for (const f of gate.outOfScope) if (!outOfScope.includes(f)) outOfScope.push(f)
    selfCommitted = selfCommitted || gate.selfCommitted
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
      message: `oscar-support: ${priority.id} via CoCoder run ${run.id}`,
      headBefore,
      auditWriteBoundary,
    })
    absorbGateResult(gate)
    if (gate.committedSha || gate.outOfScope.length > 0 || gate.selfCommitted) {
      store.recordEvent({
        runId: run.id,
        type: 'oscar-support-commit',
        data: { committedSha: gate.committedSha, files: gate.committedFiles, outOfScope: gate.outOfScope, selfCommitted: gate.selfCommitted },
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

  const projectAndCommitPortableRunHistory = async (terminal: { readonly status: RunStatus; readonly endedAt: number }): Promise<void> => {
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
      terminal,
    })
    const message = `run-history: ${run.id} via CoCoder run ${run.id}`
    const files = [
      'cocoder/counters.json',
      'cocoder/workspace.json',
      `cocoder/runs/${portableRunDisplayNumber}-${run.id}/run.json`,
      `cocoder/runs/${portableRunDisplayNumber}-${run.id}/commits.jsonl`,
      `cocoder/runs/${portableRunDisplayNumber}-${run.id}/events.jsonl`,
      `cocoder/runs/${portableRunDisplayNumber}-${run.id}/sessions.jsonl`,
      `cocoder/runs/${portableRunDisplayNumber}-${run.id}/work-items.jsonl`,
    ]
    const headNow = await git.headSha(worktreePath)
    const historySelfCommitted = headNow !== headBefore
    if (historySelfCommitted) {
      store.recordEvent({ runId: run.id, type: 'agent-self-commit', data: { headBefore, headNow } })
    }
    const receipt = await commitFiles(git, worktreePath, files, message, COCODER_GOVERNANCE_AUTHOR)
    if (receipt.error) throw new Error(`run-history commit failed: ${receipt.error}`)
    if (receipt.committedSha) {
      store.recordCommitLink({ runId: run.id, workItemId: null, commitSha: receipt.committedSha, message, files: receipt.committedFiles })
      store.recordEvent({ runId: run.id, type: 'commit', data: { sha: receipt.committedSha, files: receipt.committedFiles } })
    }
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
    await projectAndCommitPortableRunHistory({ status, endedAt })
    store.setRunStatus(run.id, status)
    // Any commits already made are on the active branch; push them (non-gating) so a shared remote sees them.
    await pushActiveBranchIfRemote()
    const recordPath = await io.writeRunRecord(runDir, renderRunRecord(store, run.id, { workspace, priority }))
    log(`run ${run.id} stopped; ${committedShas.length} commit(s) over ${atoms} atom(s); record at ${recordPath}`)
    return {
      runId: run.id,
      status,
      committedSha: committedShas.at(-1) ?? null,
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
    await refreshStatus('awaiting-directive', 0, null, 'awaiting first directive')

    for (;;) {
    const directivePath = join(runDir, `directive-${n}.json`)
    await refreshStatus('awaiting-directive', n, null, `awaiting directive ${n}`)
    let directive
    try {
      directive = await awaitOscarWithNudgeWatchdog('directive', n, `awaiting directive ${n}`, () =>
        io.awaitDirective(directivePath, { timeoutMs: t.orchestrationMs, pollMs: t.pollMs, isAlive: oscarAlive, signal: deps.signal }),
      )
    } catch (err) {
      if (isStopRequestedError(err)) throw err
      // First directive failed → tear down the idle standby builder; KEEP Deb alive so she can triage.
      if (n === 0) await bobDriver.kill().catch(() => {})
      return await fail('directive-timeout', String(err), n)
    }

    if (directive.kind === 'wrapup') {
      const headBeforeOscarSupport = await git.headSha(worktreePath)
      await commitOscarSupport(headBeforeOscarSupport)
      if (input.wrapPlay && input.wrapPlayAssignment) {
        const headBeforeWrap = await git.headSha(worktreePath)
        const task =
          `Run ${run.id} on priority ${priority.id}. ${n} atom(s) were delegated; commits so far: ${committedShas.join(', ') || 'none'}.\n\n` +
          `Oscar's notes for this wrap-up:\n${directive.pickup ?? ''}`
        const wrapOut = join(runDir, 'wrapup-out.txt')
        const res = await dispatchPlay(
          { sessionHost, getAdapter, runHeadless: deps.runHeadless },
          {
            play: input.wrapPlay,
            assignment: input.wrapPlayAssignment,
            personaMode: input.wrapPlayPersonaMode,
            persona: oscar.id,
            task,
            cwd: worktreePath,
            outPath: wrapOut,
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
          scope: withPortableRunHistoryScope(input.wrapPlay.writeScope),
          message: commitMessage(priority.id, run.id, n),
          headBefore: headBeforeWrap,
          auditWriteBoundary,
        })
        absorbGateResult(wrapGate)
        const candidatePickup = res.output && res.output.trim() ? res.output : (directive.pickup ?? null)
        const outputValidation = validatePlayOutput({ play: input.wrapPlay, output: candidatePickup, cwd: worktreePath })
        if (outputValidation && outputValidation.issues.length > 0) {
          const contract = outputValidation.founderCloseoutContract
          if (!contract) throw new Error(`Play "${input.wrapPlay.id}" outputValidator "${input.wrapPlay.outputValidator?.ref}" cannot format a founder closeout fallback`)
          store.recordEvent({ runId: run.id, type: 'wrapup-format-invalid', data: { play: input.wrapPlay.id, issues: outputValidation.issues, outPath: wrapOut } })
          pickup = formatInvalidFounderCloseoutFallback({ priorityId: priority.id, atoms: n, commits: committedShas, issues: outputValidation.issues, contract })
          terminalStatus = 'failed'
          await triageFault('wrapup-format-invalid', n, `wrap-up Play "${input.wrapPlay.id}" produced malformed founder closeout: ${outputValidation.issues.join('; ')}`)
        } else {
          pickup = candidatePickup
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
    const step = await executeAgentStep({
      atomIndex,
      directivePath,
      directive,
      runId: run.id,
      priorityId: priority.id,
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
    })
    n += 1
    if (step.kind === 'verified') {
      consecutiveRejects = step.verdict === 'fail' ? consecutiveRejects + 1 : 0
    }

    // Deterministic backstops — the bound is the spine's; the "enough" judgment stays Oscar's.
    if (step.kind === 'verified' && consecutiveRejects >= limits.maxConsecutiveRejects) {
      await triageFault('max-consecutive-rejects', atomIndex, step.reason ?? 'repeated rejections') // Deb triages the stuck-loop
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
    await oscarDriver.show()
    await oscarDriver.send(buildNextOrWrapDispatch(join(runDir, `directive-${n}.json`), step.outcomeLine))
  }
  } catch (err) {
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
        const deliveryPath = await io.writeRunArtifact(runDir, 'wrapup-delivery.md', buildWrapupDelivery(run.id, pickup, outcome))
        await oscarDriver.show().catch(() => {})
        await oscarDriver.send(buildArtifactDispatch('WRAP-UP READY', deliveryPath)).catch(() => {})
        store.recordEvent({ runId: run.id, type: 'wrapup-delivery-dispatch', data: { ref: oscarDriver.refId, path: deliveryPath } })
      }
      await refreshStatus('wrapped', n, null, 'wrap-up delivered after landing outcome; Oscar remains reachable for founder questions and in-scope Surface-A edits until explicit teardown')
    }
  }

  store.recordEvent({
    runId: run.id,
    type: 'run-end',
    data: { status, atoms: n, committedShas, outOfScope, selfCommitted },
  })
  await projectAndCommitPortableRunHistory({ status, endedAt })
  store.setRunStatus(run.id, status)
  // Every atom + Oscar-support + run-history commit already landed on the active branch as it was made
  // (the commit-gate ran with cwd = the active checkout). There is no run branch to integrate, no landing
  // step, and nothing that can strand. Push to a shared remote if one exists (non-gating).
  await pushActiveBranchIfRemote()
  const recordPath = await io.writeRunRecord(runDir, renderRunRecord(store, run.id, { workspace, priority }))
  log(`run ${run.id} ${status}; ${committedShas.length} commit(s) over ${n} atom(s); record at ${recordPath}`)

  return {
    runId: run.id,
    status,
    committedSha: committedShas.at(-1) ?? null,
    committedShas,
    committedFiles,
    outOfScope,
    selfCommitted,
    atoms: n,
    pickupPath,
    recordPath,
  }
}
