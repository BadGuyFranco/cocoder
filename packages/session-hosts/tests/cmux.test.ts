import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { SpawnOptions } from '@cocoder/core'
import { CmuxSessionHost, type CmuxCli } from '../src/index.js'
import { buildLaunchScript, diffNewWorkspace, parseExitFromScreen, shquote } from '../src/cmux/launch.js'
import { parseOkRef, parsePaneRefs, parseSurface, parseWorkspaceRefs } from '../src/cmux/cmux-cli.js'

describe('pure helpers', () => {
  test('shquote escapes embedded single quotes', () => {
    expect(shquote("it's")).toBe(`'it'\\''s'`)
  })

  test('buildLaunchScript tees output to the pane + log, with cd, stdin-redirect, and a sentinel', () => {
    const opts: SpawnOptions = {
      persona: 'bob',
      command: 'codex',
      args: ['exec', 'do the thing'],
      cwd: '/repo',
      stdoutPath: '/run/out.log',
    }
    const script = buildLaunchScript(opts, 'TOK123')
    expect(script).toContain(`cd '/repo' && 'codex' 'exec' 'do the thing' < /dev/null`)
    expect(script).toContain(`2>&1 | tee '/run/out.log'`) // visible in pane AND captured
    expect(script).toContain('EXIT=${PIPESTATUS[0]}') // agent's exit through the tee, not tee's
    expect(script).toContain('< /dev/null') // codex hangs without this
  })

  test('buildLaunchScript without a log path runs plainly with $? sentinel', () => {
    const script = buildLaunchScript({ persona: 'x', command: 'claude', args: ['-p', 'hi'], cwd: '/r' }, 'T')
    expect(script).toContain(`cd '/r' && 'claude' '-p' 'hi' < /dev/null`)
    expect(script).toContain('T:EXIT=$?')
    expect(script).not.toContain('tee')
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

  test('parseOkRef / parsePaneRefs extract refs from command output', () => {
    expect(parseOkRef('OK workspace:4', 'workspace')).toBe('workspace:4')
    expect(parseOkRef('OK surface:5 workspace:4', 'surface')).toBe('surface:5')
    expect(() => parseOkRef('OK', 'workspace')).toThrow(/expected a workspace ref/)
    expect(parsePaneRefs('* pane:4  [1 surface]  [focused]\n  pane:5  [1 surface]')).toEqual(['pane:4', 'pane:5'])
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

/** Fake cmux CLI modelling the new-workspace (first persona) + new-split (later persona) flow. */
function makeFakeCli(opts: { up?: boolean; onLaunch?: () => void } = {}): { cli: CmuxCli; calls: string[][] } {
  const calls: string[][] = []
  let up = opts.up ?? true
  let nextWs = 2
  let nextSurface = 2
  let panes = ['pane:2']
  const reads = new Map<string, number>()
  const cli: CmuxCli = {
    async run(args) {
      calls.push([...args])
      const a = args.join(' ')
      if (a === 'ping') {
        if (!up) throw new Error('Socket not found')
        return 'PONG'
      }
      if (args[0] === 'new-workspace') return `OK workspace:${nextWs}`
      if (args[0] === 'list-pane-surfaces') return `{"pane_ref":"pane:2","surfaces":[{"ref":"surface:2","selected":true}]}`
      if (args[0] === 'list-panes') return panes.join('\n')
      if (args[0] === 'new-split') {
        nextSurface = 3
        panes = ['pane:2', 'pane:3']
        return `OK surface:3 workspace:${nextWs}`
      }
      if (args[0] === 'read-screen') {
        const ref = args[2] ?? ''
        const n = (reads.get(ref) ?? 0) + 1
        reads.set(ref, n)
        return n >= 2 ? `output...\n${TEST_TOKEN}:EXIT=0\n` : 'working...'
      }
      return '' // rename-tab, send, send-key, focus-pane, close-surface
    },
  }
  return { cli, calls }
}

const tokenFactory = (): string => TEST_TOKEN

describe('CmuxSessionHost driver (fake cli)', () => {
  test('spawn creates a named workspace, labels the pane, writes a tee script, sends bash + Enter', async () => {
    const { cli, calls } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1, tokenFactory })

    const ref = await host.spawn({ persona: 'oscar', label: 'Oscar', command: 'claude', args: ['-p', 'hi'], cwd: '/repo', stdoutPath: '/run/oscar.out' })
    expect(ref).toEqual({ id: 'surface:2', driver: 'cmux' })

    const newWs = calls.find((c) => c[0] === 'new-workspace')
    expect(newWs).toContain('--name')
    expect(newWs).toContain('Oscar')
    expect(newWs).toContain('--cwd')
    expect(calls.some((c) => c[0] === 'rename-tab' && c.includes('Oscar'))).toBe(true)
    expect(calls.some((c) => c[0] === 'focus-pane')).toBe(true) // brought to front

    const files = await readdir(scriptDir)
    const script = await readFile(join(scriptDir, files[0]!), 'utf8')
    expect(script).toContain(`cd '/repo' && 'claude' '-p' 'hi' < /dev/null`)
    expect(script).toContain(`tee '/run/oscar.out'`)
    const sent = calls.find((c) => c[0] === 'send')
    expect(sent?.[3]).toMatch(/^bash '.*cocoder-cmux-.*\.sh'$/)
    expect(calls.some((c) => c[0] === 'send-key' && c.includes('Enter'))).toBe(true)
  })

  test('two personas of the same run share a workspace as split panes', async () => {
    const { cli, calls } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1, tokenFactory })

    const oscar = await host.spawn({ persona: 'oscar', label: 'Oscar', command: 'claude', args: [], cwd: '/repo', group: 'run_1' })
    const bob = await host.spawn({ persona: 'bob', label: 'Bob', command: 'codex', args: [], cwd: '/repo', group: 'run_1' })

    expect(oscar.id).toBe('surface:2')
    expect(bob.id).toBe('surface:3')
    // Oscar created the workspace; Bob split INTO it (no second new-workspace).
    expect(calls.filter((c) => c[0] === 'new-workspace')).toHaveLength(1)
    const split = calls.find((c) => c[0] === 'new-split')
    expect(split).toEqual(['new-split', 'right', '--workspace', 'workspace:2', '--focus', 'true'])
  })

  test('status reports running then exited; waitForExit resolves with the code', async () => {
    const { cli } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1, tokenFactory })
    const ref = await host.spawn({ persona: 'bob', command: 'codex', args: ['exec', 'x'], cwd: '/repo' })

    expect(await host.status(ref)).toEqual({ state: 'running' })
    expect(await host.waitForExit(ref, { timeoutMs: 1000 })).toEqual({ state: 'exited', code: 0 })
  })

  test('kill closes the pane surface (not the shared workspace); methods reject unknown refs', async () => {
    const { cli, calls } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1, tokenFactory })
    const ref = await host.spawn({ persona: 'bob', command: 'codex', args: [], cwd: '/repo' })

    await host.kill(ref)
    expect(calls.some((c) => c[0] === 'close-surface' && c.includes('surface:2'))).toBe(true)
    await expect(host.status({ id: 'surface:999', driver: 'cmux' })).rejects.toThrow(/unknown session/)
  })

  test('spawn auto-launches cmux when the socket is down, then proceeds', async () => {
    let up = false // socket starts unreachable (cmux app closed)
    let launched = 0
    const cli: CmuxCli = {
      async run(args) {
        const a = args.join(' ')
        if (a === 'ping') {
          if (!up) throw new Error('Socket not found at …/cmux.sock')
          return 'PONG'
        }
        if (args[0] === 'new-workspace') return 'OK workspace:2'
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

    const ref = await host.spawn({ persona: 'oscar', label: 'Oscar', command: 'claude', args: ['-p', 'hi'], cwd: '/repo' })
    expect(launched).toBe(1) // the app was auto-launched exactly once
    expect(ref).toEqual({ id: 'surface:2', driver: 'cmux' })
  })
})
