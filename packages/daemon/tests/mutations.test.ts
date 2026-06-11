// Stage-4 mutations + run-lifecycle correctness: launch (202 / 409 in-flight), deep-link (200 / 409
// non-live, never 500), assignments write (validate + atomic), startup orphan reconciliation.
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openRunStore, type Adapter, type Git, type RunnerIO, type RunStore, type SessionHost, type SessionRef } from '@cocoder/core'
import { createOzServer, OZ_CSRF_HEADER, type OzServer } from '../src/index.js'

const okAdapter: Adapter = {
  id: 'any',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
}
interface CliAdapterCalls {
  preflight: number
  listModels: number
}
const cliAdapter = (id: string, detail: string, calls?: CliAdapterCalls): Adapter => ({
  id,
  runReadiness: { mechanism: 'launch-flags', flags: [`--${id}`], managesUserConfig: false, detail },
  build: () => ({ command: id, args: [] }),
  preflight: async () => {
    if (calls) calls.preflight += 1
    return {
      ok: true,
      checks: [
        { name: 'installed', ok: true, detail: `${id} installed` },
        { name: 'authenticated', ok: true, detail: `${id} authenticated` },
        { name: 'model', ok: true, detail: `(${id} default)` },
      ],
    }
  },
  listModels: async () => {
    if (calls) calls.listModels += 1
    return { canEnumerate: true, models: [`${id}-model-a`, `${id}-model-b`], detail: `${id} model list` }
  },
})
const fakeGit = (changed: string[] = [], shas: readonly string[] = ['h0']): Git => {
  let headCalls = 0
  return {
    async headSha() {
      const sha = shas[Math.min(headCalls, shas.length - 1)] ?? shas[0] ?? 'h0'
      headCalls += 1
      return sha
    },
    async changedFiles() {
      return changed
    },
    async addAndCommit() {
      return 'sha-committed'
    },
    async restoreToHead() {},
    async show() {
      return 'diff'
    },
    // ADR-0015 worktree/merge methods — no-ops for the daemon's fake-git launch path. unmergedCommits
    // returns [] so the end-of-run integration is a vacuous 'merged' (no real merge attempted in-fake).
    async worktreeAdd() {},
    async worktreeRemove() {},
    async listWorktrees() {
      return []
    },
    async isAncestor() {
      return true
    },
    async mergeFastForwardOnly() {
      return 'merged'
    },
    async unmergedCommits() {
      return []
    },
    async mergeInto() {
      return 'clean' as const
    },
    async conflictedFiles() {
      return []
    },
    async completeMerge() {
      return 'merged'
    },
    async abortMerge() {},
    async currentBranch() {
      return 'trunk'
    },
    async resetHard() {},
  }
}
const fakeHost = (
  onShow?: (ref: SessionRef) => void,
  onKill?: (ref: SessionRef) => void,
  onClose?: (args: { workspaceRef: string; surfaceRef: string }) => void,
): SessionHost => {
  let n = 0
  return {
    async spawn() {
      return { id: `surface:${++n}`, driver: 'fake' }
    },
    async readScreen() {
      return ''
    },
    async status() {
      return { state: 'exited', code: 0 }
    },
    async waitForExit() {
      return { state: 'exited', code: 0 }
    },
    async sendInput() {},
    async show(ref) {
      onShow?.(ref)
    },
    async kill(ref) {
      onKill?.(ref)
    },
    async closeSurface(args) {
      onClose?.(args)
    },
  }
}

interface Resp {
  status: number
  json: any
}
function call(oz: OzServer, method: string, path: string, opts: { body?: unknown; csrf?: boolean } = {}): Promise<Resp> {
  const headers: Record<string, string> = { authorization: `Bearer ${oz.token}` }
  if (opts.csrf !== false) headers[OZ_CSRF_HEADER] = oz.csrfToken
  if (opts.body) headers['content-type'] = 'application/json'
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: oz.port, path, method, headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }))
    })
    req.on('error', reject)
    req.end(opts.body ? JSON.stringify(opts.body) : undefined)
  })
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Fake RunnerIO so runRun completes against fakes (no real directive file to poll for). Oscar
// immediately wraps up (zero atoms) — enough to exercise the launch→terminal lifecycle this suite tests.
const fakeIO = (): RunnerIO => ({
  async ensureRunDir() {},
  async awaitDirective() {
    return { kind: 'wrapup' as const, pickup: 'nothing further this run' }
  },
  async awaitVerification() {
    return { verdict: 'pass' as const, reason: 'verified' }
  },
  async awaitTriage() {
    return { disposition: 'one-off' as const, summary: 'n/a', mode: 'propose' as const }
  },
  async writeFaultContext() {},
  async writeDisposition(runDir, index) {
    return `${runDir}/disposition-${index}.md`
  },
  async writeDebStatus() {},
  async readNudgeRequest() {
    return null
  },
  async writePickup(runDir) {
    return `${runDir}/pickup.md`
  },
  async writeRunRecord(runDir) {
    return `${runDir}/record.md`
  },
})

