import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type DebStatus, type RunnerIO, openRunStore, parseDirective, runRun } from '../src/index.js'
import { readResumeState } from '../src/runner/founder-stop.js'
import {
  askFounderContinue,
  baseDeps,
  deb,
  delegate,
  fakeIO,
  fakeSessionHost,
  input,
  scriptedGit,
  wrapup,
} from './runner.test-support.js'

describe('runRun (multi-atom loop)', () => {
  test('drives Bob through MULTIPLE atoms, commits each, ends on Oscar wrap-up', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/a.ts'], ['packages/b.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), delegate('atom 1'), wrapup('next: do atom 2')] }),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(store.getRun(result.runId)?.status).toBe('completed')
    expect(result.atoms).toBe(2)
    expect(result.committedShas).toHaveLength(2)
    expect(result.committedFiles).toEqual(['packages/a.ts', 'packages/b.ts'])
    expect(result.pickupPath).toMatch(/\/runs\/cocoder\/run_.*\/pickup\.md$/)

    // One work_item + one commit_link PER ATOM (the F8 continuation substrate, activated).
    const wis = store.listWorkItems(result.runId)
    expect(wis.map((w) => w.task)).toEqual(['atom 0', 'atom 1'])
    expect(wis.every((w) => w.status === 'done')).toBe(true)
    expect(store.listCommitLinks(result.runId).filter((c) => c.workItemId !== null).map((c) => c.files)).toEqual([['packages/a.ts'], ['packages/b.ts']])
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['run-start', 'spawn', 'delegation', 'builder-done', 'verify-pass', 'commit', 'wrapup', 'run-end']))
  })

  test('surfaces a mid-run founder decision as held, then accepts the next delegate on resume', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-mid-run-founder-resume-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const statusWrites: DebStatus[] = []
    const sends: string[] = []
    const git = scriptedGit([['packages/prep.ts'], ['packages/final.ts']])
    const held = await runRun(
      baseDeps({
        store,
        sessionHost: fakeSessionHost({ async sendInput(_ref, text) { sends.push(text) } }),
        git,
        io: fakeIO({
          directives: [
            delegate('prepare the compatibility shim'),
            askFounderContinue('Should the compatibility shim stay enabled by default?'),
          ],
          statusWrites,
        }),
      }),
      { ...input, deb, runsRoot },
    )

    expect(held.status).toBe('held')
    expect(held.atoms).toBe(1)
    expect(held.committedFiles).toEqual(['packages/prep.ts'])
    expect(store.getRun(held.runId)?.status).toBe('held')
    await expect(readResumeState(runDir)).resolves.toMatchObject({
      park: 'pre-dispatch',
      atomNumber: 1,
      founderResolution: {
        kind: 'ask-founder-continue',
        nextDirectivePath: join(runDir, 'directive-2.json'),
      },
    })

    await writeFile(join(runDir, 'directive-2.json'), `${JSON.stringify(delegate('finish the implementation with the founder answer: keep it enabled by default'))}\n`, 'utf8')
    const resumeSends: string[] = []
    const resumeIo: RunnerIO = {
      ...fakeIO({ directives: [], verdicts: [{ verdict: 'pass', reason: 'founder answer applied' }] }),
      async awaitDirective(path) {
        if (path.endsWith('directive-2.json')) return parseDirective(await readFile(path, 'utf8'))
        if (path.endsWith('directive-3.json')) return wrapup('done after remaining implementation')
        throw new Error(`unexpected directive path ${path}`)
      },
    }

    const resumed = await runRun(
      baseDeps({
        store,
        sessionHost: fakeSessionHost({ async sendInput(_ref, text) { resumeSends.push(text) } }),
        git,
        io: resumeIo,
      }),
      { ...input, deb, runsRoot, resumeRunId: held.runId, resumeFounderAnswer: 'Keep it enabled by default.' },
    )

    expect(resumed.status).toBe('completed')
    expect(resumed.atoms).toBe(2)
    expect(resumed.committedShas).toHaveLength(2)
    expect(resumed.committedFiles).toEqual(['packages/final.ts'])
    expect(store.listCommitLinks(resumed.runId).filter((link) => link.workItemId !== null).map((link) => link.files)).toEqual([
      ['packages/prep.ts'],
      ['packages/final.ts'],
    ])

    const events = store.listEvents(resumed.runId)
    const founderDecisionIndex = events.findIndex((event) => event.type === 'founder-decision-requested')
    const heldIndex = events.findIndex((event) => event.type === 'run-held')
    const resumedIndex = events.findIndex((event) => event.type === 'run-resumed')
    const secondDelegationIndex = events.findIndex((event) => event.type === 'delegation' && (event.data as { task?: unknown }).task === 'finish the implementation with the founder answer: keep it enabled by default')
    const wrapupIndex = events.findIndex((event) => event.type === 'wrapup')
    const completedRunEndIndex = events.findIndex((event) => event.type === 'run-end' && (event.data as { status?: unknown }).status === 'completed')
    expect(founderDecisionIndex).toBeGreaterThan(-1)
    expect(heldIndex).toBeGreaterThan(founderDecisionIndex)
    expect(resumedIndex).toBeGreaterThan(heldIndex)
    expect(secondDelegationIndex).toBeGreaterThan(resumedIndex)
    expect(wrapupIndex).toBeGreaterThan(secondDelegationIndex)
    expect(completedRunEndIndex).toBeGreaterThan(wrapupIndex)
    expect(events[founderDecisionIndex]?.data).toMatchObject({
      atom: 1,
      directivePath: expect.stringContaining('directive-1.json'),
      nextDirectivePath: expect.stringContaining('directive-2.json'),
      question: 'Should the compatibility shim stay enabled by default?',
      mode: 'ask-founder-continue',
    })
    expect(store.getRun(resumed.runId)?.status).toBe('completed')
    expect(statusWrites.some((status) => status.oscar === 'blocked' && status.waitCondition.includes('awaiting founder decision before directive 2'))).toBe(true)
    expect(sends.some((text) => text.includes('FOUNDER DECISION NEEDED') && text.includes('directive-2.json'))).toBe(true)
    const resumePrompt = resumeSends.find((prompt) => prompt.includes('# Resuming after founder decision'))
    expect(resumePrompt).toContain('Should the compatibility shim stay enabled by default?')
    expect(resumePrompt).toContain('Keep it enabled by default.')
    expect(resumePrompt).toContain(join(runDir, 'directive-2.json'))
    expect(resumePrompt).not.toContain(`First action: Write the required directive JSON to \`${join(runDir, 'directive-0.json')}\``)
  })
})
