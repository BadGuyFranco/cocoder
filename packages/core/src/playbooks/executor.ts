import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OnboardingPlaybook, OnboardingPlaybookMode, OnboardingPlaybookPhase, OnboardingPlaybookPhaseId } from './loader.js'

export type PlaybookExecutorStatus = 'running' | 'awaiting-founder' | 'done'

export interface PlaybookGateState {
  readonly phaseIndex: number
  readonly phaseId: OnboardingPlaybookPhaseId
  readonly title: string
  readonly kind: OnboardingPlaybookPhase['kind']
  readonly reachedAt: number
  readonly approvedAt: number | null
  readonly approvedBy: string | null
  readonly note: string | null
}

export interface PlaybookExecutorState {
  readonly version: 1
  readonly mode: OnboardingPlaybookMode
  readonly playbookId: string
  readonly phaseIds: readonly OnboardingPlaybookPhaseId[]
  readonly currentPhaseIndex: number
  readonly currentPhaseId: OnboardingPlaybookPhaseId | null
  readonly status: PlaybookExecutorStatus
  readonly gate: PlaybookGateState | null
  readonly updatedAt: number
}

export interface PlaybookPhaseActionInput {
  readonly playbook: OnboardingPlaybook
  readonly phase: OnboardingPlaybookPhase
  readonly phaseIndex: number
  readonly state: PlaybookExecutorState
}

export type PlaybookPhaseAction = (input: PlaybookPhaseActionInput) => Promise<void>

export interface PlaybookExecutorDeps {
  readonly runDir: string
  readonly now: () => number
  readonly runPhase: PlaybookPhaseAction
}

export interface StartPlaybookExecutorInput extends PlaybookExecutorDeps {
  readonly playbook: OnboardingPlaybook
}

export interface ResumePlaybookExecutorInput extends PlaybookExecutorDeps {
  readonly playbook: OnboardingPlaybook
  readonly approval: FounderApproval
}

export interface LoadPlaybookExecutorInput extends PlaybookExecutorDeps {
  readonly playbook: OnboardingPlaybook
}

export interface FounderApproval {
  readonly approvedBy: string
  readonly note?: string | null
}

export interface PlaybookExecutorResult {
  readonly state: PlaybookExecutorState
  readonly statePath: string
}

export interface LoadedPlaybookExecutor {
  readonly state: PlaybookExecutorState
  readonly statePath: string
  resume(approval: FounderApproval): Promise<PlaybookExecutorResult>
}

const STATE_FILE = 'playbook-state.json'

const statePath = (runDir: string): string => join(runDir, STATE_FILE)

function currentPhaseId(playbook: OnboardingPlaybook, currentPhaseIndex: number): OnboardingPlaybookPhaseId | null {
  return playbook.phases[currentPhaseIndex]?.id ?? null
}

function stateFor(input: {
  readonly playbook: OnboardingPlaybook
  readonly currentPhaseIndex: number
  readonly status: PlaybookExecutorStatus
  readonly gate: PlaybookGateState | null
  readonly updatedAt: number
}): PlaybookExecutorState {
  return {
    version: 1,
    mode: input.playbook.mode,
    playbookId: input.playbook.id,
    phaseIds: input.playbook.phases.map((phase) => phase.id),
    currentPhaseIndex: input.currentPhaseIndex,
    currentPhaseId: currentPhaseId(input.playbook, input.currentPhaseIndex),
    status: input.status,
    gate: input.gate,
    updatedAt: input.updatedAt,
  }
}