async function fixtures(home: string): Promise<void> {
  await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'personas'), { recursive: true })
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(
    join(home, 'local', 'workspaces.json'),
    JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }),
  )
  await writeFile(join(home, 'cocoder', 'priorities', 'demo.md'), `---\nid: demo\ntitle: Demo\n---\n## Objective\nDo the thing.`)
  await writeFile(join(home, 'cocoder', 'personas', 'shared-standards.md'), `# standards`)
  await writeFile(join(home, 'cocoder', 'personas', 'oscar.md'), `---\nid: oscar\nlabel: Orchestrator\nrole: orchestrator\nwriteScope: []\n---\nOscar`)
  await writeFile(join(home, 'cocoder', 'personas', 'bob.md'), `---\nid: bob\nlabel: Builder\nrole: builder\nwriteScope:\n  - packages/**\n---\nBob`)
  await writeFile(
    join(home, 'cocoder', 'personas', 'assignments.json'),
    JSON.stringify({ personas: { oscar: { cli: 'claude', model: '' }, bob: { cli: 'codex', model: '' } } }),
  )
}

describe('Oz mutations + lifecycle', () => {
  let home: string
  let store: RunStore
  let oz: OzServer | undefined
  let shown: SessionRef[]
  let killed: SessionRef[]

  const startServer = async (git: Git = fakeGit()): Promise<OzServer> => {
    shown = []
    killed = []
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git,
      sessionHost: fakeHost(
        (ref) => shown.push(ref),
        (ref) => killed.push(ref),
      ),
      getAdapter: () => okAdapter,
      io: fakeIO(),
      runHeadless: async () => ({ exitCode: 0, output: 'wrap closeout' }), // headless wrap-up Play: don't shell out in tests
    })
    return oz
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cocoder-oz-mut-'))
    await fixtures(home)
    store = openRunStore(':memory:')
  })
  afterEach(async () => {
    await oz?.close()
    oz = undefined
  })

  test('POST /runs launches (202 + runId), and the run reaches terminal via fire-and-forget', async () => {
    await startServer()
    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
    expect(r.status).toBe(202)
    expect(r.json.runId).toMatch(/^run_/)

    // Poll the detail until terminal (fakes complete fast).
    let status = 'running'
    for (let i = 0; i < 50 && status === 'running'; i++) {
      const d = await call(oz!, 'GET', `/runs/${r.json.runId}`)
      status = d.json.run.status
      if (status === 'running') await sleep(10)
    }
    expect(status).toBe('completed')

    // C-S6 audit: a launch line was appended.
    const audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"launch"')
  })

  test('POST /runs --resume reads a prior run pickup (200/202); a missing pickup is a 400', async () => {
    await startServer()
    // Resuming a run with no pickup brief fails cleanly (400, not a 500) and releases the reservation.
    const bad = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo', resumeFromRunId: 'run_missing' } })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toMatch(/cannot resume/)

    // A prior run left a pickup brief on disk (the continuation artifact; F8) → resume launches.
    await mkdir(join(home, 'local', 'runs', 'run_prior'), { recursive: true })
    await writeFile(join(home, 'local', 'runs', 'run_prior', 'pickup.md'), '# Pickup\nstart at the parser')
    const ok = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo', resumeFromRunId: 'run_prior' } })
    expect(ok.status).toBe(202)
    expect(ok.json.runId).toMatch(/^run_/)
  })

  test('POST /runs threads a trimmed task into the launch prompt', async () => {
    const prompts: string[] = []
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(),
      getAdapter: () => ({ ...okAdapter, build: (input) => {
        prompts.push(input.prompt)
        return { command: 'x', args: [] }
      } }),
      io: fakeIO(),
      runHeadless: async () => ({ exitCode: 0, output: 'wrap closeout' }),
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo', task: '  check the launch prompt  ' } })

    expect(r.status).toBe(202)
    for (let i = 0; i < 20 && prompts.length === 0; i++) await sleep(10)
    expect(prompts[0]).toContain("## Founder's ad-hoc instruction (this run)")
    expect(prompts[0]).toContain('check the launch prompt')
    expect(prompts[0]).not.toContain('  check the launch prompt  ')
  })

  test('POST /runs treats a whitespace-only task as absent', async () => {
    const prompts: string[] = []
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(),
      getAdapter: () => ({ ...okAdapter, build: (input) => {
        prompts.push(input.prompt)
        return { command: 'x', args: [] }
      } }),
      io: fakeIO(),
      runHeadless: async () => ({ exitCode: 0, output: 'wrap closeout' }),
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo', task: '   \n\t  ' } })

    expect(r.status).toBe(202)
    for (let i = 0; i < 20 && prompts.length === 0; i++) await sleep(10)
    expect(prompts[0]).not.toContain("## Founder's ad-hoc instruction (this run)")
  })

  test('POST /runs rejects tasks longer than 4000 chars', async () => {
    await startServer()

    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo', task: 'x'.repeat(4001) } })

    expect(r).toEqual({ status: 400, json: { error: 'task too long' } })
  })

  test('REFUSES to launch on a stale daemon (425, no run created) and SELF-RESTARTS when idle', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let restarts = 0
    try {
      oz = await createOzServer({
        cocoderHome: home,
        port: 0,
        store,
        git: fakeGit([], ['boot-sha', 'head-sha']), // boot reads boot-sha; launch reads head-sha
        sessionHost: fakeHost(),
        getAdapter: () => okAdapter,
        io: fakeIO(),
        restartDaemon: () => {
          restarts += 1
        },
      })
      const before = store.listRuns().length
      const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
      expect(r.status).toBe(425) // refused BEFORE spawning anything (no whole-run-then-abort, no hijackable session)
      expect(r.json.stale).toBe(true)
      expect(r.json.restarting).toBe(true) // idle → the daemon heals itself; no manual oz.sh restart step
      expect(r.json.error).toMatch(/restarting itself/)
      expect(restarts).toBe(1)
      expect(store.listRuns().length).toBe(before) // no run row created
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('STALE DAEMON: refusing launch'))
      // The in-flight reservation is released so a post-restart re-launch isn't blocked.
      const r2 = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
      expect(r2.status).toBe(425) // still stale (same fake), but NOT a 409 in-flight — the slot was freed
    } finally {
      warn.mockRestore()
    }
  })

  test('a stale daemon with a run in flight does NOT self-restart (never mid-run)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let restarts = 0
    try {
      oz = await createOzServer({
        cocoderHome: home,
        port: 0,
        store,
        git: fakeGit([], ['boot-sha', 'head-sha']),
        sessionHost: fakeHost(),
        getAdapter: () => okAdapter,
        io: fakeIO(),
        restartDaemon: () => {
          restarts += 1
        },
      })
      oz.ctx.inFlight.set('other-workspace', 'run_busy') // another workspace's live run
      const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
      expect(r.status).toBe(425)
      expect(r.json.restarting).toBe(false)
      expect(r.json.error).toMatch(/do NOT restart from inside a run or agent pane/)
      expect(restarts).toBe(0) // restarting would orphan the in-flight run
    } finally {
      warn.mockRestore()
    }
  })

  test('launches normally when the daemon boot sha matches current HEAD (not stale)', async () => {
    await startServer(fakeGit([], ['same-sha']))
    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
    expect(r.status).toBe(202)
    expect(r.json.runId).toMatch(/^run_/)
  })

  test('GET /clis returns static config-managed state before any CLI test', async () => {
    const calls: CliAdapterCalls = { preflight: 0, listModels: 0 }
    const adapters = [cliAdapter('alpha', 'managed alpha', calls), cliAdapter('beta', 'managed beta', calls)]
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(),
      getAdapter: (cli) => {
        const adapter = adapters.find((a) => a.id === cli)
        if (!adapter) throw new Error('unknown cli')
        return adapter
      },
      listAdapters: () => adapters,
      io: fakeIO(),
    })

    const r = await call(oz, 'GET', '/clis')

    expect(r.status).toBe(200)
    expect(calls).toEqual({ preflight: 0, listModels: 0 })
    expect(r.json.clis).toEqual([
      {
        id: 'alpha',
        tested: false,
        testedAt: null,
        install: { ok: false, detail: 'not yet tested' },
        auth: { ok: false, detail: 'not yet tested' },
        models: { canEnumerate: false, models: [], detail: 'not yet tested' },
        configManaged: adapters[0]!.runReadiness,
      },
      {
        id: 'beta',
        tested: false,
        testedAt: null,
        install: { ok: false, detail: 'not yet tested' },
        auth: { ok: false, detail: 'not yet tested' },
        models: { canEnumerate: false, models: [], detail: 'not yet tested' },
        configManaged: adapters[1]!.runReadiness,
      },
    ])
  })

  test('POST /clis/:id/test refreshes and caches a CLI test result', async () => {
    const calls: CliAdapterCalls = { preflight: 0, listModels: 0 }
    const adapters = [cliAdapter('alpha', 'managed alpha', calls)]
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(),
      getAdapter: (cli) => {
        const adapter = adapters.find((a) => a.id === cli)
        if (!adapter) throw new Error('unknown cli')
        return adapter
      },
      listAdapters: () => adapters,
      io: fakeIO(),
    })

    const tested = await call(oz, 'POST', '/clis/alpha/test')

    expect(tested.status).toBe(200)
    expect(calls).toEqual({ preflight: 1, listModels: 1 })
    expect(tested.json.cli).toMatchObject({
      id: 'alpha',
      tested: true,
      install: { ok: true, detail: 'alpha installed' },
      auth: { ok: true, detail: 'alpha authenticated' },
      models: { canEnumerate: true, models: ['alpha-model-a', 'alpha-model-b'], detail: 'alpha model list' },
      configManaged: adapters[0]!.runReadiness,
    })
    expect(tested.json.cli.testedAt).toEqual(expect.any(Number))

    const cached = await call(oz, 'GET', '/clis')
    expect(cached.status).toBe(200)
    expect(cached.json.clis[0]).toEqual(tested.json.cli)
  })

  test('POST /clis/:id/test → 404 for an unknown CLI', async () => {
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(),
      getAdapter: () => {
        throw new Error('unknown cli')
      },
      listAdapters: () => [],
      io: fakeIO(),
    })
    const r = await call(oz!, 'POST', '/clis/nope/test')
    expect(r).toEqual({ status: 404, json: { error: 'unknown cli' } })
  })

  test('POST /oz/messages returns a deterministic chat reply', async () => {
    await startServer()
    const r = await call(oz!, 'POST', '/oz/messages', { body: { text: 'help', workspaceId: 'cocoder' } })
    expect(r).toMatchObject({
      status: 200,
      json: { ok: true, command: 'help', reply: expect.stringContaining('Supported commands') },
    })
  })

  test('POST /runs → 409 when a run is already in flight for the workspace', async () => {
    await startServer()
    oz!.ctx.inFlight.set('cocoder', 'run_existing') // simulate an in-flight run
    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
    expect(r.status).toBe(409)
  })

  test('POST /runs → 400 for an unknown priority (and clears the in-flight reservation)', async () => {
    await startServer()
    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'nope' } })
    expect(r.status).toBe(400)
    expect(oz!.ctx.inFlight.has('cocoder')).toBe(false) // reservation released on failure
  })

  test('POST /runs/:id/show → 409 (not 500) when no session is live in this process', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'bob', sessionRef: 'surface:gone' })
    await startServer()
    const r = await call(oz!, 'POST', `/runs/${run.id}/show`)
    expect(r.status).toBe(409) // ref not in liveRefs → clean 409, never a throw/500
  })

  test('POST /runs/:id/show → 200 and focuses the live pane', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'bob', sessionRef: 'surface:9' })
    await startServer()
    oz!.ctx.liveRefs.add('surface:9')
    const r = await call(oz!, 'POST', `/runs/${run.id}/show`)
    expect(r.status).toBe(200)
    expect(shown.map((s) => s.id)).toEqual(['surface:9'])
  })

  test('POST /runs/:id/teardown closes ALL stored surfaces by durable ref (post-restart Deb-pane leak fix)', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'oscar', sessionRef: 'surface:1' })
    store.createSession({ runId: run.id, persona: 'bob', sessionRef: 'surface:2' })
    store.createSession({ runId: run.id, persona: 'deb', sessionRef: 'surface:deb' })
    await startServer()
    // Simulate a daemon restart: only some panes are in this process's liveRefs; Deb's is NOT tracked
    // (the exact condition that USED to leak it — teardown closed nothing it didn't have live).
    oz!.ctx.liveRefs.add('surface:1')
    oz!.ctx.liveRefs.add('surface:2')

    const r = await call(oz!, 'POST', `/runs/${run.id}/teardown`)
    expect(r.status).toBe(200)
    // All three of the run's stored surfaces are closed — including Deb's untracked pane (no leak).
    expect(r.json.closed.sort()).toEqual(['surface:1', 'surface:2', 'surface:deb'])
    expect(killed.map((k) => k.id).sort()).toEqual(['surface:1', 'surface:2', 'surface:deb'])
    expect(oz!.ctx.liveRefs.has('surface:1')).toBe(false) // live refs pruned
    expect(store.listEvents(run.id).some((e) => e.type === 'teardown')).toBe(true)
  })

  test('teardown closes a prior-instance pane via durable workspaceRef (closeSurface, not kill)', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    // A session persisted WITH its workspaceRef (the durable data a prior daemon recorded).
    store.createSession({ runId: run.id, persona: 'deb', sessionRef: 'surface:deb', workspaceRef: 'workspace:9' })
    const closes: { workspaceRef: string; surfaceRef: string }[] = []
    const killedHere: SessionRef[] = []
    // Fresh daemon (empty liveRefs, empty driver spawn-map) — the post-restart state.
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(undefined, (r) => killedHere.push(r), (a) => closes.push(a)),
      getAdapter: () => okAdapter,
      io: fakeIO(),
    })
    const r = await call(oz, 'POST', `/runs/${run.id}/teardown`)
    expect(r.status).toBe(200)
    expect(r.json.closed).toEqual(['surface:deb'])
    // Closed via the DURABLE closeSurface path (cross-instance), NOT kill() (which would throw here).
    expect(closes).toEqual([{ workspaceRef: 'workspace:9', surfaceRef: 'surface:deb' }])
    expect(killedHere).toEqual([])
  })

  test('teardown prunes a stale ref even when kill fails (pane closed by hand)', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'oscar', sessionRef: 'surface:gone' })
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: { ...fakeHost(), async kill() {
        throw new Error('pane already gone')
      } },
      getAdapter: () => okAdapter,
      io: fakeIO(),
    })
    oz.ctx.liveRefs.add('surface:gone')
    const r = await call(oz, 'POST', `/runs/${run.id}/teardown`)
    expect(r.status).toBe(200)
    expect(r.json.closed).toEqual([]) // kill failed → nothing reported as closed
    expect(oz.ctx.liveRefs.has('surface:gone')).toBe(false) // …but the stale ref is pruned, so no lingering deep-link
  })

  test('POST /runs/:id/teardown → 404 for an unknown run', async () => {
    await startServer()
    expect((await call(oz!, 'POST', '/runs/nope/teardown')).status).toBe(404)
  })

  test('PUT assignments: validates (400 on bad payload), writes atomically (200 + round-trips)', async () => {
    await startServer()
    const bad = await call(oz!, 'PUT', '/workspaces/cocoder/personas/assignments', { body: { personas: { bob: { cli: 'codex' } } } })
    expect(bad.status).toBe(400) // missing model
    const before = await readFile(join(home, 'cocoder', 'personas', 'assignments.json'), 'utf8')
    expect(before).toContain('"model"') // file untouched by the rejected write

    const ok = await call(oz!, 'PUT', '/workspaces/cocoder/personas/assignments', {
      body: { personas: { oscar: { cli: 'claude', model: 'opus' }, bob: { cli: 'codex', model: '' } } },
    })
    expect(ok.status).toBe(200)
    expect(ok.json.assignments.oscar).toEqual({ cli: 'claude', model: 'opus' })
    const after = JSON.parse(await readFile(join(home, 'cocoder', 'personas', 'assignments.json'), 'utf8'))
    expect(after.personas.oscar.model).toBe('opus')
  })

  test('PUT /settings merges a partial patch, persists atomically, and round-trips via GET', async () => {
    await startServer()

    const put = await call(oz!, 'PUT', '/settings', { body: { pollIntervalMs: 5000, ignored: true } })

    expect(put.status).toBe(200)
    expect(put.json).toEqual({ pollIntervalMs: 5000, defaultWorkspaceId: null })
    const persisted = JSON.parse(await readFile(join(home, 'local', 'settings.json'), 'utf8'))
    expect(persisted).toEqual({ pollIntervalMs: 5000, defaultWorkspaceId: null })
    const get = await call(oz!, 'GET', '/settings')
    expect(get.status).toBe(200)
    expect(get.json).toEqual(put.json)
  })

  test('POST /workspaces/:id/priorities/reorder writes order.json and subsequent GET reflects it', async () => {
    await writeFile(join(home, 'cocoder', 'priorities', 'later.md'), `---\nid: later\ntitle: Later\n---\nLater work.`)
    await startServer()

    const post = await call(oz!, 'POST', '/workspaces/cocoder/priorities/reorder', { body: { order: ['later', 'missing', 'demo'] } })

    expect(post.status).toBe(200)
    expect(post.json).toEqual({ order: ['later', 'demo'] })
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'priorities', 'order.json'), 'utf8'))).toEqual(['later', 'demo'])

    const get = await call(oz!, 'GET', '/workspaces/cocoder/priorities')
    expect(get.status).toBe(200)
    expect(get.json.priorities.map((p: any) => p.id)).toEqual(['later', 'demo'])
  })

  test('POST /workspaces/:id/priorities/reorder rejects invalid bodies', async () => {
    await startServer()

    expect((await call(oz!, 'POST', '/workspaces/cocoder/priorities/reorder', { body: { order: 'demo' } })).status).toBe(400)
    expect((await call(oz!, 'POST', '/workspaces/cocoder/priorities/reorder', { body: { order: ['demo', 1] } })).status).toBe(400)
  })

  test('POST /workspaces/:id/priorities/reorder returns 404 for an unknown workspace', async () => {
    await startServer()

    const r = await call(oz!, 'POST', '/workspaces/nope/priorities/reorder', { body: { order: ['demo'] } })

    expect(r.status).toBe(404)
  })

  test('POST /daemon/restart → 202 and triggers the (injected) restart action when idle', async () => {
    let restarts = 0
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(),
      getAdapter: () => okAdapter,
      io: fakeIO(),
      restartDaemon: () => {
        restarts += 1
      }, // never spawn the real oz.sh restart in tests
    })
    const r = await call(oz, 'POST', '/daemon/restart')
    expect(r.status).toBe(202)
    expect(r.json.restarting).toBe(true)
    expect(restarts).toBe(1)
    // appendAudit is fire-and-forget — poll briefly for the flushed line.
    let audit = ''
    for (let i = 0; i < 20 && !audit.includes('daemon-restart'); i++) {
      audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8').catch(() => '')
      if (!audit.includes('daemon-restart')) await sleep(10)
    }
    expect(audit).toContain('"action":"daemon-restart"')
  })

  test('POST /daemon/restart → 409 and does NOT restart when a run is in flight (never orphan)', async () => {
    let restarts = 0
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(),
      getAdapter: () => okAdapter,
      io: fakeIO(),
      restartDaemon: () => {
        restarts += 1
      },
    })
    oz.ctx.inFlight.set('cocoder', 'run_busy')
    const r = await call(oz, 'POST', '/daemon/restart')
    expect(r.status).toBe(409)
    expect(restarts).toBe(0)
  })

  test('POST /daemon/restart → 403 without a CSRF token (mutation gate)', async () => {
    await startServer()
    const r = await call(oz!, 'POST', '/daemon/restart', { csrf: false })
    expect(r.status).toBe(403)
  })

  test('POST /workspaces/:id/priorities/reorder → 403 without a CSRF token (mutation gate)', async () => {
    await startServer()
    const r = await call(oz!, 'POST', '/workspaces/cocoder/priorities/reorder', { csrf: false, body: { order: ['demo'] } })
    expect(r.status).toBe(403)
  })

  test('POST /clis/:id/test → 403 without a CSRF token (mutation gate)', async () => {
    await startServer()
    const r = await call(oz!, 'POST', '/clis/any/test', { csrf: false })
    expect(r.status).toBe(403)
  })

  test('POST /oz/messages → 403 without a CSRF token (mutation gate)', async () => {
    await startServer()
    const r = await call(oz!, 'POST', '/oz/messages', { csrf: false, body: { text: 'help' } })
    expect(r.status).toBe(403)
  })

  test('PUT assignments → 403 without a CSRF token (mutation gate)', async () => {
    await startServer()
    const r = await call(oz!, 'PUT', '/workspaces/cocoder/personas/assignments', { csrf: false, body: { personas: {} } })
    expect(r.status).toBe(403)
  })

  test('PUT /settings → 403 without a CSRF token (mutation gate)', async () => {
    await startServer()
    const r = await call(oz!, 'PUT', '/settings', { csrf: false, body: { pollIntervalMs: 5000 } })
    expect(r.status).toBe(403)
  })

  test('startup orphan reconciliation: a running row at boot is marked failed', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const orphan = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' }) // status 'running'
    await startServer() // reconcileOrphans runs in createOzServer
    expect(store.getRun(orphan.id)?.status).toBe('failed')
    expect(store.listEvents(orphan.id).some((e) => e.type === 'orphaned')).toBe(true)
  })

  // POST /runs/:id/resolve — the ADR-0015 §5 decision-mechanics exit (founder resolution).
  describe('POST /runs/:id/resolve', () => {
    /** A parked run with a worktree + branch, in the given decision state. */
    const parkedRun = (status: 'pending-scope-decision' | 'pending-landing') => {
      store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
      const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
      store.setWorktree(run.id, join(home, 'local', 'worktrees', run.id), `cocoder/${run.id}`)
      store.setRunStatus(run.id, status)
      return run
    }

    test('discard drops held-back files, GCs the worktree, and closes the run as failed', async () => {
      const run = parkedRun('pending-scope-decision')
      const restored: string[][] = []
      const removed: string[] = []
      const git = fakeGit(['held-back.txt', 'also-held.ts'])
      git.restoreToHead = async (_cwd, files) => {
        restored.push([...files])
      }
      git.worktreeRemove = async (_cwd, dir) => {
        removed.push(dir)
      }
      await startServer(git)
      const r = await call(oz!, 'POST', `/runs/${run.id}/resolve`, { body: { disposition: 'discard', note: 'superseded by run_46' } })
      expect(r.status).toBe(200)
      expect(r.json.status).toBe('failed')
      expect(restored).toEqual([['held-back.txt', 'also-held.ts']]) // explicit, recorded discard — never silent
      expect(removed).toEqual([join(home, 'local', 'worktrees', run.id)]) // GC unblocked by the decision
      const events = store.listEvents(run.id)
      expect(events.some((e) => e.type === 'scope-decision-discarded-files')).toBe(true)
      expect(events.some((e) => e.type === 'scope-decision')).toBe(true)
    })

    test('landed verifies the branch tip is an ancestor of trunk HEAD, then completed/merged', async () => {
      const run = parkedRun('pending-landing')
      const git = fakeGit()
      git.isAncestor = async () => true
      await startServer(git)
      const r = await call(oz!, 'POST', `/runs/${run.id}/resolve`, { body: { disposition: 'landed' } })
      expect(r.status).toBe(200)
      expect(store.getRun(run.id)?.status).toBe('completed')
      expect(store.getRun(run.id)?.integrationStatus).toBe('merged')
    })

    test('landed is REFUSED (409) when the branch tip is not on trunk — fail closed', async () => {
      const run = parkedRun('pending-scope-decision')
      const git = fakeGit()
      git.isAncestor = async () => false // cherry-picked / superseded branch: tip not an ancestor
      await startServer(git)
      const r = await call(oz!, 'POST', `/runs/${run.id}/resolve`, { body: { disposition: 'landed' } })
      expect(r.status).toBe(409)
      expect(store.getRun(run.id)?.status).toBe('pending-scope-decision') // untouched
    })

    test('only a parked run takes a resolution (409 otherwise); bad disposition is 400', async () => {
      store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
      const done = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
      store.setRunStatus(done.id, 'completed')
      await startServer()
      expect((await call(oz!, 'POST', `/runs/${done.id}/resolve`, { body: { disposition: 'discard' } })).status).toBe(409)
      expect((await call(oz!, 'POST', `/runs/${done.id}/resolve`, { body: { disposition: 'expand' } })).status).toBe(400)
      expect((await call(oz!, 'POST', '/runs/nope/resolve', { body: { disposition: 'discard' } })).status).toBe(404)
    })

    test('resolve → 403 without a CSRF token (mutation gate)', async () => {
      const run = parkedRun('pending-scope-decision')
      await startServer()
      const r = await call(oz!, 'POST', `/runs/${run.id}/resolve`, { csrf: false, body: { disposition: 'discard' } })
      expect(r.status).toBe(403)
    })
  })
})
