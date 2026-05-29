import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { SpawnOptions } from '@cocoder/core'
import { CmuxSessionHost, type CmuxCli } from '../src/index.js'
import {
  buildLaunchScript,
  diffNewWorkspace,
  parseExitFromScreen,
  shquote,
} from '../src/cmux/launch.js'
import { parseSurface, parseWorkspaceRefs } from '../src/cmux/cmux-cli.js'

describe('pure helpers', () => {
  test('shquote escapes embedded single quotes', () => {
    expect(shquote("it's")).toBe(`'it'\\''s'`)
  })

  test('buildLaunchScript bakes in cd, stdin-redirect, redirects, and the sentinel', () => {
    const opts: SpawnOptions = {
      persona: 'bob',
      command: 'codex',
      args: ['exec', 'do the thing'],
      cwd: '/repo',
      stdoutPath: '/run/out.log',
      stderrPath: '/run/err.log',
    }
    const script = buildLaunchScript(opts, 'TOK123')
    expect(script).toContain(`cd '/repo' && 'codex' 'exec' 'do the thing'`)
    expect(script).toContain(`> '/run/out.log'`)
    expect(script).toContain(`2> '/run/err.log'`)
    expect(script).toContain('< /dev/null') // codex hangs without this
    expect(script.trimEnd().endsWith('echo "TOK123:EXIT=$?"')).toBe(true)
  })

  test('parseExitFromScreen reads the code or returns null', () => {
    expect(parseExitFromScreen('blah\nTOK123:EXIT=0\n$ ', 'TOK123')).toBe(0)
    expect(parseExitFromScreen('TOK123:EXIT=137', 'TOK123')).toBe(137)
    expect(parseExitFromScreen('still running...', 'TOK123')).toBeNull()
  })

  test('diffNewWorkspace returns the single new ref, throws on ambiguity', () => {
    expect(diffNewWorkspace(['workspace:1'], ['workspace:1', 'workspace:2'])).toBe('workspace:2')
    expect(() => diffNewWorkspace(['a'], ['a'])).toThrow(/expected exactly 1/)
    expect(() => diffNewWorkspace(['a'], ['a', 'b', 'c'])).toThrow(/expected exactly 1/)
  })

  test('JSON parsers extract refs', () => {
    expect(parseWorkspaceRefs('{"workspaces":[{"ref":"workspace:1"},{"ref":"workspace:2"}]}')).toEqual([
      'workspace:1',
      'workspace:2',
    ])
    expect(
      parseSurface('{"pane_ref":"pane:2","surfaces":[{"ref":"surface:1"},{"ref":"surface:2","selected":true}]}'),
    ).toEqual({ paneRef: 'pane:2', surfaceRef: 'surface:2' })
  })
})

const TEST_TOKEN = 'COCODER_testtoken'

/** Fake cmux CLI: scripts list-workspaces (before/after open) and read-screen (running→exited). */
function makeFakeCli(): { cli: CmuxCli; calls: string[][] } {
  const calls: string[][] = []
  let opened = false
  let reads = 0
  const cli: CmuxCli = {
    async run(args) {
      calls.push([...args])
      const a = args.join(' ')
      if (a === 'list-workspaces --json') {
        return opened
          ? '{"workspaces":[{"ref":"workspace:1"},{"ref":"workspace:2"}]}'
          : '{"workspaces":[{"ref":"workspace:1"}]}'
      }
      if (args[0] === 'open') {
        opened = true
        return 'OK workspaces=2'
      }
      if (args[0] === 'list-pane-surfaces') {
        return '{"pane_ref":"pane:2","surfaces":[{"ref":"surface:2","selected":true}]}'
      }
      if (args[0] === 'read-screen') {
        reads += 1
        // First read: still running; second: sentinel present (with the injected token).
        return reads >= 2 ? `output...\n${TEST_TOKEN}:EXIT=0\n` : 'working...'
      }
      return '' // send, send-key, focus-pane, close-workspace
    },
  }
  return { cli, calls }
}

const tokenFactory = (): string => TEST_TOKEN

describe('CmuxSessionHost driver (fake cli)', () => {
  test('spawn diffs workspaces, resolves surface, writes a launch script, sends bash + Enter', async () => {
    const { cli, calls } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1, tokenFactory })

    const ref = await host.spawn({ persona: 'oscar', command: 'claude', args: ['-p', 'hi'], cwd: '/repo' })
    expect(ref).toEqual({ id: 'surface:2', driver: 'cmux' })

    // A launch script was written and contains the command + sentinel.
    const files = await readdir(scriptDir)
    expect(files).toHaveLength(1)
    const script = await readFile(join(scriptDir, files[0]!), 'utf8')
    expect(script).toContain(`cd '/repo' && 'claude' '-p' 'hi'`)
    expect(script).toContain('EXIT=$?')

    // bash <script> sent, then Enter.
    const sent = calls.find((c) => c[0] === 'send')
    expect(sent?.[1]).toBe('--surface')
    expect(sent?.[3]).toMatch(/^bash '.*cocoder-cmux-.*\.sh'$/)
    expect(calls.some((c) => c[0] === 'send-key' && c.includes('Enter'))).toBe(true)
  })

  test('status reports running then exited; waitForExit resolves with the code', async () => {
    const { cli } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1, tokenFactory })
    const ref = await host.spawn({ persona: 'bob', command: 'codex', args: ['exec', 'x'], cwd: '/repo' })

    expect(await host.status(ref)).toEqual({ state: 'running' }) // first read: working...
    expect(await host.waitForExit(ref, { timeoutMs: 1000 })).toEqual({ state: 'exited', code: 0 })
  })

  test('spawn auto-launches cmux when the socket is down, then proceeds', async () => {
    let up = false // socket starts unreachable (cmux app closed)
    let launched = 0
    let opened = false
    const cli: CmuxCli = {
      async run(args) {
        const a = args.join(' ')
        if (a === 'ping') {
          if (!up) throw new Error('Socket not found at …/cmux.sock')
          return 'PONG'
        }
        if (a === 'list-workspaces --json') {
          return opened ? '{"workspaces":[{"ref":"workspace:1"},{"ref":"workspace:2"}]}' : '{"workspaces":[{"ref":"workspace:1"}]}'
        }
        if (args[0] === 'open') {
          opened = true
          return 'OK'
        }
        if (args[0] === 'list-pane-surfaces') return '{"pane_ref":"pane:2","surfaces":[{"ref":"surface:2","selected":true}]}'
        return ''
      },
    }
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({
      cli,
      scriptDir,
      pollMs: 1,
      tokenFactory,
      hostReadyTimeoutMs: 1000,
      launchApp: async () => {
        launched += 1
        up = true // launching the app makes the socket reachable
      },
    })

    const ref = await host.spawn({ persona: 'oscar', command: 'claude', args: ['-p', 'hi'], cwd: '/repo' })
    expect(launched).toBe(1) // the app was auto-launched exactly once
    expect(ref).toEqual({ id: 'surface:2', driver: 'cmux' })
  })

  test('kill closes the workspace; methods reject unknown refs', async () => {
    const { cli, calls } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1, tokenFactory })
    const ref = await host.spawn({ persona: 'bob', command: 'codex', args: [], cwd: '/repo' })

    await host.kill(ref)
    expect(calls.some((c) => c[0] === 'close-workspace' && c.includes('workspace:2'))).toBe(true)
    await expect(host.status({ id: 'surface:999', driver: 'cmux' })).rejects.toThrow(/unknown session/)
  })
})
