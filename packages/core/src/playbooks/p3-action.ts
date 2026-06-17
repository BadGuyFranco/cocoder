import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Assignments } from '../personas/index.js'
import type { Play } from '../plays/index.js'
import { P3_CAPS } from './estimate.js'
import type { PlaybookPhaseAction } from './executor.js'
import type { OnboardingPlaybookPhase } from './loader.js'
import { parseDeepReadIterationResult, type DeepReadAssignment, type DeepReadIterationResult, type FindingConfidence, type FindingSeverity, type SourcePairComparison } from './p2-fanout.js'
import { resolveDeepReadAssignments, type DeepReadDispatch, type ResolveTopTier } from './p2-dispatch.js'
import { buildRound } from './p3-cross-check.js'
import { readP3InputArtifacts, type P2Record } from './p3-input.js'
import { renderCrossCheckMarkdown } from './p3-render.js'

export type P3CapReason = 'round' | 'wall-clock' | 'token'
export type P3UnresolvedItemKind = 'cross-source-disagreement' | 'coverage-gap' | 'residual-gap' | 'missing-artifact' | 'unverified-evidence' | 'source-cap'

export interface PlaybookCrossCheckResultEvent {
  readonly roundsRun: number
  readonly converged: boolean
  readonly capStatus: P3CapStatus
  readonly unresolvedItemCount: number
}

export interface RunPlaybookP3ActionInput {
  readonly repoDir: string
  readonly runDir: string
  readonly assignments: Assignments
  readonly modelPin: string
  readonly play: Play
  readonly dispatch: DeepReadDispatch
  readonly resolveTopTier?: ResolveTopTier
  readonly now: () => number
  readonly signal?: AbortSignal
  readonly onCrossCheckResult?: (event: PlaybookCrossCheckResultEvent) => void
}

export interface PlaybookP3Artifacts {
  readonly convergence: P3ConvergencePayload
  readonly crossCheckMarkdown: string
}

export interface P3CapStatus {
  readonly tripped: boolean
  readonly reasons: readonly P3CapReason[]
  readonly tokenCap: number
  readonly maxRounds: number
  readonly maxWallClockMs: number
}

export interface P3PredicateClauses {
  readonly noNewContradictionOrDisagreement: boolean
  readonly noNewCoverageGap: boolean
  readonly priorItemsResolvedOrCarried: boolean
  readonly p1SurfaceRepresented: boolean
}

export interface P3UnresolvedItem {
  readonly key: string
  readonly kind: P3UnresolvedItemKind
  readonly subsystemId: string
  readonly note: string
  readonly severity: FindingSeverity
  readonly confidence: FindingConfidence
  readonly evidence: readonly string[]
}

export interface P3ResolvedItem {
  readonly key: string
  readonly subsystemId: string
  readonly resolvedByFollowUpId: string
  readonly evidence: readonly string[]
}

export interface P3FollowUpRead {
  readonly id: string
  readonly round: number
  readonly subsystemId: string
  readonly itemKey: string
  readonly question: string
  readonly assignment: DeepReadAssignment
  readonly outputPath: string
  readonly result: DeepReadIterationResult
}

export interface P3RoundRecord {
  readonly round: number
  readonly newContradictionsOrDisagreements: readonly P3UnresolvedItem[]
  readonly newCoverageGaps: readonly P3UnresolvedItem[]
  readonly carriedUnresolvedItems: readonly P3UnresolvedItem[]
  readonly resolvedItems: readonly P3ResolvedItem[]
  readonly predicateClauses: P3PredicateClauses
  readonly followUpReadsDispatched: readonly string[]
}

export interface P3ConvergencePayload {
  readonly version: 1
  readonly roundsRun: number
  readonly rounds: readonly P3RoundRecord[]
  readonly sourceAgreementBySubsystem: Readonly<Record<string, SourcePairComparison>>
  readonly followUpReads: readonly P3FollowUpRead[]
  readonly predicateClauses: P3PredicateClauses
  readonly converged: boolean
  readonly capStatus: P3CapStatus
  readonly finalUnresolvedItems: readonly P3UnresolvedItem[]
}

const p3Dir = (runDir: string): string => join(runDir, 'playbook', 'P3')
const maxWallClockMs = P3_CAPS.maxMinutes * 60 * 1000

export function createPlaybookP3PhaseAction(input: RunPlaybookP3ActionInput): PlaybookPhaseAction {
  return async ({ phase }) => {
    if (!isP3ActionPhase(phase)) return
    await runPlaybookP3Action(input)
  }
}

