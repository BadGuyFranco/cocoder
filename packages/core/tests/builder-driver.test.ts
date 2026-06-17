import { describe, expect, test, vi } from 'vitest'
import { createHeadlessBuilderDriver, createPaneBuilderDriver } from '../src/runner/builder-driver.js'
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
    async kill(ref) {
      calls.push({ method: 'kill', ref })
    },
    async closeSurface() {
      throw new Error('not used')
    },
  }
  return { host: h, calls }
}

describe('createPaneBuilderDriver', () => {
  test('delegates pane operations to SessionHost with the builder ref', async () => {
    const ref: SessionRef = { id: 'surface:bob', driver: 'fake' }
    const h = host([{ state: 'running' }, { state: 'exited', code: 0 }])
    const driver = createPaneBuilderDriver(h.host, ref)

    expect(driver.kind).toBe('pane')
    expect(driver.refId).toBe(ref.id)
    await driver.dispatch('atom 0')
    await driver.nudge('keep going')
    await driver.show()
    expect(await driver.readScreen()).toBe('screen')
    expect(await driver.alive()).toBe(true)
    expect(await driver.alive()).toBe(false)
    await driver.kill()

    expect(h.calls).toEqual([
      { method: 'sendInput', ref, text: 'atom 0' },
      { method: 'sendInput', ref, text: 'keep going' },
      { method: 'show', ref },
      { method: 'readScreen', ref },
      { method: 'status', ref },
      { method: 'status', ref },
      { method: 'kill', ref },
    ])
  })
})

const bob: ResolvedPersona = {
  id: 'bob',
  label: 'Bob',
  role: 'builder',
  writeScope: ['packages/**'],
  body: 'Bob body',
  cli: 'codex',
  model: 'gpt-5',
  mode: 'headless',
}

