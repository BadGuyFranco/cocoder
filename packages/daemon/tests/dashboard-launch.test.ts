import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { openRunStore, type RunStore } from '@cocoder/core'
import { createOzEventBus, type DashboardLaunchCommand, type DashboardLaunchHandle, type DashboardLauncher, type OzContext } from '../src/context.js'
import { requestDashboardLaunch } from '../src/launcher.js'

class FakeHandle implements DashboardLaunchHandle {
  public readonly pid: number
  public killed = false
  private readonly emitter = new EventEmitter()

  public constructor(pid: number) {
    this.pid = pid
  }

  public on(event: 'exit' | 'error', listener: (...args: readonly unknown[]) => void): this {
    this.emitter.on(event, (...args: unknown[]) => listener(...args))
    return this
  }

  public unref(): void {}

  public exit(): void {
    this.emitter.emit('exit', 0)
  }
}

describe('requestDashboardLaunch', () => {
  test('spawns the dev dashboard when no built entry exists', async () => {
    const home = await makeHome({ dev: true })
    const fixture = makeCtx(home)

    const result = await requestDashboardLaunch(fixture.ctx)

    expect(result).toEqual({ status: 202, body: { launched: true, launching: true, mode: 'dev', command: 'pnpm dev' } })
    expect(fixture.spawns).toEqual([
      { mode: 'dev', command: 'pnpm', args: ['dev'], cwd: join(home, 'packages', 'ui') },
    ])
  })

  test('prefers the built dashboard entry when it exists', async () => {
    const home = await makeHome({ dev: true, built: true })
    const fixture = makeCtx(home)

    const result = await requestDashboardLaunch(fixture.ctx)

    expect(result).toEqual({ status: 202, body: { launched: true, launching: true, mode: 'built', command: 'pnpm exec electron .' } })
    expect(fixture.spawns[0]).toEqual({ mode: 'built', command: 'pnpm', args: ['exec', 'electron', '.'], cwd: join(home, 'packages', 'ui') })
  })

  test('falls back to the dev dashboard when the built tree is missing the renderer', async () => {
    const home = await makeHome({ dev: true, partialBuilt: true })
    const fixture = makeCtx(home)

    const result = await requestDashboardLaunch(fixture.ctx)

    expect(result).toEqual({ status: 202, body: { launched: true, launching: true, mode: 'dev', command: 'pnpm dev' } })
    expect(fixture.spawns).toEqual([
      { mode: 'dev', command: 'pnpm', args: ['dev'], cwd: join(home, 'packages', 'ui') },
    ])
  })

  test('reports a missing launchable entry without spawning', async () => {
    const home = await makeHome({ partialBuilt: true })
    const fixture = makeCtx(home)

    const result = await requestDashboardLaunch(fixture.ctx)

    expect(result.status).toBe(409)
    expect(result.body.error).toContain('no launchable Oz dashboard entry found')
    expect(result.body.error).toContain(join(home, 'packages', 'ui', 'out', 'main', 'main.js'))
    expect(result.body.error).toContain(join(home, 'packages', 'ui', 'out', 'renderer', 'index.html'))
    expect(result.body.error).toContain('package.json#scripts.dev')
    expect(fixture.spawns).toEqual([])
  })

  test('refuses a second launch while the previous child is still tracked', async () => {
    const home = await makeHome({ dev: true })
    const fixture = makeCtx(home)

    const first = await requestDashboardLaunch(fixture.ctx)
    const second = await requestDashboardLaunch(fixture.ctx)
    fixture.handles[0]!.exit()
    const third = await requestDashboardLaunch(fixture.ctx)

    expect(first.status).toBe(202)
    expect(second).toEqual({ status: 409, body: { error: 'Oz dashboard is already launching/running from this daemon process' } })
    expect(third.status).toBe(202)
    expect(fixture.spawns).toHaveLength(2)
  })

  test('reports synchronous spawn failures', async () => {
    const home = await makeHome({ dev: true })
    const fixture = makeCtx(home, { failSpawn: true })

    const result = await requestDashboardLaunch(fixture.ctx)

    expect(result).toEqual({ status: 500, body: { error: 'failed to start Oz dashboard: spawn failed' } })
  })
})

async function makeHome(opts: { readonly dev?: boolean; readonly built?: boolean; readonly partialBuilt?: boolean }): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-dashboard-launch-'))
  await writeFile(join(home, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.30.3' }))
  const uiDir = join(home, 'packages', 'ui')
  await mkdir(uiDir, { recursive: true })
  await writeFile(join(uiDir, 'package.json'), JSON.stringify({ scripts: opts.dev ? { dev: 'electron-vite dev' } : {} }))
  if (opts.built || opts.partialBuilt) {
    await mkdir(join(uiDir, 'out', 'main'), { recursive: true })
    await writeFile(join(uiDir, 'out', 'main', 'main.js'), 'console.log("built")\n')
  }
  if (opts.built) {
    await mkdir(join(uiDir, 'out', 'renderer'), { recursive: true })
    await writeFile(join(uiDir, 'out', 'renderer', 'index.html'), '<!doctype html>\n')
  }
  return home
}

function makeCtx(home: string, opts: { readonly failSpawn?: boolean } = {}): {
  readonly ctx: OzContext
  readonly store: RunStore
  readonly spawns: DashboardLaunchCommand[]
  readonly handles: FakeHandle[]
} {
  const store = openRunStore(':memory:')
  const spawns: DashboardLaunchCommand[] = []
  const handles: FakeHandle[] = []
  const launcher: DashboardLauncher = {
    current: null,
    spawn(input) {
      if (opts.failSpawn) throw new Error('spawn failed')
      spawns.push(input)
      const handle = new FakeHandle(1000 + handles.length)
      handles.push(handle)
      return handle
    },
  }
  const ctx = {
    cocoderHome: home,
    runsRoot: join(home, 'local', 'runs'),
    store,
    inFlight: new Map<string, string>(),
    stopControllers: new Map<string, AbortController>(),
    liveRefs: new Set<string>(),
    events: createOzEventBus(),
    dashboardLauncher: launcher,
  } as unknown as OzContext
  return { ctx, store, spawns, handles }
}
