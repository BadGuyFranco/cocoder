import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createPlaybookPhaseAction,
  loadPlaybookExecutor,
  startPlaybookExecutor,
  type OnboardingPlaybook,
  type PlaybookP1AgentTurn,
  type PlaybookExecutorState,
  type PlaybookPhaseAction,
} from '../src/index.js'

const readState = async (runDir: string): Promise<PlaybookExecutorState> =>
  JSON.parse(await readFile(join(runDir, 'playbook-state.json'), 'utf8')) as PlaybookExecutorState
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T

describe('playbook executor', () => {
  test('persists cursor, pauses at founder gate, reloads, then resumes after approval', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'cocoder-playbook-executor-'))
    try {
      const playbook = {
        id: 'synthetic',
        title: 'Synthetic',
        mode: 'takeover',
        writeScope: ['cocoder/**'],
        modelPin: 'standard',
        objective: 'prove the cursor',
        phases: [
          { id: 'P1', title: 'Recon', kind: 'recon', founderGate: false, output: 'inventory' },
          { id: 'P2', title: 'Dual-source deep read', kind: 'deep-read-fanout', founderGate: false, output: 'notes' },
          { id: 'P3', title: 'Ratify', kind: 'ratify', founderGate: true, output: 'approval' },
          { id: 'P4', title: 'Prove', kind: 'prove', founderGate: false, output: 'proof' },
        ],
      } satisfies OnboardingPlaybook

      let clock = 1000
      const now = (): number => clock++
      const actions: string[] = []
      const runPhase: PlaybookPhaseAction = async ({ phase }) => {
        actions.push(phase.id)
        if (phase.id === 'P1') {
          await expect(readState(runDir)).resolves.toMatchObject({
            playbookId: 'synthetic',
            currentPhaseIndex: 0,
            currentPhaseId: 'P1',
            status: 'running',
            gate: null,
          })
        }
      }

      const paused = await startPlaybookExecutor({ playbook, runDir, now, runPhase })

      expect(actions).toEqual(['P1', 'P2', 'P3'])
      expect(paused.state).toMatchObject({
        playbookId: 'synthetic',
        mode: 'takeover',
        phaseIds: ['P1', 'P2', 'P3', 'P4'],
        currentPhaseIndex: 2,
        currentPhaseId: 'P3',
        status: 'awaiting-founder',
        gate: {
          phaseIndex: 2,
          phaseId: 'P3',
          title: 'Ratify',
          kind: 'ratify',
          approvedAt: null,
          approvedBy: null,
          note: null,
        },
      })
      await expect(readState(runDir)).resolves.toMatchObject(paused.state)

      const restartedActions: string[] = []
      const loaded = await loadPlaybookExecutor({
        playbook,
        runDir,
        now,
        runPhase: async ({ phase }) => {
          restartedActions.push(phase.id)
        },
      })

      expect(loaded.state).toEqual(paused.state)
      expect(restartedActions).toEqual([])

      const done = await loaded.resume({ approvedBy: 'founder', note: 'continue' })

      expect(actions).toEqual(['P1', 'P2', 'P3'])
      expect(restartedActions).toEqual(['P4'])
      expect(done.state).toMatchObject({
        playbookId: 'synthetic',
        currentPhaseIndex: 4,
        currentPhaseId: null,
        status: 'done',
        gate: null,
      })
      await expect(readState(runDir)).resolves.toMatchObject(done.state)
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })

  test('runs P1 action, writes takeover artifacts under runDir, pauses, then resumes to P2', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p1-'))
    const repoDir = join(root, 'repo')
    const runDir = join(root, 'run')
    try {
      await mkdir(join(repoDir, 'src'), { recursive: true })
      await writeFile(join(repoDir, 'README.md'), '# Fixture\nA fixture repo for takeover onboarding.\n', 'utf8')
      await writeFile(join(repoDir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'vitest' } }), 'utf8')
      await writeFile(join(repoDir, 'src', 'index.ts'), 'export const value = 1\n', 'utf8')

      const playbook = {
        id: 'takeover-fixture',
        title: 'Takeover Fixture',
        mode: 'takeover',
        writeScope: ['cocoder/**'],
        modelPin: 'top-tier',
        objective: 'prove P1',
        phases: [
          { id: 'P1', title: 'Recon', kind: 'recon', founderGate: true, output: 'P1 pickup' },
          { id: 'P2', title: 'Dual-source deep read', kind: 'deep-read-fanout', founderGate: true, output: 'P2 stub' },
        ],
      } satisfies OnboardingPlaybook

      const agentCalls: string[] = []
      const agentTurn: PlaybookP1AgentTurn = async ({ purpose }) => {
        agentCalls.push(purpose)
        if (purpose === 'recon') {
          return {
            subsystems: [
              {
                id: 'core',
                name: 'Core',
                pathGlobs: ['src/**'],
                entryPoints: ['src/index.ts'],
                validationCommands: ['package.json#test'],
                boundaryReason: 'Fixture source root.',
                allowedAdjacency: [],
              },
            ],
            humanMap: 'Core covers the fixture source root.',
            complexitySignals: {
              crossSubsystemCoupling: [],
              unclearOwnership: [],
              stackHeterogeneity: [],
              weakValidation: [],
              broadEntryPoints: [],
              highRiskSurfaces: [],
            },
          }
        }
        return {
          claims: [{ claim: 'The fixture exists to test takeover onboarding.', provenance: ['README.md'] }],
          openQuestions: ['What should P2 inspect first?'],
        }
      }
      let clock = 2000
      const p2Actions: string[] = []
      const runPhase = createPlaybookPhaseAction({
        repoDir,
        runDir,
        model: { modelTier: 'top-tier', cli: 'fake', model: 'fake-model' },
        gitReader: { recentCommits: async () => [], tags: async () => [] },
        agentTurn,
      })
      const recordingRunPhase: PlaybookPhaseAction = async (input) => {
        if (input.phase.id === 'P2') p2Actions.push(input.phase.id)
        await runPhase(input)
      }

      const paused = await startPlaybookExecutor({ playbook, runDir, now: () => clock++, runPhase: recordingRunPhase })

      expect(paused.state).toMatchObject({ status: 'awaiting-founder', currentPhaseId: 'P1', gate: { phaseId: 'P1', approvedAt: null } })
      expect(agentCalls).toEqual(['recon', 'intent'])
      const p1Dir = join(runDir, 'playbook', 'P1')
      await expect(stat(join(p1Dir, 'inventory.json'))).resolves.toBeDefined()
      await expect(stat(join(p1Dir, 'subsystems.json'))).resolves.toBeDefined()
      await expect(stat(join(p1Dir, 'intent.json'))).resolves.toBeDefined()
      await expect(stat(join(p1Dir, 'estimate.json'))).resolves.toBeDefined()
      await expect(stat(join(p1Dir, 'pickup.md'))).resolves.toBeDefined()

      await expect(readJson<{ readonly packageManifests: readonly unknown[] }>(join(p1Dir, 'inventory.json'))).resolves.toMatchObject({ packageManifests: [expect.objectContaining({ path: 'package.json' })] })
      await expect(readJson<{ readonly subsystems: readonly unknown[] }>(join(p1Dir, 'subsystems.json'))).resolves.toMatchObject({ version: 1, subsystems: [expect.objectContaining({ id: 'core' })] })
      await expect(readJson<{ readonly inferredFromArtifacts: readonly unknown[] }>(join(p1Dir, 'intent.json'))).resolves.toMatchObject({ version: 1, inferredFromArtifacts: [expect.objectContaining({ claim: 'The fixture exists to test takeover onboarding.' })] })
      await expect(readJson<{ readonly subsystemCount: number }>(join(p1Dir, 'estimate.json'))).resolves.toMatchObject({ version: 1, subsystemCount: 1 })
      await expect(readFile(join(p1Dir, 'pickup.md'), 'utf8')).resolves.toContain('## Spend Decision')
      await expect(stat(join(repoDir, 'cocoder'))).rejects.toThrow()

      const loaded = await loadPlaybookExecutor({ playbook, runDir, now: () => clock++, runPhase: recordingRunPhase })
      const p2Paused = await loaded.resume({ approvedBy: 'founder', note: 'continue' })

      expect(p2Paused.state).toMatchObject({ status: 'awaiting-founder', currentPhaseId: 'P2', gate: { phaseId: 'P2' } })
      expect(p2Actions).toEqual(['P2'])
      expect(agentCalls).toEqual(['recon', 'intent'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
