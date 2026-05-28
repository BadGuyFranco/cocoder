import { describe, expect, test } from 'vitest'
import type { Exec, ExecResult } from '../src/index.js'
import { ClaudeAdapter, CodexAdapter, getAdapter, makeAdapterRegistry } from '../src/index.js'

const fakeExec =
  (responses: Record<string, ExecResult>): Exec =>
  async (command, args) =>
    responses[[command, ...args].join(' ')] ?? { code: 127, stdout: '', stderr: 'not found' }

describe('build() pins the spike invocations', () => {
  test('claude: -p, acceptEdits, add-dir, json; stdout captured to outPath; model optional', () => {
    const built = new ClaudeAdapter().build({ prompt: 'hi', model: 'opus', cwd: '/repo', outPath: '/run/o.json' })
    expect(built.command).toBe('claude')
    expect(built.args).toEqual([
      '-p',
      'hi',
      '--permission-mode',
      'acceptEdits',
      '--add-dir',
      '/repo',
      '--output-format',
      'json',
      '--model',
      'opus',
    ])
    expect(built.stdoutPath).toBe('/run/o.json')

    const noModel = new ClaudeAdapter().build({ prompt: 'hi', model: '', cwd: '/repo', outPath: '/run/o.json' })
    expect(noModel.args).not.toContain('--model')
  })

  test('codex: exec, -C cwd, bypass sandbox, -o outPath; no stdout redirect; model optional', () => {
    const built = new CodexAdapter().build({ prompt: 'do it', model: 'gpt', cwd: '/repo', outPath: '/run/last.txt' })
    expect(built.command).toBe('codex')
    expect(built.args).toEqual([
      'exec',
      'do it',
      '-C',
      '/repo',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '-o',
      '/run/last.txt',
      '-m',
      'gpt',
    ])
    expect(built.stdoutPath).toBeUndefined()
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

  test('codex: installed + logged in → ok', async () => {
    const exec = fakeExec({
      'codex --version': { code: 0, stdout: 'codex-cli 0.134.0', stderr: '' },
      'codex login status': { code: 0, stdout: 'Logged in using ChatGPT', stderr: '' },
    })
    expect((await new CodexAdapter(exec).preflight('')).ok).toBe(true)
  })
})

describe('registry', () => {
  test('resolves built-ins and throws on unknown cli', () => {
    const reg = makeAdapterRegistry()
    expect(getAdapter('claude', reg).id).toBe('claude')
    expect(getAdapter('codex', reg).id).toBe('codex')
    expect(() => getAdapter('cursor-agent', reg)).toThrow(/no adapter for cli/)
  })
})
