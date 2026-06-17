import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  loadPlaybookExecutor,
  startPlaybookExecutor,
  type OnboardingPlaybook,
  type PlaybookExecutorState,
  type PlaybookPhaseAction,
} from '../src/index.js'

const readState = async (runDir: string): Promise<PlaybookExecutorState> =>
  JSON.parse(await readFile(join(runDir, 'playbook-state.json'), 'utf8')) as PlaybookExecutorState

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

      expect(actions).toEqual(['P1', 'P2'])
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

      expect(actions).toEqual(['P1', 'P2'])
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
})