async function persist(runDir: string, state: PlaybookExecutorState): Promise<void> {
  await mkdir(runDir, { recursive: true })
  await writeFile(statePath(runDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function assertPlaybookMatchesState(playbook: OnboardingPlaybook, state: PlaybookExecutorState): void {
  const phaseIds = playbook.phases.map((phase) => phase.id)
  if (state.version !== 1 || state.playbookId !== playbook.id || state.mode !== playbook.mode || state.phaseIds.join('\0') !== phaseIds.join('\0')) {
    throw new Error(`playbook state does not match playbook "${playbook.id}"`)
  }
  if (state.currentPhaseIndex < 0 || state.currentPhaseIndex > playbook.phases.length) {
    throw new Error(`playbook state has invalid cursor ${state.currentPhaseIndex}`)
  }
}

async function drive(playbook: OnboardingPlaybook, deps: PlaybookExecutorDeps, initialState: PlaybookExecutorState): Promise<PlaybookExecutorResult> {
  let state = initialState
  for (;;) {
    if (state.status === 'done' || state.status === 'awaiting-founder') return { state, statePath: statePath(deps.runDir) }

    const phase = playbook.phases[state.currentPhaseIndex]
    if (!phase) {
      state = stateFor({ playbook, currentPhaseIndex: playbook.phases.length, status: 'done', gate: null, updatedAt: deps.now() })
      await persist(deps.runDir, state)
      return { state, statePath: statePath(deps.runDir) }
    }

    if (phase.founderGate) {
      const reachedAt = deps.now()
      state = stateFor({
        playbook,
        currentPhaseIndex: state.currentPhaseIndex,
        status: 'awaiting-founder',
        gate: { phaseIndex: state.currentPhaseIndex, phaseId: phase.id, title: phase.title, kind: phase.kind, reachedAt, approvedAt: null, approvedBy: null, note: null },
        updatedAt: reachedAt,
      })
      await persist(deps.runDir, state)
      return { state, statePath: statePath(deps.runDir) }
    }

    await deps.runPhase({ playbook, phase, phaseIndex: state.currentPhaseIndex, state })
    state = stateFor({ playbook, currentPhaseIndex: state.currentPhaseIndex + 1, status: 'running', gate: null, updatedAt: deps.now() })
    await persist(deps.runDir, state)
  }
}

function initialState(playbook: OnboardingPlaybook, now: number): PlaybookExecutorState {
  return stateFor({ playbook, currentPhaseIndex: 0, status: 'running', gate: null, updatedAt: now })
}

function approvedState(playbook: OnboardingPlaybook, state: PlaybookExecutorState, approval: FounderApproval, now: number): PlaybookExecutorState {
  if (state.status !== 'awaiting-founder' || state.gate === null) {
    throw new Error(`playbook "${playbook.id}" is not awaiting founder approval`)
  }
  return stateFor({
    playbook,
    currentPhaseIndex: state.currentPhaseIndex + 1,
    status: 'running',
    gate: { ...state.gate, approvedAt: now, approvedBy: approval.approvedBy, note: approval.note ?? null },
    updatedAt: now,
  })
}

function parseState(raw: string): PlaybookExecutorState {
  const state = JSON.parse(raw) as PlaybookExecutorState
  if (state.version !== 1 || (state.status !== 'running' && state.status !== 'awaiting-founder' && state.status !== 'done')) {
    throw new Error('invalid playbook executor state')
  }
  return state
}

export async function readPlaybookExecutorState(runDir: string): Promise<PlaybookExecutorState> {
  return parseState(await readFile(statePath(runDir), 'utf8'))
}

export async function startPlaybookExecutor(input: StartPlaybookExecutorInput): Promise<PlaybookExecutorResult> {
  const state = initialState(input.playbook, input.now())
  await persist(input.runDir, state)
  return drive(input.playbook, input, state)
}

export async function resumePlaybookExecutor(input: ResumePlaybookExecutorInput): Promise<PlaybookExecutorResult> {
  const state = await readPlaybookExecutorState(input.runDir)
  assertPlaybookMatchesState(input.playbook, state)
  const approved = approvedState(input.playbook, state, input.approval, input.now())
  await persist(input.runDir, approved)
  return drive(input.playbook, input, approved)
}

export async function loadPlaybookExecutor(input: LoadPlaybookExecutorInput): Promise<LoadedPlaybookExecutor> {
  const state = await readPlaybookExecutorState(input.runDir)
  assertPlaybookMatchesState(input.playbook, state)
  return {
    state,
    statePath: statePath(input.runDir),
    resume: (approval) => resumePlaybookExecutor({ ...input, approval }),
  }
}
