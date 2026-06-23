import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import * as founderStop from '../src/runner/founder-stop.js'
import {
  founderStopSignalPath,
  readFounderStopSignal,
  readResumeState,
  resumeStatePath,
  STOP_SIGNAL_FILENAME,
  writeResumeState,
  type ResumeState,
} from '../src/runner/founder-stop.js'

async function tempRunDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cocoder-founder-stop-'))
}

describe('founder stop contract', () => {
  test('reader returns null when the founder-stop artifact is absent', async () => {
    await expect(readFounderStopSignal(await tempRunDir())).resolves.toBeNull()
  })

  test('reads a valid founder-explicit stop signal', async () => {
    const runDir = await tempRunDir()
    const signal = { kind: 'founder-stop', recordedBy: 'bob', note: 'Founder said stop after this message.' }
    await writeFile(founderStopSignalPath(runDir), `${JSON.stringify(signal, null, 2)}\n`, 'utf8')

    await expect(readFounderStopSignal(runDir)).resolves.toEqual(signal)
    expect(founderStopSignalPath(runDir)).toBe(join(runDir, STOP_SIGNAL_FILENAME))
  })

  test('throws on malformed founder-stop JSON', async () => {
    const runDir = await tempRunDir()
    await writeFile(founderStopSignalPath(runDir), '{not json', 'utf8')

    await expect(readFounderStopSignal(runDir)).rejects.toThrow(SyntaxError)
  })

  test.each<ResumeState>([
    {
      park: 'pre-dispatch',
      atomNumber: 0,
    },
    {
      park: 'pre-dispatch',
      atomNumber: 1,
      directive: { kind: 'delegate', task: 'implement atom 0' },
    },
    {
      park: 'during-exec',
      activeAtomNumber: 1,
      directive: {
        kind: 'delegate',
        task: 'continue atom 1',
        loop: { goal: 'make tests green', criterion: 'pnpm test exits 0', maxIterations: 3, wallClockMs: 60_000 },
      },
      waitMonitorCursor: { target: 'bob', sessionRef: 'pane-1', artifactPath: 'directive-1.json', samples: 4 },
    },
    {
      park: 'pre-verdict',
      activeAtomNumber: 2,
      verifyRequest: { directivePath: 'directive-2.json', verifyPath: 'verify-2.json', handedTo: 'oscar' },
    },
  ])('resume-state record write/read round-trips %s', async (state) => {
    const runDir = await tempRunDir()

    await writeResumeState(runDir, state)

    await expect(readResumeState(runDir)).resolves.toEqual(state)
    expect(resumeStatePath(runDir)).toBe(join(runDir, 'resume-state.json'))
  })

  test('the module exposes no persona self-stop or auto-stop trigger', () => {
    const exportedNames = Object.keys(founderStop)

    expect(exportedNames).not.toContain('requestFounderStop')
    expect(exportedNames).not.toContain('triggerFounderStop')
    expect(exportedNames).not.toContain('selfStop')
    expect(exportedNames).not.toContain('autoStop')
    expect(exportedNames.filter((name) => /self.*stop|stop.*self|auto.*stop|stop.*auto/i.test(name))).toEqual([])
    expect(exportedNames.filter((name) => /^write.*stop/i.test(name))).toEqual([])
  })
})
