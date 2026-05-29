// Stage-4 mutations + run-lifecycle correctness: launch (202 / 409 in-flight), deep-link (200 / 409
// non-live, never 500), assignments write (validate + atomic), startup orphan reconciliation.
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, type Adapter, type Git, type RunnerIO, type RunStore, type SessionHost, type SessionRef } from '@cocoder/core'
import { createOzServer, OZ_CSRF_HEADER, type OzServer } from '../src/index.js'

const okAdapter: Adapter = {
  id: 'any',
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }] }),
}
const fakeGit = (changed: string[] = ['packages/x.ts']): Git => ({
  async headSha() {
    return 'h0'
  },
  async changedFiles() {
    return changed
  },
  async addAndCommit() {
    return 'sha-committed'
  },
  async show() {
    return 'diff'
  },
})
const fakeHost = (onShow?: (ref: SessionRef) => void, onKill?: (ref: SessionRef) => void): SessionHost => {
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

// Fake RunnerIO so runRun completes against fakes (no real delegation file to poll for).
const fakeIO = (task = 'do the thing'): RunnerIO => ({
  async ensureRunDir() {},
  async awaitDelegation() {
    return { task }
  },
  async awaitBuilderDone() {
    return { summary: 'done' }
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
  await writeFile(join(home, 'cocoder', 'priorities', 'demo.md'), `---\nid: demo\ntitle: Demo\n---\nDo the thing.`)
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

  const startServer = async (): Promise<OzServer> => {
    shown = []
    killed = []
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(
        (ref) => shown.push(ref),
        (ref) => killed.push(ref),
      ),
      getAdapter: () => okAdapter,
      io: fakeIO(),
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

  test('POST /runs/:id/teardown closes ONLY the run\'s live tracked surfaces', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'oscar', sessionRef: 'surface:1' })
    store.createSession({ runId: run.id, persona: 'bob', sessionRef: 'surface:2' })
    store.createSession({ runId: run.id, persona: 'ghost', sessionRef: 'surface:stale' }) // not live
    await startServer()
    oz!.ctx.liveRefs.add('surface:1')
    oz!.ctx.liveRefs.add('surface:2') // surface:stale intentionally NOT live

    const r = await call(oz!, 'POST', `/runs/${run.id}/teardown`)
    expect(r.status).toBe(200)
    expect(r.json.closed.sort()).toEqual(['surface:1', 'surface:2'])
    expect(killed.map((k) => k.id).sort()).toEqual(['surface:1', 'surface:2']) // never the stale one
    expect(oz!.ctx.liveRefs.has('surface:1')).toBe(false) // cleared from the live set
    expect(store.listEvents(run.id).some((e) => e.type === 'teardown')).toBe(true)
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

  test('PUT assignments → 403 without a CSRF token (mutation gate)', async () => {
    await startServer()
    const r = await call(oz!, 'PUT', '/workspaces/cocoder/personas/assignments', { csrf: false, body: { personas: {} } })
    expect(r.status).toBe(403)
  })

  test('startup orphan reconciliation: a running row at boot is marked failed', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const orphan = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' }) // status 'running'
    await startServer() // reconcileOrphans runs in createOzServer
    expect(store.getRun(orphan.id)?.status).toBe('failed')
    expect(store.listEvents(orphan.id).some((e) => e.type === 'orphaned')).toBe(true)
  })
})
