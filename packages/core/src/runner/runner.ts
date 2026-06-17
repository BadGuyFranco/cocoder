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
import type { Git } from '../commit-gate/index.js'
import type { Priority } from '../priorities/index.js'
import type { PersonaRunMode, PlayAssignment, ResolvedPersona } from '../personas/index.js'
import { dispatchPlay, type DispatchPlayResult, type HeadlessRunInput } from '../plays/index.js'
import type { Play } from '../plays/index.js'
import type { Run, RunStatus, RunStore, Workspace } from '../store/index.js'
import { effectiveScope, partitionByScope } from '../write-scope/index.js'
import type { SessionHost, SessionRef } from '../session-host/index.js'
import { exec as execChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RunnerIO } from './io.js'
import { createHeadlessBuilderDriver, createPaneBuilderDriver, type BuilderDriver } from './builder-driver.js'
import { paneLabel } from './labels.js'
import { readLoopLedger, type LoopLedgerEntry } from './loop-ledger.js'
import { type Judge, makeHeuristicJudge, runMonitor } from './monitor.js'
import { createHeadlessOscarDriver, createPaneOscarDriver, type OscarDriver } from './oscar-driver.js'
import { spawnObserver } from './observer.js'
import {
  atomSentinel,
  buildBuilderDispatch,
  buildBuilderStandbyPrompt,
  buildDebTriageDispatch,
  buildLandingOutcome,
  buildNextOrWrapDispatch,
  buildOrchestratorPrompt,
  buildVerifyDispatch,
  buildWrapupDelivery,
  commitMessage,
} from './prompts.js'
import { renderRunRecord } from './record.js'
import { type RunnerPhase, renderDebStatus } from './status.js'
import { isStopRequestedError } from './stop.js'
import { faultFingerprint } from './fingerprint.js'
import type { CommitGateResult } from '../commit-gate/index.js'
import type { Triage } from './triage.js'

const exec = promisify(execChildProcess)

/** Build the per-atom Judge (ADR-0013). Injected so tests use a scripted fake and cli/daemon get the
 *  real heuristic. Tier 1 = a cheap idle/sentinel heuristic; semantic judgment stays at the verify-gate. */
export type MakeJudge = (ctx: { atomIndex: number; doneSentinel: string; task: string }) => Judge