export async function runPlaybookP3Action(input: RunPlaybookP3ActionInput): Promise<PlaybookP3Artifacts> {
  const { subsystems, allocation, p2Records } = await readP3InputArtifacts(input.runDir)
  const tokenCap = Math.min(P3_CAPS.maxTokens, allocation.tokenBudget)
  const start = input.now()
  const rounds: P3RoundRecord[] = []
  const followUpReads: P3FollowUpRead[] = []
  let converged = false
  let capReasons: P3CapReason[] = tokenCap <= 0 ? ['token'] : []

  await mkdir(p3Dir(input.runDir), { recursive: true })

  for (let round = 1; round <= P3_CAPS.maxRounds; round += 1) {
    if (rounds.length > 0 && input.now() - start >= maxWallClockMs) {
      capReasons = ['wall-clock']
      break
    }

    const record = buildRound(round, subsystems, p2Records, rounds.at(-1) ?? null, followUpReads)
    rounds.push(record)
    if (allClausesPass(record.predicateClauses)) {
      converged = true
      break
    }
    if (capReasons.length > 0) break
    if (input.now() - start >= maxWallClockMs) {
      capReasons = ['wall-clock']
      break
    }
    if (round === P3_CAPS.maxRounds) {
      capReasons = ['round']
      break
    }

    const dispatched = await dispatchFollowUps(input, record, round)
    followUpReads.push(...dispatched)
    rounds[rounds.length - 1] = { ...record, followUpReadsDispatched: dispatched.map((read) => read.id) }
  }

  const finalRound = rounds.at(-1) ?? buildRound(1, subsystems, p2Records, null, followUpReads)
  const convergence: P3ConvergencePayload = {
    version: 1,
    roundsRun: rounds.length,
    rounds,
    sourceAgreementBySubsystem: Object.fromEntries(p2Records.map((record) => [record.subsystem.id, record.payload.agreementIndex])),
    followUpReads,
    predicateClauses: finalRound.predicateClauses,
    converged,
    capStatus: capStatus(capReasons, tokenCap),
    finalUnresolvedItems: finalRound.carriedUnresolvedItems,
  }
  const crossCheckMarkdown = renderCrossCheckMarkdown(convergence)
  await Promise.all([
    writeJson(join(p3Dir(input.runDir), 'convergence.json'), convergence),
    writeFile(join(p3Dir(input.runDir), 'cross-check.md'), crossCheckMarkdown, 'utf8'),
  ])
  input.onCrossCheckResult?.({ roundsRun: convergence.roundsRun, converged, capStatus: convergence.capStatus, unresolvedItemCount: convergence.finalUnresolvedItems.length })
  return { convergence, crossCheckMarkdown }
}

async function dispatchFollowUps(input: RunPlaybookP3ActionInput, round: P3RoundRecord, roundNumber: number): Promise<readonly P3FollowUpRead[]> {
  const assignments = resolveDeepReadAssignments({ assignments: input.assignments, modelPin: input.modelPin, resolveTopTier: input.resolveTopTier })
  const assignment = assignments.orchestrator
  const selected = round.carriedUnresolvedItems.slice(0, 3)
  const outDir = join(p3Dir(input.runDir), 'follow-ups', `round-${roundNumber}`)
  await mkdir(outDir, { recursive: true })
  const reads: P3FollowUpRead[] = []
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index]!
    const id = `round-${roundNumber}-follow-up-${index + 1}`
    const outputPath = join(outDir, `${id}.json`)
    const result = await runP3FollowUpRead(input, { id, item, assignment, outputPath })
    reads.push({
      id,
      round: roundNumber,
      subsystemId: item.subsystemId,
      itemKey: item.key,
      question: item.note,
      assignment,
      outputPath,
      result,
    })
  }
  return reads
}

async function runP3FollowUpRead(input: RunPlaybookP3ActionInput, followUp: { readonly id: string; readonly item: P3UnresolvedItem; readonly assignment: DeepReadAssignment; readonly outputPath: string }): Promise<DeepReadIterationResult> {
  const result = await input.dispatch({
    play: input.play,
    assignment: followUp.assignment,
    persona: 'oscar',
    task: formatFollowUpTask(followUp.id, followUp.item),
    cwd: input.repoDir,
    outPath: followUp.outputPath,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  if (result.exitCode !== 0) throw new Error(`P3 follow-up ${followUp.id} dispatch failed with exit code ${result.exitCode}`)
  return parseDeepReadIterationResult(result.output)
}

function formatFollowUpTask(id: string, item: P3UnresolvedItem): string {
  return [
    `Deep-read source: orchestrator`,
    `P3 follow-up: ${id}`,
    `Subsystem: ${item.subsystemId}`,
    `Question: ${item.note}`,
    '',
    'Return the normal deep-read JSON object. Cite concrete evidence or preserve the gap in residualGaps.',
    '',
    '## Item',
    JSON.stringify(item, null, 2),
  ].join('\n')
}

function capStatus(reasons: readonly P3CapReason[], tokenCap: number): P3CapStatus {
  return { tripped: reasons.length > 0, reasons, tokenCap, maxRounds: P3_CAPS.maxRounds, maxWallClockMs }
}

function allClausesPass(clauses: P3PredicateClauses): boolean {
  return clauses.noNewContradictionOrDisagreement && clauses.noNewCoverageGap && clauses.priorItemsResolvedOrCarried && clauses.p1SurfaceRepresented
}

function isP3ActionPhase(phase: OnboardingPlaybookPhase): boolean {
  return phase.id === 'P3' && phase.kind === 'cross-check'
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}
