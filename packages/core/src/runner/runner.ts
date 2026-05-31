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
import { runCommitGate } from '../commit-gate/index.js'
import type { Git } from '../commit-gate/index.js'
import type { Priority } from '../priorities/index.js'
import type { PlayAssignment, ResolvedPersona } from '../personas/index.js'
import { dispatchPlay, type DispatchPlayResult, type HeadlessRunInput } from '../plays/index.js'
import type { Play } from '../plays/index.js'
import type { Run, RunStatus, RunStore, Workspace } from '../store/index.js'
import { effectiveScope, partitionByScope } from '../write-scope/index.js'
import type { SessionHost, SessionRef } from '../session-host/index.js'
import { join } from 'node:path'
import { runBranchFor, worktreePathFor } from '../worktree/paths.js'
import type { RunnerIO } from './io.js'
import { paneLabel } from './labels.js'
import { type Judge, makeHeuristicJudge, runMonitor } from './monitor.js'
import { spawnObserver } from './observer.js'
import {
  atomSentinel,
  buildBuilderDispatch,
  buildBuilderStandbyPrompt,
  buildDebTriageDispatch,
  buildNextOrWrapDispatch,
  buildOrchestratorPrompt,
  buildVerifyDispatch,
  commitMessage,
} from './prompts.js'
import { renderRunRecord } from './record.js'
import type { Triage } from './triage.js'

/** Build the per-atom Judge (ADR-0013). Injected so tests use a scripted fake and cli/daemon get the
 *  real heuristic. Tier 1 = a cheap idle/sentinel heuristic; semantic judgment stays at the verify-gate. */
export type MakeJudge = (ctx: { atomIndex: number; doneSentinel: string; task: string }) => Judge

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
}

