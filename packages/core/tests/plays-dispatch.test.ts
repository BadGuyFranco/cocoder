import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  dispatchPlay,
  runHeadlessProcess,
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
      headlessCapable: true,
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
    const { adapter } = fakeAdapter({ command: 'cursor-agent', args: ['-p', 'hi'], stdoutPath: out })
    const { sessionHost, spawns } = fakeSessionHost()
    const { runHeadless, calls } = fakeRunHeadless()

    await dispatchPlay(
      { sessionHost, getAdapter: () => adapter, runHeadless },
      { play, assignment, persona: 'oscar', task: 'Do it.', cwd: '/repo', outPath: out, group: 'run_1', timeoutMs: 5000 },
    )

    expect(spawns).toHaveLength(0) // the whole point: headless => NO interactive cmux surface
    expect(calls[0]).toEqual({ command: 'cursor-agent', args: ['-p', 'hi'], cwd: '/repo', outPath: out, timeoutMs: 5000 })
  })

  test('a headless command can own the answer file while stdout is captured to a sidecar', async () => {
    const out = await outPath()
    const { adapter } = fakeAdapter({ command: 'codex', args: ['exec', '--output-last-message', out] })
    const { sessionHost } = fakeSessionHost()
    const calls: HeadlessRunInput[] = []

    const result = await dispatchPlay(
      {
        sessionHost,
        getAdapter: () => adapter,
        runHeadless: async (i) => {
          calls.push(i)
          await writeFile(out, 'clean final answer', 'utf8')
          return { exitCode: 0, output: 'verbose transcript' }
        },
      },
      { play, assignment, persona: 'oscar', task: 'Do it.', cwd: '/repo', outPath: out },
    )

    expect(calls[0]?.outPath).toBe(`${out}.stdout`)
    expect(result).toEqual({ exitCode: 0, output: 'clean final answer' })
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
      { play: interactivePlay, assignment, persona: 'oscar', task: 'Do it.', cwd: '/repo', outPath: out, group: 'run_1', groupLabel: 'CoCoder · playbook:drift-audit #1' },
    )

    expect(spawns[0]).toMatchObject({ command: 'cursor-agent', args: ['-p'], label: 'Wrap-up', group: 'run_1', groupLabel: 'CoCoder · playbook:drift-audit #1' })
    expect(result).toEqual({ exitCode: 0, output: 'closeout complete' })
  })

  test('persona mode only forces headless hosting; visible and absent keep Play kind behavior', async () => {
    const cases = [
      { name: 'interactive + headless mode', kind: 'interactive' as const, personaMode: 'headless' as const, headless: true },
      { name: 'headless + visible mode', kind: 'headless' as const, personaMode: 'visible' as const, headless: true },
      { name: 'interactive + absent mode', kind: 'interactive' as const, personaMode: undefined, headless: false },
      { name: 'headless + absent mode', kind: 'headless' as const, personaMode: undefined, headless: true },
    ]

    for (const c of cases) {
      const out = await outPath(`${c.name}.out`)
      await mkdir(dirname(out), { recursive: true })
      const { adapter, builtInputs } = fakeAdapter({ command: 'cursor-agent', args: ['-p'], stdoutPath: out })
      const { runHeadless, calls } = fakeRunHeadless()
      const { sessionHost, spawns } = fakeSessionHost({
        async spawn(opts) {
          spawns.push(opts)
          await writeFile(out, 'visible closeout', 'utf8')
          return fakeRef
        },
      })

      await dispatchPlay(
        { sessionHost, getAdapter: () => adapter, runHeadless },
        { play: { ...play, kind: c.kind }, assignment, personaMode: c.personaMode, persona: 'oscar', task: 'Do it.', cwd: '/repo', outPath: out },
      )

      expect(calls, c.name).toHaveLength(c.headless ? 1 : 0)
      expect(spawns, c.name).toHaveLength(c.headless ? 0 : 1)
      expect(builtInputs[0]?.headless, c.name).toBe(c.headless)
    }
  })
})

describe('runHeadlessProcess', () => {
  test('onData receives incremental chunks whose concatenation equals the resolved output', async () => {
    const out = await outPath()
    const chunks: string[] = []

    const result = await runHeadlessProcess({
      command: process.execPath,
      args: ['-e', "process.stdout.write('alpha'); process.stderr.write('beta')"],
      cwd: process.cwd(),
      outPath: out,
      onData: (chunk) => chunks.push(chunk),
    })

    expect(result.exitCode).toBe(0)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks.join('')).toBe(result.output)
    expect(result.output).toContain('alpha')
    expect(result.output).toContain('beta')
  })

  test('a throwing onData callback does not reject or corrupt captured output', async () => {
    const out = await outPath()

    await expect(
      runHeadlessProcess({
        command: process.execPath,
        args: ['-e', "process.stdout.write('complete')"],
        cwd: process.cwd(),
        outPath: out,
        onData: () => {
          throw new Error('observer failed')
        },
      }),
    ).resolves.toEqual({ exitCode: 0, output: 'complete' })
  })

  test('omitting onData preserves final output capture and outPath write', async () => {
    const out = await outPath()

    const result = await runHeadlessProcess({
      command: process.execPath,
      args: ['-e', "process.stdout.write('final-only')"],
      cwd: process.cwd(),
      outPath: out,
    })

    expect(result).toEqual({ exitCode: 0, output: 'final-only' })
    await expect(readFile(out, 'utf8')).resolves.toBe('final-only')
  })

  test('aborting the signal kills a running child and preserves partial output', async () => {
    const out = await outPath()
    const controller = new AbortController()
    const startedAt = Date.now()

    const result = await runHeadlessProcess({
      command: process.execPath,
      args: ['-e', "process.stdout.write('started\\n'); setTimeout(() => process.stdout.write('never\\n'), 3000)"],
      cwd: process.cwd(),
      outPath: out,
      signal: controller.signal,
      onData: (chunk) => {
        if (chunk.includes('started')) controller.abort()
      },
    })

    expect(Date.now() - startedAt).toBeLessThan(1500)
    expect(result.exitCode).toBe(-1)
    expect(result.output).toContain('started')
    expect(result.output).not.toContain('never')
    await expect(readFile(out, 'utf8')).resolves.toBe(result.output)
  })

  test('a pre-aborted signal kills the child promptly', async () => {
    const out = await outPath()
    const controller = new AbortController()
    controller.abort()
    const startedAt = Date.now()

    const result = await runHeadlessProcess({
      command: process.execPath,
      args: ['-e', "setTimeout(() => process.stdout.write('never\\n'), 3000)"],
      cwd: process.cwd(),
      outPath: out,
      signal: controller.signal,
    })

    expect(Date.now() - startedAt).toBeLessThan(1500)
    expect(result).toEqual({ exitCode: -1, output: '' })
    await expect(readFile(out, 'utf8')).resolves.toBe('')
  })

  test('omitting signal preserves successful final output capture', async () => {
    const out = await outPath()

    const result = await runHeadlessProcess({
      command: process.execPath,
      args: ['-e', "process.stdout.write('no-signal')"],
      cwd: process.cwd(),
      outPath: out,
    })

    expect(result).toEqual({ exitCode: 0, output: 'no-signal' })
    await expect(readFile(out, 'utf8')).resolves.toBe('no-signal')
  })
})
