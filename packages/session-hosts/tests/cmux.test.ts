import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { SpawnOptions } from '@cocoder/core'
import { CmuxSessionHost, type CmuxCli } from '../src/index.js'
import { buildLaunchScript, diffNewWorkspace, shquote } from '../src/cmux/launch.js'
import { parseOkRef, parsePaneRefs, parseSurface, parseWorkspaceRefs } from '../src/cmux/cmux-cli.js'

describe('pure helpers', () => {
  test('shquote escapes embedded single quotes', () => {
    expect(shquote("it's")).toBe(`'it'\\''s'`)
  })

  test('buildLaunchScript runs the agent interactively (cd + exec; no redirect/sentinel/devnull)', () => {
    const opts: SpawnOptions = { persona: 'bob', command: 'codex', args: ['--flag', 'the prompt'], cwd: '/repo' }
    const script = buildLaunchScript(opts)
    expect(script).toBe(`cd '/repo'\nexec 'codex' '--flag' 'the prompt'\n`)
    expect(script).not.toContain('tee')
    expect(script).not.toContain('/dev/null')
    expect(script).not.toContain('EXIT=')
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

/** Fake cmux CLI: new-workspace (first persona) + new-split (later persona); read-screen liveness. */
function makeFakeCli(opts: { up?: boolean; surfaceAlive?: () => boolean } = {}): { cli: CmuxCli; calls: string[][] } {
  const calls: string[][] = []
  const up = opts.up ?? true
  const surfaceAlive = opts.surfaceAlive ?? (() => true)
  let panes = ['pane:2']
  const cli: CmuxCli = {
    async run(args) {
      calls.push([...args])
      const a = args.join(' ')
      if (a === 'ping') {
        if (!up) throw new Error('Socket not found')
        return 'PONG'
      }
      if (args[0] === 'new-workspace') return 'OK workspace:2'
      if (args[0] === 'list-pane-surfaces') return '{"pane_ref":"pane:2","surfaces":[{"ref":"surface:2","selected":true}]}'
      if (args[0] === 'list-panes') return panes.join('\n')
      if (args[0] === 'new-split') {
        panes = ['pane:2', 'pane:3']
        return 'OK surface:3 workspace:2'
      }
      if (args[0] === 'read-screen') {
        if (!surfaceAlive()) throw new Error('surface gone')
        return 'working...'
      }
      return '' // rename-tab, send, send-key, focus-pane, close-surface
    },
  }
  return { cli, calls }
}

describe('CmuxSessionHost driver (fake cli)', () => {
  test('spawn creates a named workspace, labels the pane, writes an interactive script, sends bash + Enter', async () => {
    const { cli, calls } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1 })

    const ref = await host.spawn({ persona: 'oscar', label: 'Oscar', command: 'claude', args: ['--', 'hi'], cwd: '/repo' })
    expect(ref).toEqual({ id: 'surface:2', driver: 'cmux', workspaceRef: 'workspace:2' })

    const newWs = calls.find((c) => c[0] === 'new-workspace')
    expect(newWs).toContain('--name')
    expect(newWs).toContain('Oscar')
    expect(calls.some((c) => c[0] === 'rename-tab' && c.includes('Oscar'))).toBe(true)
    expect(calls.some((c) => c[0] === 'focus-pane')).toBe(true)

    const files = await readdir(scriptDir)
    const script = await readFile(join(scriptDir, files[0]!), 'utf8')
    expect(script).toBe(`cd '/repo'\nexec 'claude' '--' 'hi'\n`)
    const sent = calls.find((c) => c[0] === 'send')
    expect(sent).toEqual(expect.arrayContaining(['--workspace', 'workspace:2', '--surface', 'surface:2'])) // scoped by workspace (cmux 0.64.x ref resolution)
    expect(sent?.at(-1)).toMatch(/^bash '.*cocoder-cmux-.*\.sh'$/)
    expect(calls.some((c) => c[0] === 'send-key' && c.includes('--workspace') && c.includes('Enter'))).toBe(true)
  })

  test('groupLabel names the workspace (priority + session), while the pane keeps the persona label', async () => {
    const { cli, calls } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1 })

    await host.spawn({ persona: 'oscar', label: 'Oscar', groupLabel: 'adhoc-session #14', command: 'claude', args: [], cwd: '/repo', group: 'run_14' })

    const newWs = calls.find((c) => c[0] === 'new-workspace')
    expect(newWs?.[newWs.indexOf('--name') + 1]).toBe('adhoc-session #14') // workspace = the run, not "Oscar"
    expect(calls.some((c) => c[0] === 'rename-tab' && c.includes('Oscar'))).toBe(true) // pane still labelled Oscar
  })

  test('two personas of the same run share a workspace as split panes', async () => {
    const { cli, calls } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1 })

    const oscar = await host.spawn({ persona: 'oscar', label: 'Oscar', command: 'claude', args: [], cwd: '/repo', group: 'run_1' })
    const bob = await host.spawn({ persona: 'bob', label: 'Bob', command: 'codex', args: [], cwd: '/repo', group: 'run_1' })

    expect(oscar.id).toBe('surface:2')
    expect(bob.id).toBe('surface:3')
    expect(calls.filter((c) => c[0] === 'new-workspace')).toHaveLength(1)
    expect(calls.find((c) => c[0] === 'new-split')).toEqual(['new-split', 'right', '--workspace', 'workspace:2', '--focus', 'true'])
  })

  test('status is running while the surface is readable, exited when it disappears', async () => {
    let alive = true
    const { cli } = makeFakeCli({ surfaceAlive: () => alive })
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1 })
    const ref = await host.spawn({ persona: 'bob', command: 'codex', args: [], cwd: '/repo' })

    expect(await host.status(ref)).toEqual({ state: 'running' })
    alive = false // cmux pane closed / agent gone
    expect(await host.status(ref)).toEqual({ state: 'exited', code: -1 })
    expect(await host.waitForExit(ref, { timeoutMs: 1000 })).toEqual({ state: 'exited', code: -1 })
  })

  test('sendInput types a line into the pane and submits it (Enter)', async () => {
    const { cli, calls } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1 })
    const ref = await host.spawn({ persona: 'bob', command: 'codex', args: [], cwd: '/repo' })

    await host.sendInput(ref, 'PROCEED — go')
    expect(calls).toContainEqual(['send', '--workspace', 'workspace:2', '--surface', 'surface:2', 'PROCEED — go'])
    const after = calls.slice(calls.findIndex((c) => c.at(-1) === 'PROCEED — go'))
    expect(after.some((c) => c[0] === 'send-key' && c.includes('--workspace') && c.includes('Enter'))).toBe(true)
  })

  test('kill closes the pane surface (not the shared workspace); methods reject unknown refs', async () => {
    const { cli, calls } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1 })
    const ref = await host.spawn({ persona: 'bob', command: 'codex', args: [], cwd: '/repo' })

    await host.kill(ref)
    expect(calls.some((c) => c[0] === 'close-surface' && c.includes('surface:2'))).toBe(true)
    await expect(host.status({ id: 'surface:999', driver: 'cmux' })).rejects.toThrow(/unknown session/)
  })

  test('closeSurface closes by durable refs with NO prior spawn (cross-restart Deb-pane leak fix)', async () => {
    const { cli, calls } = makeFakeCli()
    const scriptDir = await mkdtemp(join(tmpdir(), 'cmux-test-'))
    // A BRAND-NEW host (empty #sessions) — exactly the post-`oz.sh restart` state where kill() throws.
    const host = new CmuxSessionHost({ cli, scriptDir, pollMs: 1 })

    await host.closeSurface({ workspaceRef: 'workspace:7', surfaceRef: 'surface:7' })
    // The close command IS issued against the durable refs — no 'unknown session ref' throw.
    expect(calls).toContainEqual(['close-surface', '--workspace', 'workspace:7', '--surface', 'surface:7'])
    // kill() on the same un-spawned ref WOULD throw (the bug closeSurface routes around).
    await expect(host.kill({ id: 'surface:7', driver: 'cmux' })).rejects.toThrow(/unknown session/)
  })

  test('spawn auto-launches cmux when the socket is down, then proceeds', async () => {
    let socketUp = false
    let launched = 0
    const cli: CmuxCli = {
      async run(args) {
        const a = args.join(' ')
        if (a === 'ping') {
          if (!socketUp) throw new Error('Socket not found at …/cmux.sock')
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
      hostReadyTimeoutMs: 1000,
      launchApp: async () => {
        launched += 1
        socketUp = true
      },
    })

    const ref = await host.spawn({ persona: 'oscar', label: 'Oscar', command: 'claude', args: [], cwd: '/repo' })
    expect(launched).toBe(1)
    expect(ref).toEqual({ id: 'surface:2', driver: 'cmux', workspaceRef: 'workspace:2' })
  })
})
