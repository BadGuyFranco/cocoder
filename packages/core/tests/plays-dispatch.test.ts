import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  dispatchPlay,
  type Adapter,
  type BuildInput,
  type BuiltCommand,
  type DispatchPlayResult,
  type HeadlessRunInput,
  type Play,
  type PlayAssignment,
  type SessionHost,
  type SessionRef,
  type SpawnOptions,
} from '../src/index.js'

const play: Play = {
  id: 'wrap-up',
  label: 'Wrap-up',
  kind: 'headless',
  writeScope: [],
  body: 'Default wrap-up procedure.',
}

const assignment: PlayAssignment = { cli: 'cursor-agent', model: 'gpt-5' }

const fakeRef: SessionRef = { id: 'surface:1', driver: 'fake' }

function fakeAdapter(build: BuiltCommand = { command: 'cursor-agent', args: ['-p', 'prompt'], stdoutPath: '/tmp/out.txt' }): {
  adapter: Adapter
  builtInputs: BuildInput[]
} {
  const builtInputs: BuildInput[] = []
  return {
    builtInputs,
    adapter: {
      id: 'cursor-agent',
      runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
      build(input) {
        builtInputs.push(input)
        return build
      },
      preflight: async () => ({ ok: true, checks: [] }),
      listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
    },
  }
}

// A headless Play runs as a captured subprocess; inject a fake runner so tests never spawn a real CLI.
function fakeRunHeadless(result: DispatchPlayResult = { exitCode: 0, output: 'closeout' }): {
  runHeadless: (i: HeadlessRunInput) => Promise<DispatchPlayResult>
  calls: HeadlessRunInput[]
} {
  const calls: HeadlessRunInput[] = []
  return {
    calls,
    runHeadless: async (i) => {
      calls.push(i)
      return result
    },
  }
}

function fakeSessionHost(over: Partial<SessionHost> = {}): { sessionHost: SessionHost; spawns: SpawnOptions[] } {
  const spawns: SpawnOptions[] = []
  return {
    spawns,
    sessionHost: {
      async spawn(opts) {
        spawns.push(opts)
        return fakeRef
      },
      async readScreen() {
        return ''
      },
      async status() {
        return { state: 'running' }
      },
      async waitForExit() {
        return { state: 'exited', code: 0 }
      },
      async sendInput() {},
      async show() {},
      async kill() {},
      ...over,
    },
  }
}

async function outPath(name = 'play.out'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'plays-dispatch-'))
  return join(dir, name)
}

describe('dispatchPlay', () => {
  test('composes the Play procedure and invocation task for the adapter', async () => {
    const out = await outPath()
    const { adapter, builtInputs } = fakeAdapter()
    const { sessionHost } = fakeSessionHost()
    const { runHeadless } = fakeRunHeadless()

    await dispatchPlay(
      { sessionHost, getAdapter: () => adapter, runHeadless },
      { play, assignment, persona: 'oscar', task: 'Summarize run 18.', cwd: '/repo', outPath: out },
    )

    expect(builtInputs[0]?.prompt).toContain('Default wrap-up procedure.')
    expect(builtInputs[0]?.prompt).toContain('## This invocation')
    expect(builtInputs[0]?.prompt).toContain('Summarize run 18.')
    expect(builtInputs[0]?.model).toBe('gpt-5')
  })

  test('a HEADLESS Play runs as a captured subprocess — no cmux pane spawned', async () => {
    const out = await outPath()
    const { adapter } = fakeAdapter({ command: 'cursor-agent', args: ['-p', 'hi'] })
    const { sessionHost, spawns } = fakeSessionHost()
    const { runHeadless, calls } = fakeRunHeadless()

    await dispatchPlay(
      { sessionHost, getAdapter: () => adapter, runHeadless },
      { play, assignment, persona: 'oscar', task: 'Do it.', cwd: '/repo', outPath: out, group: 'run_1', timeoutMs: 5000 },
    )

    expect(spawns).toHaveLength(0) // the whole point: headless => NO interactive cmux surface
    expect(calls[0]).toEqual({ command: 'cursor-agent', args: ['-p', 'hi'], cwd: '/repo', outPath: out, timeoutMs: 5000 })
  })

  test('returns the headless runner exit code and captured output', async () => {
    const out = await outPath()
    const { adapter } = fakeAdapter()
    const { sessionHost } = fakeSessionHost()
    const { runHeadless } = fakeRunHeadless({ exitCode: 2, output: 'partial closeout' })

    await expect(
      dispatchPlay(
        { sessionHost, getAdapter: () => adapter, runHeadless },
        { play, assignment, persona: 'oscar', task: 'Do it.', cwd: '/repo', outPath: out },
      ),
    ).resolves.toEqual({ exitCode: 2, output: 'partial closeout' })
  })

  test('an INTERACTIVE Play spawns a cmux pane and reads its captured output file', async () => {
    const out = await outPath()
    await mkdir(dirname(out), { recursive: true })
    const interactivePlay: Play = { ...play, kind: 'interactive' }
    const { adapter } = fakeAdapter({ command: 'cursor-agent', args: ['-p'], stdoutPath: out })
    const { sessionHost, spawns } = fakeSessionHost({
      async spawn(opts) {
        spawns.push(opts)
        await writeFile(out, 'closeout complete', 'utf8')
        return fakeRef
      },
    })

    const result = await dispatchPlay(
      { sessionHost, getAdapter: () => adapter },
      { play: interactivePlay, assignment, persona: 'oscar', task: 'Do it.', cwd: '/repo', outPath: out, group: 'run_1' },
    )

    expect(spawns[0]).toMatchObject({ command: 'cursor-agent', args: ['-p'], label: 'Wrap-up', group: 'run_1' })
    expect(result).toEqual({ exitCode: 0, output: 'closeout complete' })
  })
})
