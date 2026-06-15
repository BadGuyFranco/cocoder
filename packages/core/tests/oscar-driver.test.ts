import { describe, expect, test, vi } from 'vitest'
import { createHeadlessOscarDriver, createPaneOscarDriver } from '../src/runner/oscar-driver.js'
import type { Adapter, DispatchPlayResult, HeadlessRunInput, ResolvedPersona } from '../src/index.js'
import type { SessionHost, SessionRef, SessionStatus } from '../src/session-host/index.js'

function host(statuses: SessionStatus[]): { host: SessionHost; calls: Array<{ method: string; ref: SessionRef; text?: string }> } {
  const calls: Array<{ method: string; ref: SessionRef; text?: string }> = []
  const h: SessionHost = {
    async spawn() {
      throw new Error('not used')
    },
    async readScreen(ref) {
      calls.push({ method: 'readScreen', ref })
      return 'screen'
    },
    async status(ref) {
      calls.push({ method: 'status', ref })
      return statuses.shift() ?? { state: 'exited', code: 0 }
    },
    async waitForExit() {
      throw new Error('not used')
    },
    async sendInput(ref, text) {
      calls.push({ method: 'sendInput', ref, text })
    },
    async show(ref) {
      calls.push({ method: 'show', ref })
    },
    async kill() {
      throw new Error('not used')
    },
    async closeSurface() {
      throw new Error('not used')
    },
  }
  return { host: h, calls }
}

describe('createPaneOscarDriver', () => {
  test('delegates pane operations to SessionHost with the Oscar ref', async () => {
    const ref: SessionRef = { id: 'surface:oscar', driver: 'fake' }
    const h = host([{ state: 'running' }, { state: 'exited', code: 0 }])
    const driver = createPaneOscarDriver(h.host, ref)

    expect(driver.kind).toBe('pane')
    expect(driver.refId).toBe(ref.id)
    await driver.send('next')
    await driver.nudge('wake up')
    await driver.show()
    expect(await driver.readScreen()).toBe('screen')
    expect(await driver.alive()).toBe(true)
    expect(await driver.alive()).toBe(false)

    expect(h.calls).toEqual([
      { method: 'sendInput', ref, text: 'next' },
      { method: 'sendInput', ref, text: 'wake up' },
      { method: 'show', ref },
      { method: 'readScreen', ref },
      { method: 'status', ref },
      { method: 'status', ref },
    ])
  })
})

const oscar: ResolvedPersona = {
  id: 'oscar',
  label: 'Oscar',
  role: 'orchestrator',
  writeScope: [],
  body: 'Oscar body',
  cli: 'claude',
  model: '',
  mode: 'headless',
}

function adapter(prompts: string[] = []): Adapter {
  return {
    id: 'claude',
    runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
    headlessCapable: false,
    build(input) {
      prompts.push(input.prompt)
      return { command: 'claude', args: ['--prompt', input.prompt] }
    },
    preflight: async () => ({ ok: true, checks: [] }),
    listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
  }
}

function headlessOptions(over: Partial<Parameters<typeof createHeadlessOscarDriver>[0]> = {}): Parameters<typeof createHeadlessOscarDriver>[0] {
  return {
    getAdapter: () => adapter(),
    oscar,
    cwd: '/repo',
    runDir: '/runs/run_1',
    launchPrompt: 'LAUNCH PROMPT with directive-0.json',
    turnPrompt: {
      sharedStandards: 'STANDARDS',
      oscarBody: oscar.body,
      priorityTitle: 'Demo',
      priorityGoal: 'Do it.',
      builderLabel: 'Bob',
      builderCli: 'codex',
      oscarWriteScope: [],
      runId: 'run_1',
      runBranch: 'cocoder/run_1',
    },
    ...over,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createHeadlessOscarDriver', () => {
  test('alive is true in flight and before completion, true after exit 0, false after nonzero or spawn error', async () => {
    const first = deferred<DispatchPlayResult>()
    let calls = 0
    const inFlight = createHeadlessOscarDriver(headlessOptions({
      runHeadless: async () => {
        calls += 1
        return first.promise
      },
    }))
    await vi.waitFor(() => expect(calls).toBe(1))
    expect(await inFlight.alive()).toBe(true)
    first.resolve({ exitCode: 0, output: 'ok' })
    await vi.waitFor(async () => expect(await inFlight.alive()).toBe(true))

    const nonzero = createHeadlessOscarDriver(headlessOptions({ runHeadless: async () => ({ exitCode: 2, output: 'failed' }) }))
    await vi.waitFor(async () => expect(await nonzero.alive()).toBe(false))

    const failed = createHeadlessOscarDriver(headlessOptions({ getAdapter: () => { throw new Error('spawn failed') } }))
    await vi.waitFor(async () => expect(await failed.alive()).toBe(false))
  })

  test('serializes sends behind the in-flight invocation', async () => {
    const first = deferred<DispatchPlayResult>()
    const second = deferred<DispatchPlayResult>()
    const third = deferred<DispatchPlayResult>()
    const calls: HeadlessRunInput[] = []
    const driver = createHeadlessOscarDriver(headlessOptions({
      runHeadless: async (input) => {
        calls.push(input)
        if (calls.length === 1) return first.promise
        if (calls.length === 2) return second.promise
        return third.promise
      },
    }))
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    const sendOne = driver.send('verify atom 0')
    const sendTwo = driver.send('next directive')
    await Promise.resolve()
    expect(calls).toHaveLength(1)

    first.resolve({ exitCode: 0, output: 'launch done' })
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]!.outPath).toBe('/runs/run_1/oscar-turn-1.out')
    second.resolve({ exitCode: 0, output: 'verify done' })
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[2]!.outPath).toBe('/runs/run_1/oscar-turn-2.out')
    third.resolve({ exitCode: 0, output: 'next done' })
    await Promise.all([sendOne, sendTwo])
  })

  test('readScreen never throws and changes while a turn is running', async () => {
    const first = deferred<DispatchPlayResult>()
    const driver = createHeadlessOscarDriver(headlessOptions({
      now: (() => {
        let t = 0
        return () => {
          t += 1000
          return t
        }
      })(),
      runHeadless: async () => first.promise,
    }))

    await vi.waitFor(async () => expect(await driver.readScreen()).toContain('[turn 0 running'))
    const a = await driver.readScreen()
    const b = await driver.readScreen()
    expect(a).toContain('[turn 0 running')
    expect(b).toContain('[turn 0 running')
    expect(a).not.toBe(b)
    first.resolve({ exitCode: 0, output: 'completed output' })
    await vi.waitFor(async () => expect(await driver.readScreen()).toContain('completed output'))
  })

  test('nudge resolves without spawning another invocation', async () => {
    const calls: HeadlessRunInput[] = []
    const driver = createHeadlessOscarDriver(headlessOptions({
      runHeadless: async (input) => {
        calls.push(input)
        return { exitCode: 0, output: 'done' }
      },
    }))
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    await driver.nudge('wake up')

    expect(calls).toHaveLength(1)
  })
})
