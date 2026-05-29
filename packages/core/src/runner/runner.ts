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
import type { ResolvedPersona } from '../personas/index.js'
import type { Run, RunStatus, RunStore, Workspace } from '../store/index.js'
import { effectiveScope } from '../write-scope/index.js'
import type { SessionHost, SessionRef } from '../session-host/index.js'
import { join } from 'node:path'
import type { RunnerIO } from './io.js'
import { type Judge, makeHeuristicJudge, runMonitor } from './monitor.js'
import { spawnObserver } from './observer.js'
import {
  atomSentinel,
  buildBuilderDispatch,
  buildBuilderStandbyPrompt,
  buildNextOrWrapDispatch,
  buildOrchestratorPrompt,
  buildVerifyDispatch,
  commitMessage,
} from './prompts.js'
import { renderRunRecord } from './record.js'

/** Build the per-atom Judge (ADR-0013). Injected so tests use a scripted fake and cli/daemon get the
 *  real heuristic. Tier 1 = a cheap idle/sentinel heuristic; semantic judgment stays at the verify-gate. */
export type MakeJudge = (ctx: { atomIndex: number; doneSentinel: string; task: string }) => Judge

export interface RunnerDeps {
  readonly store: RunStore
  readonly sessionHost: SessionHost
  readonly git: Git
  readonly getAdapter: (cli: string) => Adapter
  readonly io: RunnerIO
  /** How to build the per-atom monitor judge. Defaults to the tier-1 heuristic. */
  readonly makeJudge?: MakeJudge
  readonly timeouts?: {
    orchestrationMs?: number
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
  buildMs: 14_400_000,
  pollMs: 1500,
  monitorCadenceMs: 15_000,
  minNudgeIntervalMs: 60_000,
}
const LIMITS = { maxAtoms: 12, maxConsecutiveRejects: 3, stuckAfter: 4 }

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