export interface RunInput {
  readonly workspace: Workspace
  readonly priority: Priority
  readonly oscar: ResolvedPersona
  readonly bob: ResolvedPersona
  readonly deb?: ResolvedPersona
  readonly sharedStandards: string
  /** runs root; the run dir is <runsRoot>/<runId>. */
  readonly runsRoot: string
  /** A prior run's pickup brief to resume from (ADR-0002 C1 / F8), woven into Oscar's prompt. */
  readonly pickup?: string | null
  /** Resolved wrap-up Play + per-(persona, Play) assignment; when present, the runner dispatches the Play to author closeout. */
  readonly wrapPlay?: Play
  readonly wrapPlayAssignment?: PlayAssignment
  /** Daemon launch-time guard: true when the long-lived daemon is serving code older than repo HEAD. */
  readonly daemonStale?: boolean
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

const defaultMakeJudge =
  (stuckAfter: number): MakeJudge =>
  ({ doneSentinel }) =>
    makeHeuristicJudge({
      doneSentinel,
      stuckAfter,
      nudge: 'You seem stalled — what is blocking you? Keep going, or say what you need.',
    })

export async function runRun(deps: RunnerDeps, input: RunInput): Promise<RunResult> {
  if (input.priority.objective === null) throw new MissingObjectiveError(input.priority.id)

  const { store, sessionHost, git, getAdapter, io } = deps
  const t = { ...DEFAULTS, ...deps.timeouts }
  const limits = { ...LIMITS, ...deps.limits }
  const makeJudge = deps.makeJudge ?? defaultMakeJudge(limits.stuckAfter)
  const log = deps.log ?? (() => {})
  const { workspace, priority, oscar, bob, deb, sharedStandards, runsRoot } = input

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

  // Isolated working state (ADR-0015 §1): the run executes in its OWN git worktree on its OWN branch,
  // cut from the trunk tip at launch. The founder's checkout (cocoderHome = workspace.path) is NEVER
  // touched — every agent and every git op below runs against `worktreePath`. A fresh branch off a
  // committed trunk point is clean in-scope BY CONSTRUCTION, which is the soundness precondition the
  // per-atom quarantine relies on (and exactly what the retired dirty-tree guard used to provide).
  const cocoderHome = workspace.path
  const trunkSha = await git.headSha(cocoderHome)
  const worktreePath = worktreePathFor(cocoderHome, run.id)
  const runBranch = runBranchFor(run.id)
  await git.worktreeAdd(cocoderHome, worktreePath, runBranch, trunkSha)
  store.setWorktree(run.id, worktreePath, runBranch)
  store.recordEvent({ runId: run.id, type: 'worktree-created', data: { worktreePath, runBranch, trunkSha } })
  log(`worktree ${worktreePath} on ${runBranch} (from trunk ${trunkSha.slice(0, 8)})`)

  // No dirty-tree guard (ADR-0015): the run owns a fresh worktree off the committed trunk tip, so its
  // in-scope tree is clean BY CONSTRUCTION — the precondition the retired DirtyWorkingTreeError used to
  // enforce against the shared founder checkout. The founder's uncommitted work is irrelevant to a
  // launch and is never touched; the per-atom quarantine can only ever reset the run's own worktree.
  // The run's cmux workspace is named for the run: "<priority> #<session number>" (the numeric part of
  // the sequential run id), so the founder identifies it by priority + session, not by a persona.
  const groupLabel = `${priority.id} #${run.id.replace(/^run_/, '')}`

  // Spawn Oscar (full loop prompt → writes the first directive), Bob on standby beside it, optional Deb.
  const oscarCmd = getAdapter(oscar.cli).build({
    persona: oscar.id,
    prompt: buildOrchestratorPrompt({
      sharedStandards,
      oscarBody: oscar.body,
      priorityTitle: priority.title,
      priorityGoal: priority.goal,
      firstDirectivePath: join(runDir, 'directive-0.json'),
      builderLabel: bob.label,
      builderCli: bob.cli,
      runId: run.id,
      runBranch,
      pickup: input.pickup ?? null,
    }),
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
  store.createSession({ runId: run.id, persona: oscar.id, sessionRef: oscarRef.id })
  store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: oscar.id, ref: oscarRef.id } })

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
  store.createSession({ runId: run.id, persona: bob.id, sessionRef: bobRef.id })
  store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: bob.id, ref: bobRef.id } })
  const debRef = deb
    ? await spawnObserver({ store, sessionHost, getAdapter, run, workspace, priority, deb, sharedStandards, runDir, groupLabel, cwd: worktreePath, runBranch })
    : null
  await sessionHost.show(oscarRef)
  log(`oscar + bob spawned (${oscarRef.id}, ${bobRef.id}); awaiting first directive, bob on standby`)

  const oscarAlive = async (): Promise<boolean> => (await sessionHost.status(oscarRef)).state === 'running'
  // Every terminal fault funnels through here: record it, let Deb triage it (if present), then fail.
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
  const renderDisposition = (faultType: string, atomIndex: number | null, v: Triage): string => {
    const where = atomIndex !== null ? ` (atom ${atomIndex})` : ''
    const lines = [`# Deb disposition: ${v.disposition}`, '', `- **Fault:** ${faultType}${where}`, `- **Summary:** ${v.summary}`, '']
    if (v.disposition === 'cocoder-bug') lines.push('## Proposed fix — NOT applied; for founder review', '', '```diff', v.proposal ?? '(no diff provided)', '```', '')
    if (v.disposition === 'repo-bug') lines.push('## For the founder', '', v.summary, '')
    return lines.join('\n')
  }
  const triageFault = async (faultType: string, atomIndex: number | null, message: string): Promise<void> => {
    if (!debRef) return // no Deb on this run → no triage
    const i = faultSeq++
    try {
      await io.writeFaultContext(join(runDir, `fault-${i}.json`), { fault: faultType, atom: atomIndex, message })
      await sessionHost.show(debRef)
      await sessionHost.sendInput(debRef, buildDebTriageDispatch(join(runDir, `fault-${i}.json`), join(runDir, `triage-${i}.json`)))
      store.recordEvent({ runId: run.id, type: 'triage-dispatch', data: { fault: faultType, atom: atomIndex } })
      const verdict = await io.awaitTriage(join(runDir, `triage-${i}.json`), { timeoutMs: t.orchestrationMs, pollMs: t.pollMs, isAlive: debAlive })
      store.recordEvent({ runId: run.id, type: 'fault-triaged', data: { fault: faultType, atom: atomIndex, disposition: verdict.disposition, summary: verdict.summary } })
      await io.writeDisposition(runDir, i, renderDisposition(faultType, atomIndex, verdict))
    } catch (err) {
      store.recordEvent({ runId: run.id, type: 'triage-skipped', data: { fault: faultType, reason: err instanceof Error ? err.message : String(err) } })
    }
  }
  const awaitOscarWithDebWatchdog = async <T>(
    stage: 'directive' | 'verify',
    atomIndex: number,
    task: string,
    awaitOscar: () => Promise<T>,
  ): Promise<T> => {
    const debPersona = deb?.id
    if (!debRef || !debPersona) return await awaitOscar()

    let stopped = false
    let stopSleep: (() => void) | null = null
    const stoppedPromise = new Promise<void>((resolve) => {
      stopSleep = resolve
    })
    const stop = (): void => {
      stopped = true
      stopSleep?.()
    }
    const monitor = runMonitor(
      {
        readScreen: async () => {
          if (stopped) throw new Error('oscar await settled')
          return await sessionHost.readScreen(oscarRef)
        },
        judge: async (sample) => {
          if (stopped) return { state: 'done', note: 'oscar await settled' }
          if (sample.idleStreak > 0) {
            return { state: 'stuck', note: `no oscar screen change for ${sample.idleStreak} sample(s)`, nudge: OSCAR_IDLE_NUDGE }
          }
          return { state: 'progressing' }
        },
        isAlive: oscarAlive,
        nudge: (text) => sessionHost.sendInput(oscarRef, text),
        onAssessment: (a) => {
          if (a.state !== 'progressing') {
            store.recordEvent({ runId: run.id, type: 'oscar-monitor-assessment', data: { persona: debPersona, stage, atom: atomIndex, state: a.state, note: a.note ?? null } })
          }
        },
        onNudge: (text) => store.recordEvent({ runId: run.id, type: 'oscar-nudge', data: { persona: debPersona, stage, atom: atomIndex, text } }),
        sleep: (ms) =>
          Promise.race([
            new Promise<void>((resolve) => {
              setTimeout(resolve, ms)
            }),
            stoppedPromise,
          ]),
      },
      { task, cadenceMs: t.monitorCadenceMs, timeoutMs: t.orchestrationMs, minNudgeIntervalMs: t.minNudgeIntervalMs },
    ).catch((err: unknown) => {
      store.recordEvent({ runId: run.id, type: 'oscar-monitor-error', data: { persona: debPersona, stage, atom: atomIndex, message: err instanceof Error ? err.message : String(err) } })
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
  let terminalStatus: RunStatus | null = null
  let n = 0
  let consecutiveRejects = 0

  for (;;) {
    const directivePath = join(runDir, `directive-${n}.json`)
    let directive
    try {
      directive = await awaitOscarWithDebWatchdog('directive', n, `awaiting directive ${n}`, () =>
        io.awaitDirective(directivePath, { timeoutMs: t.orchestrationMs, pollMs: t.pollMs, isAlive: oscarAlive }),
      )
    } catch (err) {
      // First directive failed → tear down the idle standby builder; KEEP Deb alive so she can triage.
      if (n === 0) await sessionHost.kill(bobRef).catch(() => {})
      return await fail('directive-timeout', String(err), n)
    }

    if (directive.kind === 'wrapup') {
      if (input.daemonStale === true) {
        pickup =
          '⚠️ STALE DAEMON - wrap-up did NOT run on current code. NO valid closeout/proof was produced. ' +
          'Restart the daemon (scripts/oz.sh restart) and re-run this priority.'
        terminalStatus = 'failed'
        store.recordEvent({ runId: run.id, type: 'wrapup-stale-abort', data: { atoms: n } })
        log(`wrap-up aborted after ${n} atom(s): stale daemon`)
      } else if (input.wrapPlay && input.wrapPlayAssignment) {
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
            persona: oscar.id,
            task,
            cwd: worktreePath,
            outPath: wrapOut,
            group: run.id,
            timeoutMs: t.wrapupMs,
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
        if (wrapGate.committedSha) committedShas.push(wrapGate.committedSha)
        committedFiles.push(...wrapGate.committedFiles)
        outOfScope.push(...wrapGate.outOfScope)
        selfCommitted = selfCommitted || wrapGate.selfCommitted
        pickup = res.output && res.output.trim() ? res.output : (directive.pickup ?? null)
        store.recordEvent({ runId: run.id, type: 'wrapup', data: { atoms: n, forced: false, play: input.wrapPlay.id } })
        log(`wrap-up play ${input.wrapPlay.id} ran after ${n} atom(s)`)
      } else {
        pickup = directive.pickup
        store.recordEvent({ runId: run.id, type: 'wrapup', data: { atoms: n, forced: false } })
        log(`oscar wrapped up after ${n} atom(s)`)
      }
      break
    }

    // Delegate the atom → one work_item per atom (the F8 substrate, ADR-0003). `atomIndex` is this
    // atom's stable 0-based index; `n` is the count of delegated atoms (and the NEXT directive index).
    const atomIndex = n
    const workItem = store.createWorkItem({ runId: run.id, sourcePersona: oscar.id, targetPersona: bob.id, task: directive.task, writeScope: scope })
    store.recordEvent({ runId: run.id, type: 'delegation', data: { workItemId: workItem.id, atom: atomIndex, task: directive.task } })
    const headBefore = await git.headSha(worktreePath) // re-snapshot per atom (self-commit detection)
    const sentinel = atomSentinel(atomIndex)
    await sessionHost.show(bobRef)
    await sessionHost.sendInput(bobRef, buildBuilderDispatch(directivePath, atomIndex))
    store.recordEvent({ runId: run.id, type: 'builder-dispatch', data: { ref: bobRef.id, atom: atomIndex } })
    log(`atom ${atomIndex} dispatched to bob (work item ${workItem.id}); monitoring live progress`)

    // MONITOR Bob's live progress — the primary signal (ADR-0013), replacing the blind done-file poll.
    const outcome = await runMonitor(
      {
        readScreen: () => sessionHost.readScreen(bobRef),
        judge: makeJudge({ atomIndex, doneSentinel: sentinel, task: directive.task }),
        isAlive: async () => (await sessionHost.status(bobRef)).state === 'running',
        nudge: (text) => sessionHost.sendInput(bobRef, text),
        onAssessment: (a) => {
          if (a.state !== 'progressing') store.recordEvent({ runId: run.id, type: 'monitor-assessment', data: { atom: atomIndex, state: a.state, note: a.note ?? null } })
        },
        onNudge: (text) => store.recordEvent({ runId: run.id, type: 'nudge', data: { atom: atomIndex, text } }),
      },
      { task: directive.task, cadenceMs: t.monitorCadenceMs, timeoutMs: t.buildMs, minNudgeIntervalMs: t.minNudgeIntervalMs },
    )
    if (outcome.reason !== 'done') {
      store.setWorkItemStatus(workItem.id, 'abandoned')
      return await fail('builder-failed', `builder ${outcome.reason} on atom ${atomIndex}`, atomIndex)
    }
    store.recordEvent({ runId: run.id, type: 'builder-done', data: { atom: atomIndex, samples: outcome.samples } })

    // Verify the atom (ADR-0011, per atom) — the commit runs only on `pass`.
    const verifyPath = join(runDir, `verify-${atomIndex}.json`)
    await sessionHost.show(oscarRef)
    await sessionHost.sendInput(oscarRef, buildVerifyDispatch(directivePath, verifyPath))
    store.recordEvent({ runId: run.id, type: 'verify-dispatch', data: { ref: oscarRef.id, atom: atomIndex } })
    let verdict
    try {
      verdict = await awaitOscarWithDebWatchdog('verify', atomIndex, directive.task, () =>
        io.awaitVerification(verifyPath, { timeoutMs: t.orchestrationMs, pollMs: t.pollMs, isAlive: oscarAlive }),
      )
    } catch (err) {
      store.setWorkItemStatus(workItem.id, 'abandoned')
      return await fail('verify-failed', String(err), atomIndex)
    }

    let outcomeLine: string
    if (verdict.verdict === 'fail') {
      store.recordEvent({ runId: run.id, type: 'verify-rejected', data: { atom: atomIndex, reason: verdict.reason } })
      store.setWorkItemStatus(workItem.id, 'abandoned')
      // If the rejected atom SELF-committed (HEAD moved under trust-the-CLI), the working-tree quarantine
      // can't undo it — surface that so it isn't silently carried in history.
      if ((await git.headSha(worktreePath)) !== headBefore) {
        store.recordEvent({ runId: run.id, type: 'atom-self-committed-rejected', data: { atom: atomIndex, headBefore } })
      }
      // QUARANTINE (atom isolation): discard this rejected atom's IN-SCOPE working-tree changes so they
      // can't ride into a LATER passing atom's commit. The clean-tree precondition + per-atom commit
      // guarantee every in-scope change now in the tree is THIS atom's; prior work is committed (untouched),
      // out-of-scope files are left alone. If the restore fails, record it honestly (don't claim success).
      const { inScope: rejectedInScope } = partitionByScope(await git.changedFiles(worktreePath), scope)
      if (rejectedInScope.length > 0) {
        try {
          await git.restoreToHead(worktreePath, rejectedInScope)
          store.recordEvent({ runId: run.id, type: 'atom-quarantined', data: { atom: atomIndex, files: rejectedInScope } })
        } catch (err) {
          store.recordEvent({ runId: run.id, type: 'atom-quarantine-failed', data: { atom: atomIndex, files: rejectedInScope, reason: String(err) } })
        }
      }
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
      if (gate.committedSha) committedShas.push(gate.committedSha)
      committedFiles.push(...gate.committedFiles)
      outOfScope.push(...gate.outOfScope)
      selfCommitted = selfCommitted || gate.selfCommitted
      outcomeLine = gate.committedSha ? `atom ${atomIndex} verified + committed ${gate.committedSha}` : `atom ${atomIndex} verified (no in-scope changes to commit)`
      log(outcomeLine)
    }
    n += 1

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
    await sessionHost.show(oscarRef)
    await sessionHost.sendInput(oscarRef, buildNextOrWrapDispatch(join(runDir, `directive-${n}.json`), outcomeLine))
  }

  // ── Wrap-up: pickup brief (continuation; F8) + run record ───────────────────────────────────────
  const pickupPath = pickup ? await io.writePickup(runDir, pickup) : null
  const status: RunStatus = terminalStatus ?? (outOfScope.length > 0 ? 'pending-scope-decision' : 'completed')
  store.setRunStatus(run.id, status)

  // ── Integrate: fast-forward the run's branch onto trunk (ADR-0015 §3) ──────────────────────────────
  // A run reaches trunk ONLY here, and only on a clean completion — so a green run's verified commits
  // are not stranded on the branch (the failure the review flagged for an isolation-without-integration
  // intermediate). This is the BARE fast-forward merge; the distinct whole-tree integration VERIFY and
  // the escalation paths are the next atom. A non-fast-forward (trunk advanced since launch) is left
  // un-integrated for the merge-conflict Play — recorded, never guessed — and a dirty/locked founder
  // tree surfaces as `integration-failed` (the work stays safe on the branch either way). A run still
  // awaiting a scope decision (`pending-scope-decision`) or failed does NOT auto-land.
  let mergeSha: string | null = null
  if (status === 'completed') {
    try {
      const trunkNow = await git.headSha(cocoderHome)
      const unmerged = await git.unmergedCommits(cocoderHome, trunkNow, runBranch)
      if (unmerged.length === 0) {
        store.setIntegrationStatus(run.id, 'merged') // nothing un-integrated → vacuously landed
      } else if (await git.isAncestor(cocoderHome, trunkNow, runBranch)) {
        mergeSha = await git.mergeFastForwardOnly(cocoderHome, runBranch)
        store.recordCommitLink({
          runId: run.id,
          commitSha: mergeSha,
          message: `merge: ${runBranch} → trunk`,
          files: [],
          kind: 'merge',
          mergeSha,
          trunkParent: trunkNow,
        })
        store.setIntegrationStatus(run.id, 'merged')
        store.recordEvent({ runId: run.id, type: 'integrated', data: { mergeSha, trunkParent: trunkNow, runBranch, commits: unmerged.length } })
        log(`integrated ${runBranch} → trunk (${mergeSha.slice(0, 8)}; ${unmerged.length} commit(s))`)
      } else {
        store.recordEvent({ runId: run.id, type: 'integration-deferred', data: { reason: 'non-fast-forward', trunkNow, runBranch, commits: unmerged.length } })
        log(`integration deferred for ${runBranch}: trunk advanced since launch (non-ff) — left for the merge-conflict Play`)
      }
    } catch (err) {
      store.recordEvent({ runId: run.id, type: 'integration-failed', data: { runBranch, reason: err instanceof Error ? err.message : String(err) } })
      log(`integration failed for ${runBranch}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  store.recordEvent({
    runId: run.id,
    type: 'run-end',
    data: { status, integrationStatus: store.getRun(run.id)?.integrationStatus ?? 'pending', mergeSha, atoms: n, committedShas, outOfScope, selfCommitted },
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
