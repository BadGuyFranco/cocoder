import { join } from 'node:path'
import { runCommitGate, type CommitGateResult, type Git } from '../commit-gate/index.js'
import type { RunStore } from '../store/index.js'
import type { Directive } from './directive.js'
import type { RunnerIO } from './io.js'
import { readLoopLedger, type LoopLedgerEntry } from './loop-ledger.js'
import { runMonitor } from './monitor.js'
import type { BuilderDriver } from './builder-driver.js'
import type { OscarDriver } from './oscar-driver.js'
import { atomSentinel, buildBuilderDispatch, buildVerifyDispatch, commitMessage } from './prompts.js'
import type { RunnerPhase } from './status.js'
import { isStopRequestedError } from './stop.js'
import type { MakeJudge } from './runner.js'

const OUTPUT_TAIL_CHARS = 2_000

const outputTail = (output: string): string => (output.length <= OUTPUT_TAIL_CHARS ? output : output.slice(-OUTPUT_TAIL_CHARS))

type DelegateDirective = Extract<Directive, { readonly kind: 'delegate' }>

export interface AgentStepActiveAtom {
  readonly index: number
  readonly workItemId: string
  readonly headBefore: string
}

export type AgentStepResult =
  | { readonly kind: 'blocked'; readonly outcomeLine: string }
  | { readonly kind: 'verified'; readonly verdict: 'pass' | 'fail'; readonly reason: string | null; readonly outcomeLine: string }

interface CriterionResult {
  readonly exitCode: number
  readonly output: string
}

interface AgentStepTimeouts {
  readonly orchestrationMs: number
  readonly buildMs: number
  readonly pollMs: number
  readonly monitorCadenceMs: number
  readonly minNudgeIntervalMs: number
}

type AwaitOscarWithNudgeWatchdog = <T>(
  stage: 'verify',
  atomIndex: number,
  task: string,
  awaitOscar: () => Promise<T>,
) => Promise<T>

export interface ExecuteAgentStepInput {
  readonly atomIndex: number
  readonly directivePath: string
  readonly directive: DelegateDirective
  readonly runId: string
  readonly priorityId: string
  readonly oscarId: string
  readonly bobId: string
  readonly runDir: string
  readonly worktreePath: string
  readonly scope: readonly string[]
  readonly store: RunStore
  readonly git: Git
  readonly io: RunnerIO
  readonly bobDriver: BuilderDriver
  readonly oscarDriver: OscarDriver
  readonly makeJudge: MakeJudge
  readonly execCriterion: (command: string, cwd: string) => Promise<CriterionResult>
  readonly awaitOscarWithNudgeWatchdog: AwaitOscarWithNudgeWatchdog
  readonly oscarAlive: () => Promise<boolean>
  readonly refreshStatus: (phase: RunnerPhase, activeAtom: number | null, activeTask: string | null, waitCondition: string) => Promise<void>
  readonly quarantineAtom: (atomIndex: number, headBefore: string, selfCommitEvent: string) => Promise<void>
  readonly absorbGateResult: (gate: CommitGateResult) => void
  readonly fail: (type: string, message: string, atomIndex: number) => Promise<never>
  readonly setActiveAtom: (atom: AgentStepActiveAtom | null) => void
  readonly now: () => number
  readonly timeouts: AgentStepTimeouts
  readonly signal?: AbortSignal
  readonly log: (msg: string) => void
}

