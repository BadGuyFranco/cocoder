import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Assignments } from '../personas/index.js'
import type { Play } from '../plays/index.js'
import type { P2Allocation } from './estimate.js'
import { combineSourcePair, runDeepReadSource, type DeepReadCapStatus, type DeepReadSource, type SourcePairConvergencePayload } from './p2-fanout.js'
import { createDeepReadTurn, resolveDeepReadAssignments, type DeepReadDispatch, type ResolveTopTier } from './p2-dispatch.js'
import { parseSubsystemsJsonPayload, type Subsystem, type SubsystemsJsonPayload } from './recon-pass.js'

export interface PlaybookFanoutResultEvent {
  readonly subsystemId: string
  readonly source: DeepReadSource
  readonly iteration: number
  readonly understood: boolean
  readonly capStatus: DeepReadCapStatus
}

export interface RunPlaybookP2ActionInput {
  readonly repoDir: string
  readonly runDir: string
  readonly assignments: Assignments
  readonly modelPin: string
  readonly play: Play
  readonly dispatch: DeepReadDispatch
  readonly resolveTopTier?: ResolveTopTier
  readonly now: () => number
  readonly signal?: AbortSignal
  readonly onFanoutResult?: (event: PlaybookFanoutResultEvent) => void
}

export interface PlaybookP2Artifacts {
  readonly subsystems: SubsystemsJsonPayload
  readonly convergence: readonly SourcePairConvergencePayload[]
}

const p1Dir = (runDir: string): string => join(runDir, 'playbook', 'P1')
const p2Dir = (runDir: string): string => join(runDir, 'playbook', 'P2')

export async function runPlaybookP2Action(input: RunPlaybookP2ActionInput): Promise<PlaybookP2Artifacts> {
  const subsystems = parseSubsystemsJsonPayload(await readJson(join(p1Dir(input.runDir), 'subsystems.json')))
  const allocations = parseP2Allocations(await readJson(join(p1Dir(input.runDir), 'estimate.json')))
  await Promise.all([
    mkdir(join(p2Dir(input.runDir), 'findings'), { recursive: true }),
    mkdir(join(p2Dir(input.runDir), 'convergence'), { recursive: true }),
  ])

  const convergence: SourcePairConvergencePayload[] = []
  for (const subsystem of subsystems.subsystems) {
    const allocation = allocations[subsystem.id]
    if (!allocation) throw new Error(`estimate.json.p2AllocationBySubsystem missing allocation for subsystem "${subsystem.id}"`)
    const pair = await runSubsystemDeepRead(input, subsystem, allocation)
    convergence.push(pair)
  }

  return { subsystems, convergence }
}

async function runSubsystemDeepRead(input: RunPlaybookP2ActionInput, subsystem: Subsystem, allocation: P2Allocation): Promise<SourcePairConvergencePayload> {
  const assignments = resolveDeepReadAssignments({ assignments: input.assignments, modelPin: input.modelPin, resolveTopTier: input.resolveTopTier })
  const findingsDir = join(p2Dir(input.runDir), 'findings', subsystem.id)
  await mkdir(findingsDir, { recursive: true })
  const builderTurn = createDeepReadTurn({
    assignment: assignments.builder,
    source: 'builder',
    play: input.play,
    repoDir: input.repoDir,
    runDir: input.runDir,
    dispatch: input.dispatch,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  const orchestratorTurn = createDeepReadTurn({
    assignment: assignments.orchestrator,
    source: 'orchestrator',
    play: input.play,
    repoDir: input.repoDir,
    runDir: input.runDir,
    dispatch: input.dispatch,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })

  const [builder, orchestrator] = await Promise.all([
    runDeepReadSource({ subsystem, source: 'builder', assignment: assignments.builder, allocation, deepReadTurn: builderTurn, now: input.now }),
    runDeepReadSource({ subsystem, source: 'orchestrator', assignment: assignments.orchestrator, allocation, deepReadTurn: orchestratorTurn, now: input.now }),
  ])
  emitFanout(input, builder.source, subsystem.id, builder.iterationsRun, builder.understood, builder.capStatus)
  emitFanout(input, orchestrator.source, subsystem.id, orchestrator.iterationsRun, orchestrator.understood, orchestrator.capStatus)

  await Promise.all([
    writeFile(join(findingsDir, 'builder.md'), builder.rollingFindingsMarkdown, 'utf8'),
    writeFile(join(findingsDir, 'orchestrator.md'), orchestrator.rollingFindingsMarkdown, 'utf8'),
  ])

  const pair = combineSourcePair(builder, orchestrator)
  await writeJson(join(p2Dir(input.runDir), 'convergence', `${subsystem.id}.json`), pair.convergencePayload)
  return pair.convergencePayload
}

function emitFanout(input: RunPlaybookP2ActionInput, source: DeepReadSource, subsystemId: string, iteration: number, understood: boolean, capStatus: DeepReadCapStatus): void {
  input.onFanoutResult?.({ subsystemId, source, iteration, understood, capStatus })
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`${path} must contain valid JSON`)
    throw err
  }
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function parseP2Allocations(raw: unknown): Readonly<Record<string, P2Allocation>> {
  const record = assertRecord(raw, 'estimate.json')
  const allocations = assertRecord(record.p2AllocationBySubsystem, 'estimate.json.p2AllocationBySubsystem')
  return Object.fromEntries(Object.entries(allocations).map(([subsystemId, allocation]) => [subsystemId, parseP2Allocation(allocation, `estimate.json.p2AllocationBySubsystem.${subsystemId}`)]))
}

function parseP2Allocation(raw: unknown, path: string): P2Allocation {
  const record = assertRecord(raw, path)
  return {
    targetIterations: readNumber(record, `${path}.targetIterations`),
    projectedMinutes: readNumber(record, `${path}.projectedMinutes`),
    tokenBudget: readNumber(record, `${path}.tokenBudget`),
  }
}

function readNumber(record: Record<string, unknown>, path: string): number {
  const value = record[path.slice(path.lastIndexOf('.') + 1)]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
  return value
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as Record<string, unknown>
}
