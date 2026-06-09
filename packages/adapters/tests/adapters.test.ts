import { describe, expect, test } from 'vitest'
import type { Exec, ExecResult } from '../src/index.js'
import { ClaudeAdapter, CodexAdapter, CursorAgentAdapter, getAdapter, makeAdapterRegistry } from '../src/index.js'

const fakeExec =
  (responses: Record<string, ExecResult>): Exec =>
  async (command, args) =>
    responses[[command, ...args].join(' ')] ?? { code: 127, stdout: '', stderr: 'not found' }

const containsSubsequence = (values: readonly string[], subsequence: readonly string[]): boolean =>
  subsequence.length === 0 || values.some((_, i) => subsequence.every((value, j) => values[i + j] === value))

describe('build() pins the spike invocations', () => {
  test('claude: interactive — Oscar keeps slash commands, acceptEdits, prompt after --; model optional', () => {
    const built = new ClaudeAdapter().build({ persona: 'oscar', prompt: 'hi', model: 'opus', cwd: '/repo', outPath: '/run/o.json' })
    expect(built.command).toBe('claude')
    expect(built.args).toEqual(['--permission-mode', 'acceptEdits', '--model', 'opus', '--', 'hi'])
    expect(built.stdoutPath).toBeUndefined() // interactive — no redirect

    const noModel = new ClaudeAdapter().build({ persona: 'oscar', prompt: 'hi', model: '', cwd: '/repo', outPath: '/run/o.json' })
    expect(noModel.args).toEqual(['--permission-mode', 'acceptEdits', '--', 'hi'])
  })

  test('claude: interactive — non-Oscar lanes still disable slash commands', () => {
    const built = new ClaudeAdapter().build({ persona: 'deb', prompt: 'hi', model: 'sonnet', cwd: '/repo', outPath: '/run/o.json' })
    expect(built.command).toBe('claude')
    expect(built.args).toEqual(['--disable-slash-commands', '--permission-mode', 'acceptEdits', '--model', 'sonnet', '--', 'hi'])

    const noModel = new ClaudeAdapter().build({ persona: 'deb', prompt: 'hi', model: '', cwd: '/repo', outPath: '/run/o.json' })
    expect(noModel.args).toEqual(['--disable-slash-commands', '--permission-mode', 'acceptEdits', '--', 'hi'])
  })

  test('codex: interactive — bypass approvals+sandbox, disables apps, positional prompt; model optional', () => {
    const built = new CodexAdapter().build({ prompt: 'do it', model: 'gpt', cwd: '/repo', outPath: '/run/last.txt' })
    expect(built.command).toBe('codex')
    expect(built.args).toEqual(['--dangerously-bypass-approvals-and-sandbox', '--disable', 'apps', '-m', 'gpt', 'do it'])
    expect(built.stdoutPath).toBeUndefined()

    const noModel = new CodexAdapter().build({ prompt: 'do it', model: '', cwd: '/repo', outPath: '/run/last.txt' })
    expect(noModel.args).toEqual(['--dangerously-bypass-approvals-and-sandbox', '--disable', 'apps', 'do it'])
  })

  test('cursor-agent: headless print-mode, output captured; model optional', () => {
    const built = new CursorAgentAdapter().build({ prompt: 'wrap it up', model: 'gpt-5', cwd: '/repo', outPath: '/run/out.txt' })
    expect(built.command).toBe('cursor-agent')
    expect(built.args).toEqual(['-p', '--output-format', 'text', '--force', '--trust', '--model', 'gpt-5', 'wrap it up'])
    expect(built.stdoutPath).toBe('/run/out.txt')

    const noModel = new CursorAgentAdapter().build({ prompt: 'wrap it up', model: '', cwd: '/repo', outPath: '/run/out.txt' })
    expect(noModel.args).toEqual(['-p', '--output-format', 'text', '--force', '--trust', 'wrap it up'])
    expect(noModel.stdoutPath).toBe('/run/out.txt')
  })
})

describe('runReadiness profiles', () => {
  test('declares each built-in CLI readiness profile', () => {
    expect(new ClaudeAdapter().runReadiness).toEqual({
      mechanism: 'launch-flags',
      flags: ['--permission-mode', 'acceptEdits'],
      managesUserConfig: false,
      detail: 'managed by CoCoder: --permission-mode acceptEdits (launch flags; no user config modified)',
    })
    expect(new CodexAdapter().runReadiness).toEqual({
      mechanism: 'launch-flags',
      flags: ['--dangerously-bypass-approvals-and-sandbox', '--disable', 'apps'],
      managesUserConfig: false,
      detail: 'managed by CoCoder: --dangerously-bypass-approvals-and-sandbox; --disable apps (launch flags; no user config modified)',
    })
    expect(new CursorAgentAdapter().runReadiness).toEqual({
      mechanism: 'launch-flags',
      flags: ['--force', '--trust'],
      managesUserConfig: false,
      detail: 'managed by CoCoder: --force --trust (launch flags; no user config modified)',
    })
  })

  test('build output contains the declared readiness flags', () => {
    const cases = [
      new ClaudeAdapter(),
      new CodexAdapter(),
      new CursorAgentAdapter(),
    ] as const

    for (const adapter of cases) {
      const built = adapter.build({ persona: 'oscar', prompt: 'hi', model: 'm', cwd: '/repo', outPath: '/run/out.txt' })
      expect(containsSubsequence(built.args, adapter.runReadiness.flags)).toBe(true)
    }
  })
})