  // Spawn Oscar (full loop prompt → writes the first directive), Bob on standby beside it, optional Deb.
  const oscarCmd = getAdapter(oscar.cli).build({
    prompt: buildOrchestratorPrompt({
      sharedStandards,
      oscarBody: oscar.body,
      priorityTitle: priority.title,
      priorityGoal: priority.goal,
      firstDirectivePath: join(runDir, 'directive-0.json'),
      builderLabel: bob.label,
      builderCli: bob.cli,
      runId: run.id,
      pickup: input.pickup ?? null,
    }),
    model: oscar.model,
    cwd: workspace.path,
    outPath: join(runDir, 'oscar.out'),
  })
  const oscarRef = await sessionHost.spawn({
    persona: oscar.id,
    command: oscarCmd.command,
    args: oscarCmd.args,
    cwd: workspace.path,
    group: run.id,
    label: oscar.label,
  })
  store.createSession({ runId: run.id, persona: oscar.id, sessionRef: oscarRef.id })
  store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: oscar.id, ref: oscarRef.id } })

  const bobCmd = getAdapter(bob.cli).build({
    prompt: buildBuilderStandbyPrompt({ sharedStandards, bobBody: bob.body, scope }),
    model: bob.model,
    cwd: workspace.path,
    outPath: join(runDir, 'bob.out'),
  })
  const bobRef = await sessionHost.spawn({
    persona: bob.id,
    command: bobCmd.command,
    args: bobCmd.args,
    cwd: workspace.path,
    group: run.id, // same workspace as Oscar → splits in beside it (warm, on standby)
    label: bob.label,
  })
  store.createSession({ runId: run.id, persona: bob.id, sessionRef: bobRef.id })
  store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: bob.id, ref: bobRef.id } })
  const debRef = deb
    ? await spawnObserver({ store, sessionHost, getAdapter, run, workspace, priority, deb, sharedStandards, runDir })
    : null
  await sessionHost.show(oscarRef)
  log(`oscar + bob spawned (${oscarRef.id}, ${bobRef.id}); awaiting first directive, bob on standby`)

  const oscarAlive = async (): Promise<boolean> => (await sessionHost.status(oscarRef)).state === 'running'
  const fail = (type: string, message: string): never => {
    store.recordEvent({ runId: run.id, type, data: { message } })
    store.setRunStatus(run.id, 'failed')
    throw new Error(message)
  }

  // ── The multi-atom loop ───────────────────────────────────────────────────────────────────────
  const committedShas: string[] = []
  const committedFiles: string[] = []
  const outOfScope: string[] = []
  let selfCommitted = false
  let pickup: string | null = null
  let n = 0
  let consecutiveRejects = 0

  for (;;) {
    const directivePath = join(runDir, `directive-${n}.json`)
    let directive
    try {
      directive = await io.awaitDirective(directivePath, { timeoutMs: t.orchestrationMs, pollMs: t.pollMs, isAlive: oscarAlive })
    } catch (err) {
      // First directive failed → tear down the idle standby panes; later ones leave teardown to Oz.
      if (n === 0) {
        await sessionHost.kill(bobRef).catch(() => {})
        if (debRef) await sessionHost.kill(debRef).catch(() => {})
      }
      return fail('directive-timeout', String(err))
    }

    if (directive.kind === 'wrapup') {
      pickup = directive.pickup
      store.recordEvent({ runId: run.id, type: 'wrapup', data: { atoms: n, forced: false } })
      log(`oscar wrapped up after ${n} atom(s)`)
      break
    }

    // Delegate the atom → one work_item per atom (the F8 substrate, ADR-0003). `atomIndex` is this
    // atom's stable 0-based index; `n` is the count of delegated atoms (and the NEXT directive index).
    const atomIndex = n
    const workItem = store.createWorkItem({ runId: run.id, sourcePersona: oscar.id, targetPersona: bob.id, task: directive.task, writeScope: scope })
    store.recordEvent({ runId: run.id, type: 'delegation', data: { workItemId: workItem.id, atom: atomIndex, task: directive.task } })
    const headBefore = await git.headSha(workspace.path) // re-snapshot per atom (self-commit detection)
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
      return fail('builder-failed', `builder ${outcome.reason} on atom ${atomIndex}`)
    }
    store.recordEvent({ runId: run.id, type: 'builder-done', data: { atom: atomIndex, samples: outcome.samples } })

    // Verify the atom (ADR-0011, per atom) — the commit runs only on `pass`.
    const verifyPath = join(runDir, `verify-${atomIndex}.json`)
    await sessionHost.show(oscarRef)
    await sessionHost.sendInput(oscarRef, buildVerifyDispatch(directivePath, verifyPath))
    store.recordEvent({ runId: run.id, type: 'verify-dispatch', data: { ref: oscarRef.id, atom: atomIndex } })
    let verdict
    try {
      verdict = await io.awaitVerification(verifyPath, { timeoutMs: t.orchestrationMs, pollMs: t.pollMs, isAlive: oscarAlive })
    } catch (err) {
      store.setWorkItemStatus(workItem.id, 'abandoned')
      return fail('verify-failed', String(err))
    }

    let outcomeLine: string
    if (verdict.verdict === 'fail') {
      store.recordEvent({ runId: run.id, type: 'verify-rejected', data: { atom: atomIndex, reason: verdict.reason } })
      store.setWorkItemStatus(workItem.id, 'abandoned')
      consecutiveRejects += 1
      outcomeLine = `atom ${atomIndex} was REJECTED (${verdict.reason ?? 'no reason'}) — nothing committed`
      log(outcomeLine)
    } else {
      store.recordEvent({ runId: run.id, type: 'verify-pass', data: { atom: atomIndex, reason: verdict.reason } })
      consecutiveRejects = 0
      const gate = await runCommitGate({
        git,
        store,
        cwd: workspace.path,
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
  const status: RunStatus = outOfScope.length > 0 ? 'pending-scope-decision' : 'completed'
  store.setRunStatus(run.id, status)
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
