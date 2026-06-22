import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, type RunnerIO, type RunStore } from '@cocoder/core'
import { type OzServer } from '../src/index.js'
import { launchRun } from '../src/launcher.js'
import { atomThenWrapIO, designatedBlockedRunIO, fakeGitChangedByCwd, makeDaemonReloadServer, writeInstallFixture } from './helpers/daemon-reload-fixture.js'

describe('daemon auto-reload', () => {
  let home: string
  let store: RunStore
  let oz: OzServer | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cocoder-daemon-reload-'))
    await writeInstallFixture(home, ['cocoder'])
    store = openRunStore(':memory:')
  })

  afterEach(async () => {
    await oz?.close()
    oz = undefined
    await rm(home, { recursive: true, force: true })
  })

  test('daemon package commits build and restart the daemon once idle', async () => {
    const builds: Array<{ cwd: string; timeoutMs: number }> = []
    let restarts = 0
    oz = await makeServer({
      changes: { [home]: [[], ['packages/daemon/src/launcher.ts'], []] },
      buildDaemonForReload: async (input) => {
        builds.push(input)
        return { exitCode: 0, output: 'daemon typecheck ok' }
      },
      restartDaemon: () => { restarts += 1 },
    })

    const runId = await launch('cocoder')
    await waitFor(() => restarts === 1)

    expect(builds).toEqual([{ cwd: home, timeoutMs: 900_000 }])
    expect(orderedAutoReloadEvents(runId)).toEqual([
      'daemon-auto-reload-pending',
      'daemon-auto-reload-build-started',
      'daemon-auto-reload-build-succeeded',
      'daemon-auto-reload-restart-queued',
    ])
    await expect(readFile(join(home, 'local', 'oz-audit.log'), 'utf8')).resolves.toContain('"action":"daemon-auto-reload"')
  })

  test('core package commits also trigger the daemon reload', async () => {
    let builds = 0
    let restarts = 0
    oz = await makeServer({
      changes: { [home]: [[], ['packages/core/src/runner/runner.ts'], []] },
      buildDaemonForReload: async () => {
        builds += 1
        return { exitCode: 0, output: 'daemon typecheck ok' }
      },
      restartDaemon: () => { restarts += 1 },
    })

    const runId = await launch('cocoder')
    await waitFor(() => restarts === 1)

    expect(builds).toBe(1)
    expect(restarts).toBe(1)
    expect(store.listEvents(runId).find((event) => event.type === 'daemon-auto-reload-pending')?.data).toMatchObject({
      files: ['packages/core/src/runner/runner.ts'],
    })
  })

  test('non-runtime commits do not schedule a daemon reload', async () => {
    let builds = 0
    let restarts = 0
    oz = await makeServer({
      changes: { [home]: [[], ['docs/usage.md'], []] },
      buildDaemonForReload: async () => {
        builds += 1
        return { exitCode: 0, output: 'unexpected' }
      },
      restartDaemon: () => { restarts += 1 },
    })

    const runId = await launch('cocoder')
    await waitForTerminal(runId)

    expect(builds).toBe(0)
    expect(restarts).toBe(0)
    expect(eventTypes(runId).filter((type) => type.startsWith('daemon-auto-reload'))).toEqual([])
  })

  test('daemon reload waits until all in-flight runs are idle', async () => {
    await writeInstallFixture(home, ['cocoder', 'external'])
    const io = designatedBlockedRunIO()
    let builds = 0
    let restarts = 0
    const buildObservedInFlight: number[] = []
    oz = await makeServer({
      changes: {
        [home]: [[], ['packages/daemon/src/routes.ts'], []],
        [join(home, 'external-workspace')]: [[]],
      },
      io: io.runnerIO,
      buildDaemonForReload: async () => {
        builds += 1
        buildObservedInFlight.push(oz!.ctx.inFlight.size)
        return { exitCode: 0, output: 'daemon typecheck ok' }
      },
      restartDaemon: () => { restarts += 1 },
    })

    const externalRunId = await launch('external')
    io.blockRun(externalRunId)
    await waitFor(() => oz!.ctx.inFlight.get('external') === externalRunId)
    const daemonRunId = await launch('cocoder')
    await waitFor(() => !oz!.ctx.inFlight.has('cocoder') && oz!.ctx.inFlight.has('external'))

    expect(store.getRun(daemonRunId)?.status).toBe('completed')
    expect(eventTypes(daemonRunId)).toContain('daemon-auto-reload-pending')
    expect(builds).toBe(0)
    expect(restarts).toBe(0)

    io.releaseBlockedRun()
    await waitFor(() => restarts === 1)

    expect(store.getRun(externalRunId)?.status).toBe('completed')
    expect(builds).toBe(1)
    expect(buildObservedInFlight).toEqual([0])
    expect(restarts).toBe(1)
  })

  test('daemon reload build failure is recorded without restarting', async () => {
    let restarts = 0
    oz = await makeServer({
      changes: { [home]: [[], ['packages/daemon/src/server.ts'], []] },
      buildDaemonForReload: async () => ({ exitCode: 2, output: 'typecheck failed' }),
      restartDaemon: () => { restarts += 1 },
    })

    const runId = await launch('cocoder')
    await waitFor(() => eventTypes(runId).includes('daemon-auto-reload-build-failed'))

    expect(restarts).toBe(0)
    expect(store.listEvents(runId).find((event) => event.type === 'daemon-auto-reload-build-failed')?.data).toMatchObject({
      exitCode: 2,
      output: 'typecheck failed',
      files: ['packages/daemon/src/server.ts'],
    })
    await expect(readFile(join(home, 'local', 'oz-audit.log'), 'utf8')).resolves.toContain('"action":"daemon-auto-reload-build-failed"')
  })

  async function makeServer(opts: {
    readonly changes: Readonly<Record<string, readonly (readonly string[])[]>>
    readonly io?: RunnerIO
    readonly buildDaemonForReload: Parameters<typeof makeDaemonReloadServer>[0]['buildDaemonForReload']
    readonly restartDaemon: () => void
  }): Promise<OzServer> {
    return await makeDaemonReloadServer({
      home,
      store,
      git: fakeGitChangedByCwd(opts.changes),
      io: opts.io ?? atomThenWrapIO(),
      buildDaemonForReload: opts.buildDaemonForReload,
      restartDaemon: opts.restartDaemon,
    })
  }

  async function launch(workspaceId: string): Promise<string> {
    if (!oz) throw new Error('server not started')
    const result = await launchRun(oz.ctx, workspaceId, 'demo')
    expect(result.status).toBe(202)
    const runId = result.body.runId
    if (typeof runId !== 'string') throw new Error('launch did not return a run id')
    return runId
  }

  function eventTypes(runId: string): string[] {
    return store.listEvents(runId).map((event) => event.type)
  }

  function orderedAutoReloadEvents(runId: string): string[] {
    return eventTypes(runId).filter((type) => type.startsWith('daemon-auto-reload'))
  }

  async function waitForTerminal(runId: string): Promise<void> {
    await waitFor(() => store.getRun(runId)?.status !== 'running')
  }
})

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(predicate()).toBe(true)
}