export interface CriterionResult {
  readonly exitCode: number
  readonly output: string
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
  /** A prior run's pickup brief to resume from (ADR-0002 C1 / F8), woven into Oscar's prompt. */
  readonly pickup?: string | null
  /** Resolved wrap-up Play + per-(persona, Play) assignment; when present, the runner dispatches the Play to author closeout. */
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
const OUTPUT_TAIL_CHARS = 2_000

const defaultMakeJudge =
  (stuckAfter: number): MakeJudge =>
  ({ doneSentinel }) =>
    makeHeuristicJudge({
      doneSentinel,
      stuckAfter,
      nudge: 'You seem stalled — what is blocking you? Keep going, or say what you need.',
    })

const outputTail = (output: string): string => (output.length <= OUTPUT_TAIL_CHARS ? output : output.slice(-OUTPUT_TAIL_CHARS))

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

export async function runRun(deps: RunnerDeps, input: RunInput): Promise<RunResult> {
  if (input.priority.objective === null) throw new MissingObjectiveError(input.priority.id)

  const { store, sessionHost, git, getAdapter, io } = deps
  const t = { ...DEFAULTS, ...deps.timeouts }
  const limits = { ...LIMITS, ...deps.limits }
  const makeJudge = deps.makeJudge ?? defaultMakeJudge(limits.stuckAfter)
  const execCriterion = deps.execCriterion ?? defaultExecCriterion
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  const { workspace, priority, oscar, bob, deb, sharedStandards, runsRoot } = input
  const engineHome = input.engineHome ?? workspace.path

  store.upsertWorkspace(workspace)
  const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
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
  const committingScopes = [scope, oscar.writeScope, deb?.writeScope ?? [], input.wrapPlay?.writeScope ?? []].flat()
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
  const dirtyAtStart = new Set(dirtyAtStartFiles)
  // Bound to the active checkout/branch; kept as named locals so the prompts/drivers/observer (which take
  // a cwd + branch name) need no change — they always describe the one real branch the run commits to.
  const worktreePath = workspaceRepo
  const runBranch = trunkBranch
  store.recordEvent({ runId: run.id, type: 'direct-mode', data: { branch: trunkBranch, trunkSha } })
  log(`committing directly to ${trunkBranch} (${trunkSha.slice(0, 8)})`)
  // The run's cmux workspace is named for the run: "<priority> #<session number>" (the numeric part of
  // the sequential run id), so the founder identifies it by priority + session, not by a persona.
  const groupLabel = `${priority.id} #${run.id.replace(/^run_/, '')}`

  // Spawn Oscar (full loop prompt → writes the first directive), Bob on standby beside it, optional Deb.
  const oscarLaunchPrompt = buildOrchestratorPrompt({
    sharedStandards,
    oscarBody: oscar.body,
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
    bobDriver = createHeadlessBuilderDriver({ getAdapter, bob, cwd: worktreePath, runDir, scope, sharedStandards, runBranch, runHeadless: deps.runHeadless, signal: deps.signal })
    store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: bob.id, ref: bobDriver.refId, mode: 'headless' } })
  } else {
    const bobCmd = getAdapter(bob.cli).build({
      persona: bob.id,
      prompt: buildBuilderStandbyPrompt({ sharedStandards, bobBody: bob.body, scope, runBranch }),
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
    ? await spawnObserver({ store, sessionHost, getAdapter, run, workspace, priority, task: input.task ?? null, deb, sharedStandards, runDir, groupLabel, cwd: worktreePath, runBranch })
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
    throw new Error(message)
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
          scope: deb.writeScope,
          message: `deb-${kind}: ${faultType}${atomIndex !== null ? ` (atom ${atomIndex})` : ''} occurrence ${occurrence}${verdict.ticketId ? ` → ticket ${verdict.ticketId}` : ''} via CoCoder run ${run.id}`,
          headBefore: headBeforeRepair,
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
  let n = 0
  let consecutiveRejects = 0
  let activeAtom: { readonly index: number; readonly workItemId: string; readonly headBefore: string } | null = null
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
      scope: oscar.writeScope,
      message: `oscar-support: ${priority.id} via CoCoder run ${run.id}`,
      headBefore,
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
    try {
      await git.restoreToHead(worktreePath, produced)
      store.recordEvent({ runId: run.id, type: 'atom-quarantined', data: { atom: atomIndex, files: produced } })
    } catch (err) {
      store.recordEvent({ runId: run.id, type: 'atom-quarantine-failed', data: { atom: atomIndex, files: produced, reason: String(err) } })
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
    store.setRunStatus(run.id, status)
    // Any commits already made are on the active branch; push them (non-gating) so a shared remote sees them.
    await pushActiveBranchIfRemote()
    store.recordEvent({
      runId: run.id,
      type: 'run-end',
      data: { status, atoms, committedShas, outOfScope, selfCommitted },
    })
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
          scope: input.wrapPlay.writeScope,
          message: commitMessage(priority.id, run.id, n),
          headBefore: headBeforeWrap,
        })
        absorbGateResult(wrapGate)
        pickup = res.output && res.output.trim() ? res.output : (directive.pickup ?? null)
        store.recordEvent({ runId: run.id, type: 'wrapup', data: { atoms: n, forced: false, play: input.wrapPlay.id } })
        log(`wrap-up play ${input.wrapPlay.id} ran after ${n} atom(s)`)
      } else {
        pickup = directive.pickup
        store.recordEvent({ runId: run.id, type: 'wrapup', data: { atoms: n, forced: false } })
        log(`oscar wrapped up after ${n} atom(s)`)
      }
      if (pickup && pickup.trim() !== '') {
        if (oscarDriver.kind === 'headless') {
          store.recordEvent({ runId: run.id, type: 'wrapup-delivery-skipped', data: { reason: 'headless-oscar' } })
        } else {
          await oscarDriver.show().catch(() => {})
          await oscarDriver.send(buildWrapupDelivery(run.id, pickup)).catch(() => {})
          store.recordEvent({ runId: run.id, type: 'wrapup-delivery-dispatch', data: { ref: oscarDriver.refId } })
        }
      }
      await refreshStatus('wrapped', n, null, 'wrap-up delivered; Oscar remains reachable for founder questions and in-scope Surface-A edits until explicit teardown')
      break
    }

    // Delegate the atom → one work_item per atom (the F8 substrate, ADR-0003). `atomIndex` is this
    // atom's stable 0-based index; `n` is the count of delegated atoms (and the NEXT directive index).
    const atomIndex = n
    const workItem = store.createWorkItem({ runId: run.id, sourcePersona: oscar.id, targetPersona: bob.id, task: directive.task, writeScope: scope })
    store.recordEvent({ runId: run.id, type: 'delegation', data: { workItemId: workItem.id, atom: atomIndex, task: directive.task } })
    const headBefore = await git.headSha(worktreePath) // re-snapshot per atom (self-commit detection)
    activeAtom = { index: atomIndex, workItemId: workItem.id, headBefore }
    const loopLedgerPath = directive.loop === undefined ? null : join(runDir, `loop-ledger-${atomIndex}.jsonl`)
    const loopStartedAt = directive.loop === undefined ? null : now()
    const recordedLoopIterations = new Set<number>()
    const readAndRecordLoopLedger =
      loopLedgerPath === null
        ? null
        : async (): Promise<readonly LoopLedgerEntry[]> => {
            const ledger = await readLoopLedger(loopLedgerPath)
            for (const entry of ledger) {
              if (recordedLoopIterations.has(entry.iteration)) continue
              recordedLoopIterations.add(entry.iteration)
              store.recordEvent({ runId: run.id, type: 'loop-iteration', data: { atom: atomIndex, ...entry } })
            }
            return ledger
          }
    await bobDriver.show()
    await bobDriver.dispatch(buildBuilderDispatch(directivePath, atomIndex, loopLedgerPath ?? undefined))
    store.recordEvent({ runId: run.id, type: 'builder-dispatch', data: { ref: bobDriver.refId, atom: atomIndex } })
    await refreshStatus('building', atomIndex, directive.task, `monitoring builder on atom ${atomIndex}`)
    log(`atom ${atomIndex} dispatched to bob (work item ${workItem.id}); monitoring live progress`)

    let cappedLoop: { readonly cap: 'iterations' | 'wall-clock'; readonly ledger: readonly LoopLedgerEntry[] } | null = null
    let monitorSamples = 0
    let completionAttempt = 0

    // MONITOR Bob's live progress — the primary signal (ADR-0013), replacing the blind done-file poll.
    for (;;) {
      const doneSentinel = atomSentinel(atomIndex, completionAttempt === 0 ? undefined : `R${completionAttempt}`)
      const remainingLoopMs =
        directive.loop === undefined || loopStartedAt === null ? undefined : Math.max(0, directive.loop.wallClockMs - (now() - loopStartedAt))
      const outcome = await runMonitor(
        {
          readScreen: () => bobDriver.readScreen(),
          judge: makeJudge({ atomIndex, doneSentinel, task: directive.task }),
          isAlive: () => bobDriver.alive(),
          nudge: (text) => bobDriver.nudge(text),
          readLoopLedger: readAndRecordLoopLedger ?? undefined,
          onAssessment: (a) => {
            if (a.state !== 'progressing') store.recordEvent({ runId: run.id, type: 'monitor-assessment', data: { atom: atomIndex, state: a.state, note: a.note ?? null } })
          },
          onNudge: (text) => store.recordEvent({ runId: run.id, type: 'nudge', data: { atom: atomIndex, text } }),
          now,
        },
        {
          task: directive.task,
          cadenceMs: t.monitorCadenceMs,
          timeoutMs: t.buildMs,
          minNudgeIntervalMs: t.minNudgeIntervalMs,
          loop: directive.loop === undefined ? undefined : { maxIterations: directive.loop.maxIterations, wallClockMs: remainingLoopMs ?? directive.loop.wallClockMs },
          signal: deps.signal,
        },
      )
      monitorSamples += outcome.samples
      const finalLoopLedger = readAndRecordLoopLedger === null ? null : await readAndRecordLoopLedger()
      if (outcome.reason === 'loop-iteration-cap' || outcome.reason === 'loop-wall-clock-cap') {
        cappedLoop = {
          cap: outcome.reason === 'loop-iteration-cap' ? 'iterations' : 'wall-clock',
          ledger: finalLoopLedger ?? outcome.loopLedger ?? [],
        }
        break
      }
      if (outcome.reason !== 'done') {
        store.setWorkItemStatus(workItem.id, 'abandoned')
        return await fail('builder-failed', `builder ${outcome.reason} on atom ${atomIndex}`, atomIndex)
      }
      if (directive.loop === undefined) break

      const criterionAttempt = completionAttempt + 1
      const criterion = await execCriterion(directive.loop.criterion, worktreePath).catch((err: unknown) => ({ exitCode: 1, output: String(err) }))
      const pass = criterion.exitCode === 0
      const tail = outputTail(criterion.output)
      store.recordEvent({
        runId: run.id,
        type: 'loop-criterion-rerun',
        data: { atom: atomIndex, attempt: criterionAttempt, command: directive.loop.criterion, exitCode: criterion.exitCode, pass, outputTail: tail },
      })
      if (pass) break

      const ledger = finalLoopLedger ?? []
      if (criterionAttempt >= directive.loop.maxIterations) {
        cappedLoop = { cap: 'iterations', ledger }
        break
      }
      if (loopStartedAt !== null && now() - loopStartedAt >= directive.loop.wallClockMs) {
        cappedLoop = { cap: 'wall-clock', ledger }
        break
      }

      const nextMarkerId = `${atomIndex}-R${criterionAttempt}`
      const nudge = `LOOP CRITERION RED on attempt ${criterionAttempt} (exit ${criterion.exitCode}). Keep iterating, append the next loop-ledger line, and when fully done print your completion marker for atom ${nextMarkerId} on its own line using your standby marker format. Failing output tail:\n${tail}`
      await bobDriver.nudge(nudge)
      store.recordEvent({ runId: run.id, type: 'nudge', data: { atom: atomIndex, text: nudge } })
      completionAttempt = criterionAttempt
    }

    if (cappedLoop !== null) {
      const { cap, ledger } = cappedLoop
      store.setWorkItemStatus(workItem.id, 'abandoned')
      store.recordEvent({ runId: run.id, type: 'loop-capped', data: { atom: atomIndex, cap, ledger } })
      await quarantineAtom(atomIndex, headBefore, 'atom-self-committed-loop-capped')
      activeAtom = null
      const outcomeLine = `atom ${atomIndex} was BLOCKED at the loop ${cap} cap — nothing committed`
      log(outcomeLine)
      n += 1
      if (n >= limits.maxAtoms) {
        pickup = `Run stopped at the ${limits.maxAtoms}-atom backstop. Continue from here in a fresh session.`
        store.recordEvent({ runId: run.id, type: 'wrapup', data: { atoms: n, forced: true, reason: 'max-atoms' } })
        break
      }
      await oscarDriver.show()
      await oscarDriver.send(buildNextOrWrapDispatch(join(runDir, `directive-${n}.json`), outcomeLine))
      continue
    }
    store.recordEvent({ runId: run.id, type: 'builder-done', data: { atom: atomIndex, samples: monitorSamples } })

    // Verify the atom (ADR-0011, per atom) — the commit runs only on `pass`.
    const verifyPath = join(runDir, `verify-${atomIndex}.json`)
    await oscarDriver.show()
    await oscarDriver.send(buildVerifyDispatch(directivePath, verifyPath))
    store.recordEvent({ runId: run.id, type: 'verify-dispatch', data: { ref: oscarDriver.refId, atom: atomIndex } })
    await refreshStatus('verifying', atomIndex, directive.task, `awaiting verify verdict for atom ${atomIndex}`)
    let verdict
    try {
      verdict = await awaitOscarWithNudgeWatchdog('verify', atomIndex, directive.task, () =>
        io.awaitVerification(verifyPath, { timeoutMs: t.orchestrationMs, pollMs: t.pollMs, isAlive: oscarAlive, signal: deps.signal }),
      )
    } catch (err) {
      if (isStopRequestedError(err)) throw err
      store.setWorkItemStatus(workItem.id, 'abandoned')
      return await fail('verify-failed', String(err), atomIndex)
    }

    let outcomeLine: string
    if (verdict.verdict === 'fail') {
      store.recordEvent({ runId: run.id, type: 'verify-rejected', data: { atom: atomIndex, reason: verdict.reason } })
      store.setWorkItemStatus(workItem.id, 'abandoned')
      await quarantineAtom(atomIndex, headBefore, 'atom-self-committed-rejected')
      consecutiveRejects += 1
      outcomeLine = `atom ${atomIndex} was REJECTED (${verdict.reason ?? 'no reason'}) — nothing committed`
      log(outcomeLine)
    } else {
      store.recordEvent({ runId: run.id, type: 'verify-pass', data: { atom: atomIndex, reason: verdict.reason } })
      consecutiveRejects = 0
      const gate = await runCommitGate({
        git,
        store,
        cwd: worktreePath,
        runId: run.id,
        workItemId: workItem.id,
        scope,
        message: commitMessage(priority.id, run.id, atomIndex),
        headBefore,
      })
      store.setWorkItemStatus(workItem.id, 'done')
      absorbGateResult(gate)
      outcomeLine = gate.committedSha ? `atom ${atomIndex} verified + committed ${gate.committedSha}` : `atom ${atomIndex} verified (no in-scope changes to commit)`
      log(outcomeLine)
    }
    n += 1
    activeAtom = null

    // Deterministic backstops — the bound is the spine's; the "enough" judgment stays Oscar's.
    if (consecutiveRejects >= limits.maxConsecutiveRejects) {
      await triageFault('max-consecutive-rejects', atomIndex, verdict.reason ?? 'repeated rejections') // Deb triages the stuck-loop
      pickup = `Run stopped: ${consecutiveRejects} atoms rejected in a row (last: ${verdict.reason ?? 'no reason'}). Re-scope the work and start fresh.`
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
    await oscarDriver.send(buildNextOrWrapDispatch(join(runDir, `directive-${n}.json`), outcomeLine))
  }
  } catch (err) {
    if (isStopRequestedError(err)) return await stopRun()
    throw err
  }

  // ── Wrap-up: pickup brief (continuation; F8) + run record ───────────────────────────────────────
  const pickupPath = pickup ? await io.writePickup(runDir, pickup) : null
  const status: RunStatus = 'completed'
  store.setRunStatus(run.id, status)

  // Every atom + Oscar-support commit already landed on the active branch as it was made (the commit-gate
  // ran with cwd = the active checkout). There is no run branch to integrate, no landing step, and nothing
  // that can strand — committed work is on the branch BY CONSTRUCTION. Push to a shared remote if one
  // exists (non-gating); the merge to a shared main is GitHub's PR review, not the engine's.
  await pushActiveBranchIfRemote()

  // ── Authoritative outcome ─────────────────────────────────────────────────────────────────────────
  // The founder-facing TRUTH, DERIVED from settled state. Work is on the active branch by construction —
  // there is no separate landing that could fail. Out-of-lane paths were COMMITTED (scope is advisory) and
  // flagged for visibility, never withheld.
  {
    const flagged = outOfScope.length > 0 ? `Committed out-of-lane (flagged, NOT held back): ${outOfScope.join(', ')}.` : 'Nothing out of lane.'
    const nCommits = committedShas.length
    const outcome = `✅ COMMITTED on \`${runBranch}\` — ${nCommits} commit(s) on the active branch (no landing step; work is on the branch by construction). ${flagged}`
    store.recordEvent({ runId: run.id, type: 'landing-outcome', data: { landed: true, status, outOfScope, outcome } })
    if (pickup && pickup.trim() !== '' && oscarDriver.kind !== 'headless') {
      await oscarDriver.show().catch(() => {})
      await oscarDriver.send(buildLandingOutcome(run.id, outcome)).catch(() => {})
    }
  }

  store.recordEvent({
    runId: run.id,
    type: 'run-end',
    data: { status, atoms: n, committedShas, outOfScope, selfCommitted },
  })
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