describe('preflight() (injected exec)', () => {
  test('claude: installed + authed → ok', async () => {
    const exec = fakeExec({
      'claude --version': { code: 0, stdout: '2.1.156', stderr: '' },
      'claude auth status': { code: 0, stdout: '{"loggedIn": true}', stderr: '' },
    })
    const r = await new ClaudeAdapter(exec).preflight('')
    expect(r.ok).toBe(true)
    expect(r.checks.find((c) => c.name === 'authenticated')?.ok).toBe(true)
  })

  test('claude: not logged in → not ok with a clear reason', async () => {
    const exec = fakeExec({
      'claude --version': { code: 0, stdout: '2.1.156', stderr: '' },
      'claude auth status': { code: 0, stdout: '{"loggedIn": false}', stderr: '' },
    })
    const r = await new ClaudeAdapter(exec).preflight('')
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.name === 'authenticated')?.detail).toMatch(/not logged in/)
  })

  test('codex: not installed → not ok, auth skipped', async () => {
    const r = await new CodexAdapter(fakeExec({})).preflight('')
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.name === 'installed')?.ok).toBe(false)
    expect(r.checks.find((c) => c.name === 'authenticated')?.detail).toMatch(/skipped/)
  })

  test('codex: installed + logged in (status on STDERR) → ok', async () => {
    // codex login status prints to stderr with an empty stdout — preflight must check both.
    const exec = fakeExec({
      'codex --version': { code: 0, stdout: 'codex-cli 0.134.0', stderr: '' },
      'codex login status': { code: 0, stdout: '', stderr: 'Logged in using ChatGPT' },
    })
    expect((await new CodexAdapter(exec).preflight('')).ok).toBe(true)
  })

  test('cursor-agent: installed + list-models succeeds → ok', async () => {
    const exec = fakeExec({
      'cursor-agent --version': { code: 0, stdout: '0.1.0', stderr: '' },
      'cursor-agent --list-models': { code: 0, stdout: 'gpt-5\nsonnet-4', stderr: '' },
    })
    const r = await new CursorAgentAdapter(exec).preflight('gpt-5')
    expect(r.ok).toBe(true)
    expect(r.checks.find((c) => c.name === 'authenticated')?.ok).toBe(true)
    expect(r.checks.find((c) => c.name === 'model')?.detail).toBe('gpt-5')
  })

  test('cursor-agent: not installed → not ok, auth skipped', async () => {
    const r = await new CursorAgentAdapter(fakeExec({})).preflight('')
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.name === 'installed')?.ok).toBe(false)
    expect(r.checks.find((c) => c.name === 'authenticated')?.detail).toBe('skipped (cursor-agent not installed)')
    expect(r.checks.find((c) => c.name === 'model')?.detail).toBe('(cursor-agent default)')
  })
})

describe('listModels() (injected exec)', () => {
  test('cursor-agent: parses model lines and drops headers/blanks', async () => {
    const exec = fakeExec({
      'cursor-agent --list-models': { code: 0, stdout: 'Available models for this account:\n\ngpt-5\nsonnet-4\nsonnet-4-thinking\n', stderr: '' },
    })

    const r = await new CursorAgentAdapter(exec).listModels()

    expect(r).toEqual({
      canEnumerate: true,
      models: ['gpt-5', 'sonnet-4', 'sonnet-4-thinking'],
      detail: 'cursor-agent --list-models',
    })
  })

  test('cursor-agent: non-zero list-models degrades clearly', async () => {
    const exec = fakeExec({
      'cursor-agent --list-models': { code: 2, stdout: '', stderr: 'auth failed' },
    })

    const r = await new CursorAgentAdapter(exec).listModels()

    expect(r).toEqual({
      canEnumerate: false,
      models: [],
      detail: 'cursor-agent --list-models failed (code 2)',
    })
  })

  test('codex: no documented model enumeration command', async () => {
    const r = await new CodexAdapter(fakeExec({})).listModels()

    expect(r).toEqual({
      canEnumerate: false,
      models: [],
      detail: 'codex exposes no model-enumeration command — Default + free-text',
    })
  })

  test('claude: no documented model enumeration command', async () => {
    const r = await new ClaudeAdapter(fakeExec({})).listModels()

    expect(r).toEqual({
      canEnumerate: false,
      models: [],
      detail: 'claude exposes no model-enumeration command — Default + free-text',
    })
  })
})

describe('registry', () => {
  test('resolves built-ins and throws on unknown cli', () => {
    const reg = makeAdapterRegistry()
    expect(getAdapter('claude', reg).id).toBe('claude')
    expect(getAdapter('codex', reg).id).toBe('codex')
    expect(getAdapter('cursor-agent', reg).id).toBe('cursor-agent')
    expect([...reg.keys()]).toContain('cursor-agent')
    expect(() => getAdapter('missing', reg)).toThrow(/no adapter for cli/)
  })
})