export async function executeAgentStep(input: ExecuteAgentStepInput): Promise<AgentStepResult> {
  const {
    atomIndex,
    directivePath,
    directive,
    runId,
    priorityId,
    oscarId,
    bobId,
    runDir,
    worktreePath,
    scope,
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
    setActiveAtom,
    now,
    timeouts: t,
    signal,
    log,
  } = input

  const workItem = store.createWorkItem({ runId, sourcePersona: oscarId, targetPersona: bobId, task: directive.task, writeScope: scope })
  store.recordEvent({ runId, type: 'delegation', data: { workItemId: workItem.id, atom: atomIndex, task: directive.task } })
  const headBefore = await git.headSha(worktreePath)
  setActiveAtom({ index: atomIndex, workItemId: workItem.id, headBefore })
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
            store.recordEvent({ runId, type: 'loop-iteration', data: { atom: atomIndex, ...entry } })
          }
          return ledger
        }
  await bobDriver.show()
  await bobDriver.dispatch(buildBuilderDispatch(directivePath, atomIndex, loopLedgerPath ?? undefined))
  store.recordEvent({ runId, type: 'builder-dispatch', data: { ref: bobDriver.refId, atom: atomIndex } })
  await refreshStatus('building', atomIndex, directive.task, `monitoring builder on atom ${atomIndex}`)
  log(`atom ${atomIndex} dispatched to bob (work item ${workItem.id}); monitoring live progress`)

  let cappedLoop: { readonly cap: 'iterations' | 'wall-clock'; readonly ledger: readonly LoopLedgerEntry[] } | null = null
  let monitorSamples = 0
  let completionAttempt = 0

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
          if (a.state !== 'progressing') store.recordEvent({ runId, type: 'monitor-assessment', data: { atom: atomIndex, state: a.state, note: a.note ?? null } })
        },
        onNudge: (text) => store.recordEvent({ runId, type: 'nudge', data: { atom: atomIndex, text } }),
        now,
      },
      {
        task: directive.task,
        cadenceMs: t.monitorCadenceMs,
        timeoutMs: t.buildMs,
        minNudgeIntervalMs: t.minNudgeIntervalMs,
        loop: directive.loop === undefined ? undefined : { maxIterations: directive.loop.maxIterations, wallClockMs: remainingLoopMs ?? directive.loop.wallClockMs },
        signal,
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
      runId,
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
    store.recordEvent({ runId, type: 'nudge', data: { atom: atomIndex, text: nudge } })
    completionAttempt = criterionAttempt
  }

  if (cappedLoop !== null) {
    const { cap, ledger } = cappedLoop
    store.setWorkItemStatus(workItem.id, 'abandoned')
    store.recordEvent({ runId, type: 'loop-capped', data: { atom: atomIndex, cap, ledger } })
    await quarantineAtom(atomIndex, headBefore, 'atom-self-committed-loop-capped')
    setActiveAtom(null)
    const outcomeLine = `atom ${atomIndex} was BLOCKED at the loop ${cap} cap — nothing committed`
    log(outcomeLine)
    return { kind: 'blocked', outcomeLine }
  }
  store.recordEvent({ runId, type: 'builder-done', data: { atom: atomIndex, samples: monitorSamples } })

  const verifyPath = join(runDir, `verify-${atomIndex}.json`)
  await oscarDriver.show()
  await oscarDriver.send(buildVerifyDispatch(directivePath, verifyPath))
  store.recordEvent({ runId, type: 'verify-dispatch', data: { ref: oscarDriver.refId, atom: atomIndex } })
  await refreshStatus('verifying', atomIndex, directive.task, `awaiting verify verdict for atom ${atomIndex}`)
  let verdict
  try {
    verdict = await awaitOscarWithNudgeWatchdog('verify', atomIndex, directive.task, () =>
      io.awaitVerification(verifyPath, { timeoutMs: t.orchestrationMs, pollMs: t.pollMs, isAlive: oscarAlive, signal }),
    )
  } catch (err) {
    if (isStopRequestedError(err)) throw err
    store.setWorkItemStatus(workItem.id, 'abandoned')
    return await fail('verify-failed', String(err), atomIndex)
  }

  let outcomeLine: string
  if (verdict.verdict === 'fail') {
    store.recordEvent({ runId, type: 'verify-rejected', data: { atom: atomIndex, reason: verdict.reason } })
    store.setWorkItemStatus(workItem.id, 'abandoned')
    await quarantineAtom(atomIndex, headBefore, 'atom-self-committed-rejected')
    outcomeLine = `atom ${atomIndex} was REJECTED (${verdict.reason ?? 'no reason'}) — nothing committed`
    log(outcomeLine)
  } else {
    store.recordEvent({ runId, type: 'verify-pass', data: { atom: atomIndex, reason: verdict.reason } })
    const gate = await runCommitGate({
      git,
      store,
      cwd: worktreePath,
      runId,
      workItemId: workItem.id,
      scope,
      message: commitMessage(priorityId, runId, atomIndex),
      headBefore,
    })
    store.setWorkItemStatus(workItem.id, 'done')
    absorbGateResult(gate)
    outcomeLine = gate.committedSha ? `atom ${atomIndex} verified + committed ${gate.committedSha}` : `atom ${atomIndex} verified (no in-scope changes to commit)`
    log(outcomeLine)
  }
  setActiveAtom(null)
  return { kind: 'verified', verdict: verdict.verdict, reason: verdict.reason, outcomeLine }
}