function adapter(prompts: string[] = []): Adapter {
  return {
    id: 'codex',
    runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
    headlessCapable: false,
    build(input) {
      prompts.push(input.prompt)
      return { command: 'codex', args: ['--prompt', input.prompt] }
    },
    preflight: async () => ({ ok: true, checks: [] }),
    listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
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

describe('createHeadlessBuilderDriver', () => {
  test('dispatch builds a one-shot prompt with scope, branch, dispatch, and placeholder marker only', async () => {
    const prompts: string[] = []
    const calls: HeadlessRunInput[] = []
    const driver = createHeadlessBuilderDriver({
      getAdapter: () => adapter(prompts),
      bob,
      cwd: '/repo/worktree',
      runDir: '/runs/run_1',
      scope: ['packages/**', 'docs/*.md'],
      sharedStandards: 'STANDARDS',
      runBranch: 'cocoder/run_1',
      runHeadless: async (input) => {
        calls.push(input)
        return { exitCode: 0, output: 'done' }
      },
    })

    await driver.dispatch('PROCEED atom 0')
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    expect(calls[0]).toMatchObject({ command: 'codex', cwd: '/repo/worktree', outPath: '/runs/run_1/bob-turn-0.out' })
    expect(calls[0]?.timeoutMs).toBe(14_400_000)
    expect(prompts[0]).toContain('PROCEED atom 0')
    expect(prompts[0]).toContain('packages/**')
    expect(prompts[0]).toContain('docs/*.md')
    expect(prompts[0]).toContain('cocoder/run_1')
    expect(prompts[0]).toContain('<<<COCODER-ATOM-#-DONE>>>')
    expect(prompts[0]).not.toContain('<<<COCODER-ATOM-0-DONE>>>')
  })

  test('readScreen grows from onData while a turn is in flight', async () => {
    const first = deferred<DispatchPlayResult>()
    const calls: HeadlessRunInput[] = []
    const driver = createHeadlessBuilderDriver({
      getAdapter: () => adapter(),
      bob,
      cwd: '/repo',
      runDir: '/runs/run_1',
      scope: ['packages/**'],
      sharedStandards: 'STANDARDS',
      runBranch: 'cocoder/run_1',
      runHeadless: async (input) => {
        calls.push(input)
        input.onData?.('line one\n')
        return first.promise
      },
    })

    await driver.dispatch('atom 0')
    await vi.waitFor(async () => expect(await driver.readScreen()).toContain('line one'))
    calls[0]?.onData?.('line two\n')
    await expect(driver.readScreen()).resolves.toContain('line two')
    first.resolve({ exitCode: 0, output: 'line one\nline two\n<<<COCODER-ATOM-0-DONE>>>' })
    await vi.waitFor(async () => expect(await driver.readScreen()).toContain('<<<COCODER-ATOM-0-DONE>>>'))
  })

  test('nudge is recorded-not-delivered while in flight and starts a fresh turn while idle', async () => {
    const first = deferred<DispatchPlayResult>()
    const prompts: string[] = []
    const calls: HeadlessRunInput[] = []
    const driver = createHeadlessBuilderDriver({
      getAdapter: () => adapter(prompts),
      bob,
      cwd: '/repo',
      runDir: '/runs/run_1',
      scope: ['packages/**'],
      sharedStandards: 'STANDARDS',
      runBranch: 'cocoder/run_1',
      runHeadless: async (input) => {
        calls.push(input)
        if (calls.length === 1) return first.promise
        return { exitCode: 0, output: 'nudge done' }
      },
    })

    await driver.dispatch('atom 0')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await driver.nudge('wake up while running')
    expect(calls).toHaveLength(1)

    first.resolve({ exitCode: 0, output: 'done' })
    await vi.waitFor(async () => expect(await driver.alive()).toBe(true))
    await driver.nudge('loop criterion red')
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(prompts[1]).toContain('loop criterion red')
  })

  test('alive is true before and during turns, false after nonzero exit and after kill', async () => {
    const failed = createHeadlessBuilderDriver({
      getAdapter: () => adapter(),
      bob,
      cwd: '/repo',
      runDir: '/runs/run_1',
      scope: ['packages/**'],
      sharedStandards: 'STANDARDS',
      runBranch: 'cocoder/run_1',
      runHeadless: async () => ({ exitCode: 2, output: 'failed' }),
    })
    expect(await failed.alive()).toBe(true)
    await failed.dispatch('fail')
    await vi.waitFor(async () => expect(await failed.alive()).toBe(false))

    const aborted = deferred<DispatchPlayResult>()
    const calls: HeadlessRunInput[] = []
    const killed = createHeadlessBuilderDriver({
      getAdapter: () => adapter(),
      bob,
      cwd: '/repo',
      runDir: '/runs/run_1',
      scope: ['packages/**'],
      sharedStandards: 'STANDARDS',
      runBranch: 'cocoder/run_1',
      runHeadless: async (input) => {
        calls.push(input)
        input.signal?.addEventListener('abort', () => aborted.resolve({ exitCode: -1, output: 'partial' }), { once: true })
        return aborted.promise
      },
    })

    await killed.dispatch('long running')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(await killed.alive()).toBe(true)
    await killed.kill()
    expect(calls[0]?.signal?.aborted).toBe(true)
    await vi.waitFor(async () => expect(await killed.alive()).toBe(false))
  })

  test('external run abort signal kills a headless builder turn', async () => {
    const controller = new AbortController()
    const aborted = deferred<DispatchPlayResult>()
    const calls: HeadlessRunInput[] = []
    const driver = createHeadlessBuilderDriver({
      getAdapter: () => adapter(),
      bob,
      cwd: '/repo',
      runDir: '/runs/run_1',
      scope: ['packages/**'],
      sharedStandards: 'STANDARDS',
      runBranch: 'cocoder/run_1',
      signal: controller.signal,
      runHeadless: async (input) => {
        calls.push(input)
        input.signal?.addEventListener('abort', () => aborted.resolve({ exitCode: -1, output: 'aborted' }), { once: true })
        return aborted.promise
      },
    })

    await driver.dispatch('long running')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(await driver.alive()).toBe(true)
    controller.abort()
    expect(calls[0]?.signal?.aborted).toBe(true)
    await vi.waitFor(async () => expect(await driver.alive()).toBe(false))
  })
})
