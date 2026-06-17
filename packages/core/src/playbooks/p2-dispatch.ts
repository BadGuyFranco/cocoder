import { join } from 'node:path'
import { resolvePlayAssignment, type Assignments, type PlayAssignment } from '../personas/index.js'
import type { DispatchPlayInput, DispatchPlayResult, Play } from '../plays/index.js'
import {
  parseDeepReadIterationResult,
  type DeepReadAssignment,
  type DeepReadSource,
  type DeepReadTurn,
  type DeepReadTurnInput,
} from './p2-fanout.js'

export interface ResolveTopTierInput {
  readonly cli: string
  readonly persona: string
}

export type ResolveTopTier = (input: ResolveTopTierInput) => string

export interface ResolveDeepReadAssignmentsInput {
  readonly assignments: Assignments
  readonly modelPin: string
  readonly resolveTopTier?: ResolveTopTier
}

export interface DeepReadAssignments {
  readonly builder: DeepReadAssignment
  readonly orchestrator: DeepReadAssignment
}

export type DeepReadDispatch = (input: DispatchPlayInput) => Promise<DispatchPlayResult>

export interface CreateDeepReadTurnInput {
  readonly assignment: DeepReadAssignment
  readonly source: DeepReadSource
  readonly play: Play
  readonly repoDir: string
  readonly runDir: string
  readonly dispatch: DeepReadDispatch
  readonly signal?: AbortSignal
}

export function resolveDeepReadAssignments(input: ResolveDeepReadAssignmentsInput): DeepReadAssignments {
  const builder = resolveDeepReadAssignment({
    source: 'builder',
    persona: 'bob',
    assignment: resolvePlayAssignment(input.assignments, 'bob', 'deep-read'),
    modelPin: input.modelPin,
    resolveTopTier: input.resolveTopTier,
  })
  const orchestrator = resolveDeepReadAssignment({
    source: 'orchestrator',
    persona: 'oscar',
    assignment: resolvePlayAssignment(input.assignments, 'oscar', 'deep-read'),
    modelPin: input.modelPin,
    resolveTopTier: input.resolveTopTier,
  })

  if (sameAssignment(builder, orchestrator)) {
    throw new Error(
      `deep-read assignments collapsed to the same source {cli: "${builder.cli}", model: "${builder.model}"}; adversarial dual-source audit requires distinct model sources`,
    )
  }

  return { builder, orchestrator }
}

export function createDeepReadTurn(input: CreateDeepReadTurnInput): DeepReadTurn {
  return async (turn) => {
    const normalizedTurn: DeepReadTurnInput = { ...turn, source: input.source }
    const outPath = join(input.runDir, 'playbook', 'P2', 'findings', normalizedTurn.subsystem.id, `${input.source}.md`)
    const result = await input.dispatch({
      play: input.play,
      assignment: input.assignment,
      persona: personaForSource(input.source),
      task: formatDeepReadTask(normalizedTurn),
      cwd: input.repoDir,
      outPath,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })

    if (result.exitCode !== 0) {
      throw new Error(`deep-read ${input.source} dispatch failed with exit code ${result.exitCode}`)
    }

    return parseDeepReadIterationResult(result.output)
  }
}

function resolveDeepReadAssignment(input: {
  readonly source: DeepReadSource
  readonly persona: string
  readonly assignment: PlayAssignment
  readonly modelPin: string
  readonly resolveTopTier?: ResolveTopTier
}): DeepReadAssignment {
  if (input.modelPin !== 'top-tier') return { cli: input.assignment.cli, model: input.assignment.model }
  if (!input.resolveTopTier) throw new Error('modelPin top-tier requires a resolveTopTier seam')

  const model = input.resolveTopTier({ cli: input.assignment.cli, persona: input.persona }).trim()
  if (model === '') {
    throw new Error(`top-tier resolver returned an empty model for ${input.source} deep-read source (${input.persona} on ${input.assignment.cli})`)
  }
  return { cli: input.assignment.cli, model }
}

function sameAssignment(left: DeepReadAssignment, right: DeepReadAssignment): boolean {
  return left.cli === right.cli && left.model === right.model
}

function personaForSource(source: DeepReadSource): string {
  return source === 'builder' ? 'bob' : 'oscar'
}

function formatDeepReadTask(input: DeepReadTurnInput): string {
  return [
    `Deep-read source: ${input.source}`,
    `Subsystem: ${input.subsystem.id} (${input.subsystem.name})`,
    `Iteration: ${input.iteration}`,
    '',
    '## Turn Input',
    JSON.stringify(input, null, 2),
  ].join('\n')
}
