// Stage-4 mutations + run-lifecycle correctness: launch (202 / 409 in-flight), deep-link (200 / 409
// non-live, never 500), assignments write (validate + atomic), startup orphan reconciliation.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadAssignments, loadOnboardingPlaybooks, loadPlaybookExecutor, loadPriority, makeGit, openRunStore, readTickets, StopRequestedError, type Adapter, type Git, type RunnerIO, type RunStore, type SessionHost, type SessionRef } from '@cocoder/core'
import { basePlaybooksDir, basePrioritiesDir } from '@cocoder/personas'
import { createOzServer, OZ_CSRF_HEADER, type OzServer } from '../src/index.js'
import { createDaemonPlaybookPhaseAction } from '../src/launcher.js'

const exec = promisify(execFile)
const g = (cwd: string, args: string[]): Promise<string> => exec('git', ['-C', cwd, ...args]).then((r) => r.stdout.trim())
const COCODER_GOVERNANCE = { name: 'cocoder-governance', email: 'governance@cocoder.local' } as const

const okAdapter: Adapter = {
  id: 'any',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
  headlessCapable: false,
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
}
interface CliAdapterCalls {
  preflight: number
  listModels: number
}
const cliAdapter = (id: string, detail: string, calls?: CliAdapterCalls, headlessCapable = false): Adapter => ({
  id,
  runReadiness: { mechanism: 'launch-flags', flags: [`--${id}`], managesUserConfig: false, detail },
  headlessCapable,
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
const expectedScaffoldAssignments = {
  oscar: {
    cli: 'claude',
    model: '',
    plays: {
      'wrap-up': { cli: 'cursor-agent', model: '' },
    },
  },
  bob: { cli: 'codex', model: '' },
  deb: { cli: 'codex', model: '', enabled: true },
}
const expectedScaffoldFiles = [
  'cocoder/.gitignore',
  'cocoder/AGENTS.md',
  'cocoder/CLAUDE.md',
  'cocoder/SESSION_LOG.md',
  'cocoder/decisions/README.md',
  'cocoder/memory/AGENTS.md',
  'cocoder/memory/codebase-map.md',
  'cocoder/memory/tech-stack.md',
  'cocoder/personas/assignments.json',
  'cocoder/personas/custom/.gitkeep',
  'cocoder/priorities/.gitkeep',
  'cocoder/priorities/adhoc-session.md',
  'cocoder/standards/AGENTS.md',
  'cocoder/tickets/INDEX.md',
]
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
interface GovernanceCommitCall {
  readonly cwd: string
  readonly files: readonly string[]
  readonly message: string
  readonly author: { readonly name: string; readonly email: string } | undefined
}
const recordingGovernanceGit = (calls: GovernanceCommitCall[], sha = 'sha-governance'): Git => ({
  ...fakeGit(),
  async addAndCommit(cwd, files, message, author) {
    calls.push({ cwd, files: [...files], message, author })
    return sha
  },
})
const fakeGitByCwd = (shas: Readonly<Record<string, readonly string[] | string>>, fallback = 'h0'): Git => {
  const headCalls = new Map<string, number>()
  return {
    ...fakeGit(),
    async headSha(cwd) {
      const value = shas[cwd] ?? fallback
      if (Array.isArray(value)) {
        const call = headCalls.get(cwd) ?? 0
        headCalls.set(cwd, call + 1)
        return value[Math.min(call, value.length - 1)] ?? fallback
      }
      return value
    },
  }
}
const fakeHost = (
  onShow?: (ref: SessionRef) => void,
  onKill?: (ref: SessionRef) => void,
  onClose?: (args: { workspaceRef: string; surfaceRef: string }) => void,
  onCloseWorkspace?: (args: { workspaceRef: string }) => void,
): SessionHost => {
  let n = 0
  const receiverToken = Symbol('fake host receiver')
  const host: SessionHost & { receiverToken: symbol } = {
    receiverToken,
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
    async closeWorkspace(this: (SessionHost & { receiverToken?: symbol }) | undefined, args) {
      if (this?.receiverToken !== receiverToken) throw new Error("Cannot read properties of undefined (reading '#cli')")
      onCloseWorkspace?.(args)
    },
  }
  return host
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
const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
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
  async writeRunArtifact(runDir, fileName, contents) {
    await mkdir(runDir, { recursive: true })
    const path = join(runDir, fileName)
    await writeFile(path, contents, 'utf8')
    return path
  },
  async writeRunRecord(runDir) {
    return `${runDir}/record.md`
  },
})

const stopAwaitingDirectiveIO = (): RunnerIO => ({
  ...fakeIO(),
  async awaitDirective(_path, opts) {
    const signal = opts.signal
    if (!signal) throw new Error('test: stop signal was not passed to RunnerIO')
    if (signal.aborted) throw new StopRequestedError()
    return await new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new StopRequestedError()), { once: true })
    })
  },
  async awaitTriage() {
    throw new Error('triage should not run for cooperative stop')
  },
})

function controlledDirectiveIO(): { readonly io: RunnerIO; release(): void } {
  let releaseAll: (() => void) | null = null
  const released = new Promise<void>((resolve) => {
    releaseAll = resolve
  })
  return {
    io: {
      ...fakeIO(),
      async ensureRunDir(runDir) {
        await mkdir(runDir, { recursive: true })
      },
      async awaitDirective() {
        await released
        return { kind: 'wrapup' as const, pickup: 'nothing further this run' }
      },
    },
    release() {
      releaseAll?.()
    },
  }
}

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

function ticketFile(id: string, title: string, state: 'Open' | 'Closed' = 'Open'): string {
  return `---\nid: ${id}\ntitle: ${title}\ntype: task\nstatus: ${state}\npriority: none\nowner: founder-session\ncreated: 2026-06-17\n---\n\n# ${id} — ${title}\n\n## Context\n`
}

async function writeTicketIndex(home: string): Promise<void> {
  await mkdir(join(home, 'cocoder', 'tickets', 'open'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'tickets', 'closed'), { recursive: true })
  await writeFile(
    join(home, 'cocoder', 'tickets', 'INDEX.md'),
    [
      '# Tickets — Index',
      '',
      '## Open',
      '',
      '| ID | Title | Type | Priority | Owner |',
      '|---|---|---|---|---|',
      '| [0003](./open/0003-existing-open.md) | Existing open | task | none | founder-session |',
      '',
      '## Recently Closed',
      '',
      '| ID | Title | Type | Closed | Resolution |',
      '|---|---|---|---|---|',
      '| [0012](./closed/0012-existing-closed.md) | Existing closed | task | 2026-06-17 | Done |',
      '',
    ].join('\n'),
  )
  await writeFile(join(home, 'cocoder', 'tickets', 'open', '0003-existing-open.md'), ticketFile('0003', 'Existing open'))
  await writeFile(join(home, 'cocoder', 'tickets', 'closed', '0012-existing-closed.md'), ticketFile('0012', 'Existing closed', 'Closed'))
}

async function initRepo(path: string): Promise<void> {
  await g(path, ['init', '-q', '-b', 'trunk'])
  await g(path, ['config', 'user.email', 't@t.test'])
  await g(path, ['config', 'user.name', 'Test'])
  await g(path, ['add', '-A'])
  await g(path, ['commit', '-q', '-m', 'init'])
}

async function writeWorkspaceFile(home: string, id = 'cocoder', data: unknown = { folders: [{ path: '${COCODER_HOME}', role: 'primary' }], settings: {} }): Promise<string> {
  const dir = join(home, 'local', 'workspace')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${id}.code-workspace`)
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`)
  return file
}

async function writeExternalWorkspace(home: string, id = 'external'): Promise<string> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'cocoder-external-workspace-'))
  await mkdir(join(workspacePath, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(workspacePath, 'cocoder', 'personas'), { recursive: true })
  await writeFile(join(workspacePath, 'cocoder', 'priorities', 'demo.md'), `---\nid: demo\ntitle: Demo\n---\n## Objective\nDo the thing.`)
  await writeFile(join(workspacePath, 'cocoder', 'personas', 'oscar.md'), `---\nid: oscar\nlabel: Orchestrator\nrole: orchestrator\nwriteScope: []\n---\nOscar`)
  await writeFile(join(workspacePath, 'cocoder', 'personas', 'bob.md'), `---\nid: bob\nlabel: Builder\nrole: builder\nwriteScope:\n  - packages/**\n---\nBob`)
  await writeFile(
    join(workspacePath, 'cocoder', 'personas', 'assignments.json'),
    JSON.stringify({ personas: { oscar: { cli: 'claude', model: '' }, bob: { cli: 'codex', model: '' } } }),
  )
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id, name: 'External', path: workspacePath }] }))
  return workspacePath
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

  test('POST /runs allows concurrent runs in different workspaces without shared-resource collisions', async () => {
    const externalPath = await writeExternalWorkspace(home)
    await writeFile(
      join(home, 'local', 'workspaces.json'),
      JSON.stringify({
        workspaces: [
          { id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' },
          { id: 'external', name: 'External', path: externalPath },
        ],
      }),
    )
    const events: Array<{ type: string; runId?: string; workspaceId?: string; status?: string }> = []
    const controlled = controlledDirectiveIO()
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(),
      getAdapter: () => okAdapter,
      io: controlled.io,
      runHeadless: async () => ({ exitCode: 0, output: 'wrap closeout' }),
    })
    const unsubscribe = oz.ctx.events.subscribe((event) => events.push(event))
    try {
      const [a, b] = await Promise.all([
        call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } }),
        call(oz, 'POST', '/runs', { body: { workspaceId: 'external', priorityId: 'demo' } }),
      ])
      expect(a.status).toBe(202)
      expect(b.status).toBe(202)
      const aRunId = a.json.runId as string
      const bRunId = b.json.runId as string
      expect(aRunId).toMatch(/^run_/)
      expect(bRunId).toMatch(/^run_/)
      expect(aRunId).not.toBe(bRunId)
      expect(oz.ctx.inFlight.get('cocoder')).toBe(aRunId)
      expect(oz.ctx.inFlight.get('external')).toBe(bRunId)

      const sameWorkspace = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
      expect(sameWorkspace.status).toBe(409)
      expect(sameWorkspace.json.error).toContain('workspace "cocoder"')
      expect(store.listRuns({ workspaceId: 'cocoder' })).toHaveLength(1)
      expect(store.listRuns({ workspaceId: 'external' })).toHaveLength(1)
      for (let i = 0; i < 50 && (store.listEvents(aRunId).length === 0 || store.listEvents(bRunId).length === 0); i++) {
        await sleep(10)
      }
      expect(store.listEvents(aRunId).map((event) => event.type)).toContain('run-start')
      expect(store.listEvents(bRunId).map((event) => event.type)).toContain('run-start')
      expect(join(home, 'local', 'runs', aRunId)).not.toBe(join(home, 'local', 'runs', bRunId))

      controlled.release()
      for (let i = 0; i < 50 && (oz.ctx.inFlight.has('cocoder') || oz.ctx.inFlight.has('external')); i++) {
        await sleep(10)
      }

      expect(store.getRun(aRunId)?.status).toBe('completed')
      expect(store.getRun(bRunId)?.status).toBe('completed')
      expect(oz.ctx.inFlight.has('cocoder')).toBe(false)
      expect(oz.ctx.inFlight.has('external')).toBe(false)
      expect(await exists(join(home, 'local', 'runs', aRunId))).toBe(true)
      expect(await exists(join(home, 'local', 'runs', bRunId))).toBe(true)

      const aPortable = JSON.parse(await readFile(join(home, 'cocoder', 'runs', `1-${aRunId}`, 'run.json'), 'utf8')) as { run: { id: string; displayNumber: number }; workspace: { id: string } }
      const bPortable = JSON.parse(await readFile(join(externalPath, 'cocoder', 'runs', `1-${bRunId}`, 'run.json'), 'utf8')) as { run: { id: string; displayNumber: number }; workspace: { id: string } }
      expect(aPortable).toMatchObject({ run: { id: aRunId, displayNumber: 1 }, workspace: { id: 'cocoder' } })
      expect(bPortable).toMatchObject({ run: { id: bRunId, displayNumber: 1 }, workspace: { id: 'external' } })
      expect(await exists(join(home, 'cocoder', 'runs', `1-${bRunId}`, 'run.json'))).toBe(false)
      expect(await exists(join(externalPath, 'cocoder', 'runs', `1-${aRunId}`, 'run.json'))).toBe(false)

      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'run-created', runId: aRunId, workspaceId: 'cocoder' }),
        expect.objectContaining({ type: 'run-created', runId: bRunId, workspaceId: 'external' }),
        expect.objectContaining({ type: 'run-settled', runId: aRunId, workspaceId: 'cocoder', status: 'completed' }),
        expect.objectContaining({ type: 'run-settled', runId: bRunId, workspaceId: 'external', status: 'completed' }),
      ]))
    } finally {
      unsubscribe()
    }
  })

  test('POST /runs rejects both-set and neither-set targets before creating a run', async () => {
    await startServer()

    const both = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo', playbookId: 'drift-audit' } })
    const priorityAndTicket = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo', ticketId: '0003' } })
    const neither = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder' } })

    expect(both).toEqual({ status: 400, json: { error: 'exactly one of priorityId, playbookId, or ticketId is required' } })
    expect(priorityAndTicket).toEqual({ status: 400, json: { error: 'exactly one of priorityId, playbookId, or ticketId is required' } })
    expect(neither).toEqual({ status: 400, json: { error: 'exactly one of priorityId, playbookId, or ticketId is required' } })
    expect(store.listRuns()).toEqual([])
  })

  test('POST /runs rejects an unknown onboarding playbook', async () => {
    await startServer()

    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', playbookId: 'missing-playbook' } })

    expect(r).toEqual({ status: 400, json: { error: 'unknown onboarding playbook "missing-playbook"' } })
    expect(store.listRuns()).toEqual([])
  })

  test('POST /runs launches an onboarding playbook, records its target, and invokes the executor seam', async () => {
    await startServer()

    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', playbookId: 'drift-audit' } })

    expect(r.status).toBe(202)
    expect(r.json).toMatchObject({ runId: expect.stringMatching(/^run_/), target: { kind: 'playbook', id: 'drift-audit' } })
    const runId = String(r.json.runId)
    let detail: Resp | null = null
    for (let i = 0; i < 50; i++) {
      detail = await call(oz!, 'GET', `/runs/${runId}`)
      if (detail.json.run.status !== 'running') break
      await sleep(10)
    }
    expect(detail?.json.run).toMatchObject({ id: runId, priorityId: 'onboarding-playbook', playbookId: 'drift-audit', status: 'awaiting-founder' })
    expect(detail?.json.target).toEqual({ kind: 'playbook', id: 'drift-audit' })
    const state = JSON.parse(await readFile(join(home, 'local', 'runs', runId, 'playbook-state.json'), 'utf8')) as { readonly playbookId: string; readonly status: string }
    expect(state).toMatchObject({ playbookId: 'drift-audit', status: 'awaiting-founder' })
    expect(store.listEvents(runId).some((event) => event.type === 'playbook-executor')).toBe(true)
  })

  test('POST /runs launches an open ticket through the priority lifecycle and records its target', async () => {
    await writeTicketIndex(home)
    const commits: GovernanceCommitCall[] = []
    const prompts: string[] = []
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: recordingGovernanceGit(commits),
      sessionHost: fakeHost(),
      getAdapter: () => ({ ...okAdapter, build: (input) => {
        prompts.push(input.prompt)
        return { command: 'x', args: [] }
      } }),
      io: fakeIO(),
      runHeadless: async () => ({ exitCode: 0, output: 'wrap closeout' }),
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', ticketId: '0003' } })

    expect(r.status).toBe(202)
    expect(r.json).toMatchObject({ runId: expect.stringMatching(/^run_/), target: { kind: 'ticket', id: '0003' } })
    const runId = String(r.json.runId)
    let detail: Resp | null = null
    for (let i = 0; i < 50; i++) {
      detail = await call(oz, 'GET', `/runs/${runId}`)
      if (detail.json.run.status !== 'running') break
      await sleep(10)
    }
    expect(detail?.json.run).toMatchObject({ id: runId, priorityId: 'ticket-fix', ticketId: '0003', playbookId: null, status: 'completed' })
    expect(detail?.json.target).toEqual({ kind: 'ticket', id: '0003' })
    expect(store.listEvents(runId).some((event) => event.type === 'playbook-executor')).toBe(false)
    expect(prompts[0]).toContain('Priority: **Ticket 0003: Existing open**')
    expect(prompts[0]).toContain('Fix ticket 0003: Existing open.')

    const ticketDir = join(home, 'cocoder', 'tickets')
    expect(await exists(join(ticketDir, 'open', '0003-existing-open.md'))).toBe(false)
    const closedPath = join(ticketDir, 'closed', '0003-existing-open.md')
    expect(await exists(closedPath)).toBe(true)
    const closedMarkdown = await readFile(closedPath, 'utf8')
    expect(closedMarkdown).toContain('status: Closed')
    expect(closedMarkdown).toContain('## Resolution')
    expect(closedMarkdown).toContain(`Resolved by run ${runId}`)
    const loaded = (await readTickets(ticketDir)).find((ticket) => ticket.id === '0003')
    expect(loaded).toMatchObject({ id: '0003', state: 'closed', status: 'Closed' })

    const index = await readFile(join(ticketDir, 'INDEX.md'), 'utf8')
    const openSection = index.slice(index.indexOf('## Open'), index.indexOf('## Recently Closed'))
    const closedSection = index.slice(index.indexOf('## Recently Closed'))
    expect(openSection).not.toContain('0003')
    expect(closedSection).toContain('| [0003](./closed/0003-existing-open.md) | Existing open | task |')
    expect(closedSection).toContain('Ticket fix run completed successfully.')
    expect(commits).toContainEqual(expect.objectContaining({
      cwd: home,
      files: ['cocoder/tickets/closed/0003-existing-open.md', 'cocoder/tickets/open/0003-existing-open.md', 'cocoder/tickets/INDEX.md'],
      message: `governance: close ticket 0003 via run ${runId}`,
      author: COCODER_GOVERNANCE,
    }))
    const audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"ticket-close"')
    expect(audit).toContain('"ticketId":"0003"')
  })

  test('POST /runs leaves a ticket open when the ticket run does not succeed', async () => {
    await writeTicketIndex(home)
    const commits: GovernanceCommitCall[] = []
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: recordingGovernanceGit(commits),
      sessionHost: fakeHost(),
      getAdapter: () => ({
        ...okAdapter,
        preflight: async () => ({ ok: false, checks: [{ name: 'model', ok: false, detail: 'no model' }] }),
      }),
      io: fakeIO(),
      runHeadless: async () => ({ exitCode: 0, output: 'wrap closeout' }),
    })
    const beforeIndex = await readFile(join(home, 'cocoder', 'tickets', 'INDEX.md'), 'utf8')

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', ticketId: '0003' } })

    expect(r.status).toBe(202)
    const runId = String(r.json.runId)
    let detail: Resp | null = null
    for (let i = 0; i < 50; i++) {
      detail = await call(oz, 'GET', `/runs/${runId}`)
      if (detail.json.run.status !== 'running') break
      await sleep(10)
    }
    expect(detail?.json.run.status).toBe('failed')
    expect(await exists(join(home, 'cocoder', 'tickets', 'open', '0003-existing-open.md'))).toBe(true)
    expect(await exists(join(home, 'cocoder', 'tickets', 'closed', '0003-existing-open.md'))).toBe(false)
    expect(await readFile(join(home, 'cocoder', 'tickets', 'INDEX.md'), 'utf8')).toBe(beforeIndex)
    expect(commits).toEqual([])
  })

  test('POST /runs rejects unknown and closed ticket targets', async () => {
    await writeTicketIndex(home)
    await startServer()

    const unknown = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', ticketId: '9999' } })
    const closed = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', ticketId: '0012' } })

    expect(unknown).toEqual({ status: 400, json: { error: 'unknown ticket "9999"' } })
    expect(closed).toEqual({ status: 400, json: { error: 'ticket "0012" is not open' } })
    expect(store.listRuns()).toEqual([])
  })

  test('POST /runs launches takeover P1 through the daemon phase dispatcher and writes P1 artifacts', async () => {
    await writeFile(join(home, 'README.md'), '# CoCoder Fixture\nTakeover onboarding fixture.\n', 'utf8')
    const prompts: string[] = []
    const outputs = [
      JSON.stringify({
        subsystems: [
          {
            id: 'governance',
            name: 'Governance',
            pathGlobs: ['cocoder/**'],
            entryPoints: [],
            validationCommands: [],
            boundaryReason: 'Fixture governance root.',
            allowedAdjacency: [],
          },
        ],
        humanMap: 'Governance covers the fixture cocoder root.',
        complexitySignals: {
          crossSubsystemCoupling: [],
          unclearOwnership: [],
          stackHeterogeneity: [],
          weakValidation: [],
          broadEntryPoints: [],
          highRiskSurfaces: [],
        },
      }),
      JSON.stringify({
        claims: [{ claim: 'The fixture exists for takeover onboarding.', provenance: ['README.md'] }],
        openQuestions: ['What should P2 inspect first?'],
      }),
    ]
    const p1Adapter: Adapter = {
      ...okAdapter,
      build: (input) => {
        prompts.push(input.prompt)
        return { command: 'fake-agent', args: [] }
      },
    }
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(),
      getAdapter: () => p1Adapter,
      io: fakeIO(),
      runHeadless: async () => ({ exitCode: 0, output: outputs.shift() ?? '{}' }),
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', playbookId: 'cocoder-takeover' } })

    expect(r.status).toBe(202)
    const runId = String(r.json.runId)
    let detail: Resp | null = null
    for (let i = 0; i < 50; i++) {
      detail = await call(oz, 'GET', `/runs/${runId}`)
      if (detail.json.run.status !== 'running') break
      await sleep(10)
    }
    expect(detail?.json.run).toMatchObject({ id: runId, playbookId: 'cocoder-takeover', status: 'awaiting-founder' })
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('# P1 Agentic Recon Pass')
    expect(prompts[1]).toContain('# P1 Takeover Intent Intake')
    const p1Dir = join(home, 'local', 'runs', runId, 'playbook', 'P1')
    await expect(readFile(join(p1Dir, 'inventory.json'), 'utf8')).resolves.toContain('"fileCount"')
    await expect(readFile(join(p1Dir, 'subsystems.json'), 'utf8')).resolves.toContain('"governance"')
    await expect(readFile(join(p1Dir, 'intent.json'), 'utf8')).resolves.toContain('takeover onboarding')
    await expect(readFile(join(p1Dir, 'estimate.json'), 'utf8')).resolves.toContain('"subsystemCount": 1')
    await expect(readFile(join(p1Dir, 'pickup.md'), 'utf8')).resolves.toContain('## Spend Decision')
  })

  test('takeover playbook resumes through P6 ratification and applies governance at P7', async () => {
    await writeFile(join(home, 'README.md'), '# CoCoder Fixture\nTakeover onboarding fixture.\n', 'utf8')
    const builds: Array<{ readonly persona: string; readonly model: string; readonly prompt: string }> = []
    const reconOutput = {
      subsystems: [
        {
          id: 'governance',
          name: 'Governance',
          pathGlobs: ['cocoder/**'],
          entryPoints: ['README.md'],
          validationCommands: ['pnpm -w typecheck'],
          boundaryReason: 'Fixture governance root.',
          allowedAdjacency: [],
        },
      ],
      humanMap: 'Governance covers the fixture repo instructions.',
      complexitySignals: {
        crossSubsystemCoupling: [],
        unclearOwnership: [],
        stackHeterogeneity: [],
        weakValidation: [],
        broadEntryPoints: [],
        highRiskSurfaces: [],
      },
    }
    const intentOutput = {
      claims: [{ claim: 'The fixture exists for takeover onboarding.', provenance: ['README.md'] }],
      openQuestions: ['What should P2 inspect first?'],
    }
    const deepReadOutput = (source: 'builder' | 'orchestrator', iteration: number): string => JSON.stringify({
      theory: {
        purpose: 'Maintain repo onboarding governance.',
        keyBehaviors: ['Explain takeover onboarding', 'Validate workspace health'],
        dataControlFlow: 'README.md describes the fixture and pnpm -w typecheck validates workspace health.',
        riskSurface: source === 'builder' ? 'Governance drift.' : 'Governance drift plus stale validation.',
      },
      findings: [
        { axis: 'entry point', claim: 'README.md explains takeover onboarding.', evidence: 'README.md:1', confidence: 'high', severity: 'low' },
        { axis: 'validation', claim: 'pnpm -w typecheck validates workspace health.', evidence: 'package.json:scripts.typecheck', confidence: 'high', severity: 'low' },
      ],
      residualGaps: [{ note: 'Validation proof still needs a runnable priority.', confidence: 'high', severity: 'high', coversValidationCommand: 'pnpm -w typecheck' }],
      decision: iteration === 2 ? 'converged' : 'read-more',
    })
    const adapter: Adapter = {
      ...okAdapter,
      build: (input) => {
        builds.push({ persona: input.persona, model: input.model, prompt: input.prompt })
        return { command: 'fake-agent', args: [input.persona, input.prompt] }
      },
    }
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit([
        'cocoder/memory/architecture-notes.md',
        'cocoder/priorities/INDEX.md',
        'cocoder/priorities/objective-1.md',
        'cocoder/priorities/objective-2.md',
        'cocoder/priorities/objective-3.md',
      ]),
      sessionHost: fakeHost(),
      getAdapter: () => adapter,
      io: fakeIO(),
      runHeadless: async (input) => {
        const prompt = String(input.args[1] ?? '')
      if (prompt.includes('# P1 Agentic Recon Pass')) return { exitCode: 0, output: JSON.stringify(reconOutput) }
      if (prompt.includes('# P1 Takeover Intent Intake')) return { exitCode: 0, output: JSON.stringify(intentOutput) }
      if (prompt.includes('P3 follow-up')) return { exitCode: 0, output: deepReadOutput('orchestrator', 2) }
      const source = prompt.includes('Deep-read source: builder') ? 'builder' : 'orchestrator'
      const iteration = prompt.includes('Iteration: 2') ? 2 : 1
      return { exitCode: 0, output: deepReadOutput(source, iteration) }
      },
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', playbookId: 'cocoder-takeover' } })
    expect(r.status).toBe(202)
    const runId = String(r.json.runId)
    let detail: Resp | null = null
    for (let i = 0; i < 50; i++) {
      detail = await call(oz, 'GET', `/runs/${runId}`)
      if (detail.json.run.status !== 'running') break
      await sleep(10)
    }
    expect(detail?.json.run).toMatchObject({ id: runId, playbookId: 'cocoder-takeover', status: 'awaiting-founder' })

    oz.ctx.cliTestCache.set('codex', {
      preflight: { ok: true, checks: [] },
      models: { canEnumerate: true, models: ['gpt-top'], detail: 'codex models' },
      testedAt: 1,
    })
    oz.ctx.cliTestCache.set('claude', {
      preflight: { ok: true, checks: [] },
      models: { canEnumerate: true, models: ['opus-top'], detail: 'claude models' },
      testedAt: 1,
    })
    const playbook = loadOnboardingPlaybooks(basePlaybooksDir()).find((candidate) => candidate.id === 'cocoder-takeover')
    expect(playbook).toBeDefined()
    const runDir = join(home, 'local', 'runs', runId)
    const realRunPhase = createDaemonPlaybookPhaseAction(oz.ctx, home, runDir, runId, playbook!.modelPin, { cli: 'codex', model: '' }, new AbortController().signal)
    const resumedPhases: string[] = []
    const loaded = await loadPlaybookExecutor({
      playbook: playbook!,
      runDir,
      now: (() => {
        let clock = 1000
        return () => clock++
      })(),
      runPhase: async (input) => {
        resumedPhases.push(input.phase.id)
        await realRunPhase(input)
      },
    })
    const resumed = await loaded.resume({ approvedBy: 'founder', note: 'continue into P2' })

    expect(resumed.state).toMatchObject({ status: 'awaiting-founder', currentPhaseId: 'P4', gate: { phaseId: 'P4' } })
    expect(resumedPhases).toEqual(['P2', 'P3', 'P4'])
    expect(builds.filter((build) => build.prompt.includes('Deep-read source: builder')).map((build) => build.model)).toEqual(['gpt-top', 'gpt-top'])
    expect(builds.filter((build) => build.prompt.includes('Deep-read source: orchestrator') && !build.prompt.includes('P3 follow-up')).map((build) => build.model)).toEqual(['opus-top', 'opus-top'])
    expect(builds.filter((build) => build.prompt.includes('P3 follow-up')).map((build) => build.model)).toEqual(expect.arrayContaining(['opus-top']))
    expect(builds.filter((build) => build.prompt.includes('P3 follow-up')).every((build) => build.model === 'opus-top')).toBe(true)
    const p2Dir = join(runDir, 'playbook', 'P2')
    await expect(readFile(join(p2Dir, 'findings', 'governance', 'builder.md'), 'utf8')).resolves.toContain('## Iteration 2')
    await expect(readFile(join(p2Dir, 'findings', 'governance', 'orchestrator.md'), 'utf8')).resolves.toContain('stale validation')
    await expect(readFile(join(p2Dir, 'convergence', 'governance.json'), 'utf8')).resolves.toContain('"agreementIndex"')
    const fanoutEvents = store.listEvents(runId).filter((event) => event.type === 'playbook-fanout-result')
    expect(fanoutEvents.map((event) => (event.data as { source: string }).source).sort()).toEqual(['builder', 'orchestrator'])
    const p3Dir = join(runDir, 'playbook', 'P3')
    await expect(readFile(join(p3Dir, 'convergence.json'), 'utf8')).resolves.toContain('"converged": true')
    await expect(readFile(join(p3Dir, 'cross-check.md'), 'utf8')).resolves.toContain('Converged: true')
    const crossCheckEvents = store.listEvents(runId).filter((event) => event.type === 'playbook-cross-check-result')
    expect(crossCheckEvents).toHaveLength(1)
    expect(crossCheckEvents[0]?.data).toMatchObject({ roundsRun: 2, converged: true })
    const p4Dir = join(runDir, 'playbook', 'P4')
    const questions = JSON.parse(await readFile(join(p4Dir, 'questions.json'), 'utf8')) as {
      readonly clarifications: readonly { readonly note: string }[]
      readonly conflictingFindings: readonly unknown[]
      readonly futurePriorities: readonly unknown[]
    }
    expect(Object.keys(questions).sort()).toEqual(['clarifications', 'conflictingFindings', 'futurePriorities', 'version'])
    expect(questions.clarifications.map((item) => item.note)).toContain('What should P2 inspect first?')
    await expect(readFile(join(p4Dir, 'questions.md'), 'utf8')).resolves.toContain('## Clarifications')
    const questionsEvents = store.listEvents(runId).filter((event) => event.type === 'playbook-questions-result')
    expect(questionsEvents).toHaveLength(1)
    expect(questionsEvents[0]?.data).toMatchObject({ clarificationCount: expect.any(Number), conflictingFindingCount: expect.any(Number), futurePriorityCount: expect.any(Number) })

    const resumedAfterP4Phases: string[] = []
    const loadedAfterP4 = await loadPlaybookExecutor({
      playbook: playbook!,
      runDir,
      now: (() => {
        let clock = 2000
        return () => clock++
      })(),
      runPhase: async (input) => {
        resumedAfterP4Phases.push(input.phase.id)
        await realRunPhase(input)
      },
    })
    const resumedAfterP4 = await loadedAfterP4.resume({ approvedBy: 'founder', note: 'synthesize proposed governance' })
    expect(resumedAfterP4.state).toMatchObject({ status: 'awaiting-founder', currentPhaseId: 'P6', gate: { phaseId: 'P6' } })
    expect(resumedAfterP4Phases).toEqual(['P5', 'P6'])
    const p5Dir = join(runDir, 'playbook', 'P5')
    await expect(readFile(join(p5Dir, 'synthesis.json'), 'utf8')).resolves.toContain('"candidatePriorities"')
    await expect(readFile(join(p5Dir, 'synthesis.md'), 'utf8')).resolves.toContain('# P5 Synthesis')
    await expect(readFile(join(p5Dir, 'proposed-cocoder', 'memory', 'architecture-notes.md'), 'utf8')).resolves.toContain('Maintain repo onboarding governance')
    const synthesisEvents = store.listEvents(runId).filter((event) => event.type === 'playbook-synthesis-result')
    expect(synthesisEvents).toHaveLength(1)
    expect(synthesisEvents[0]?.data).toMatchObject({ objectiveCount: expect.any(Number), candidatePriorityCount: expect.any(Number), architectureNoteCount: expect.any(Number) })
    await expect(stat(join(home, 'cocoder', 'AGENTS.md'))).rejects.toThrow()
    await expect(stat(join(home, 'cocoder', 'priorities', 'objective-1.md'))).rejects.toThrow()

    const resumedAfterP6Phases: string[] = []
    const loadedAfterP6 = await loadPlaybookExecutor({
      playbook: playbook!,
      runDir,
      now: (() => {
        let clock = 3000
        return () => clock++
      })(),
      runPhase: async (input) => {
        resumedAfterP6Phases.push(input.phase.id)
        await realRunPhase(input)
      },
    })
    const resumedAfterP6 = await loadedAfterP6.resume({ approvedBy: 'founder', note: 'ratify objectives' })
    expect(resumedAfterP6.state).toMatchObject({ status: 'done', currentPhaseId: null, gate: null })
    expect(resumedAfterP6Phases).toEqual(['P7'])
    await expect(readFile(join(home, 'cocoder', 'memory', 'architecture-notes.md'), 'utf8')).resolves.toContain('Maintain repo onboarding governance')
    const appliedPriority = await readFile(join(home, 'cocoder', 'priorities', 'objective-1.md'), 'utf8')
    expect(appliedPriority).toContain('## Objective')
    expect(appliedPriority).not.toContain('status: future')
    const ratifyEvents = store.listEvents(runId).filter((event) => event.type === 'playbook-ratify-result')
    expect(ratifyEvents).toHaveLength(1)
    expect(ratifyEvents[0]?.data).toMatchObject({ appliedFileCount: 5, objectiveCount: expect.any(Number), priorityCount: expect.any(Number) })
    expect(store.listCommitLinks(runId)).toEqual([expect.objectContaining({
      commitSha: 'sha-committed',
      files: ['cocoder/memory/architecture-notes.md', 'cocoder/priorities/INDEX.md', 'cocoder/priorities/objective-1.md', 'cocoder/priorities/objective-2.md', 'cocoder/priorities/objective-3.md'],
      workItemId: null,
    })])
  })

  test('POST /runs rejects adhoc-session without a task before creating a run', async () => {
    await startServer()

    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'adhoc-session' } })

    expect(r).toEqual({
      status: 400,
      json: { error: 'adhoc-session requires a task; use adhoc <task> or pass task in POST /runs' },
    })
    expect(store.listRuns()).toEqual([])
  })

  test('POST /runs/:id/stop cooperatively stops a live launched run and cleans up panes', async () => {
    shown = []
    killed = []
    const git = fakeGit()
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
      io: stopAwaitingDirectiveIO(),
      runHeadless: async () => ({ exitCode: 0, output: 'wrap closeout' }),
    })

    const launch = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
    expect(launch.status).toBe(202)
    const runId = String(launch.json.runId)
    expect(oz.ctx.stopControllers.has(runId)).toBe(true)

    const stop = await call(oz, 'POST', `/runs/${runId}/stop`)
    expect(stop).toEqual({ status: 202, json: { stopping: true, runId } })

    for (let i = 0; i < 50 && !store.listEvents(runId).some((e) => e.type === 'stop-teardown'); i++) {
      await sleep(10)
    }

    expect(store.getRun(runId)?.status).toBe('stopped')
    expect(oz.ctx.stopControllers.has(runId)).toBe(false)
    expect(killed.map((k) => k.id).sort()).toEqual(['surface:1', 'surface:2'])
    const events = store.listEvents(runId)
    expect(events.some((e) => e.type === 'run-stopped')).toBe(true)
    expect(events.some((e) => e.type === 'stop-teardown')).toBe(true)
    expect(events.some((e) => ['directive-timeout', 'builder-failed'].includes(e.type))).toBe(false)
  })

  test('POST /runs/:id/stop → 404 for an unknown run', async () => {
    await startServer()
    expect((await call(oz!, 'POST', '/runs/nope/stop')).status).toBe(404)
  })

  test('POST /runs/:id/stop → 409 for terminal runs', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const completed = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(completed.id, 'completed')
    const failed = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(failed.id, 'failed')
    await startServer()

    expect((await call(oz!, 'POST', `/runs/${completed.id}/stop`)).status).toBe(409)
    expect((await call(oz!, 'POST', `/runs/${failed.id}/stop`)).status).toBe(409)
  })

  test('POST /runs/:id/stop → 409 for a running row with no live controller', async () => {
    await startServer()
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })

    const r = await call(oz!, 'POST', `/runs/${run.id}/stop`)

    expect(r.status).toBe(409)
    expect(store.getRun(run.id)?.status).toBe('running')
  })

  test('POST /runs/:id/stop → 403 without a CSRF token (mutation gate)', async () => {
    await startServer()
    const r = await call(oz!, 'POST', '/runs/nope/stop', { csrf: false })
    expect(r.status).toBe(403)
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

  test('launch stale gate compares the engine repo HEAD, not the target workspace HEAD', async () => {
    const workspacePath = await writeExternalWorkspace(home)
    await startServer(fakeGitByCwd({ [home]: ['engine-sha', 'engine-sha'], [workspacePath]: 'workspace-sha' }))

    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'external', priorityId: 'demo' } })

    expect(r.status).toBe(202)
    expect(r.json.runId).toMatch(/^run_/)
  })

  test("a genuinely stale daemon still refuses based on engine HEAD, regardless of the workspace's HEAD", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let restarts = 0
    try {
      const workspacePath = await writeExternalWorkspace(home)
      oz = await createOzServer({
        cocoderHome: home,
        port: 0,
        store,
        git: fakeGitByCwd({ [home]: ['boot-sha', 'engine-head'], [workspacePath]: 'boot-sha' }),
        sessionHost: fakeHost(),
        getAdapter: () => okAdapter,
        io: fakeIO(),
        restartDaemon: () => {
          restarts += 1
        },
      })

      const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'external', priorityId: 'demo' } })

      expect(r.status).toBe(425)
      expect(r.json.stale).toBe(true)
      expect(r.json.restarting).toBe(true)
      expect(r.json.bootSha).toBe('boot-sha')
      expect(r.json.headSha).toBe('engine-head')
      expect(restarts).toBe(1)
    } finally {
      warn.mockRestore()
    }
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
        headlessCapable: false,
      },
      {
        id: 'beta',
        tested: false,
        testedAt: null,
        install: { ok: false, detail: 'not yet tested' },
        auth: { ok: false, detail: 'not yet tested' },
        models: { canEnumerate: false, models: [], detail: 'not yet tested' },
        configManaged: adapters[1]!.runReadiness,
        headlessCapable: false,
      },
    ])
  })

  test('GET /clis surfaces headless capability from each adapter', async () => {
    const adapters = [
      cliAdapter('claude', 'managed claude', undefined, false),
      cliAdapter('codex', 'managed codex', undefined, false),
      cliAdapter('cursor-agent', 'managed cursor-agent', undefined, true),
    ]
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
    expect(Object.fromEntries(r.json.clis.map((cli: { id: string; headlessCapable: boolean }) => [cli.id, cli.headlessCapable]))).toEqual({
      claude: false,
      codex: false,
      'cursor-agent': true,
    })
  })

  test('warmCliCacheOnBoot probes every CLI once at boot so /clis shows models without a manual Test', async () => {
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
      warmCliCacheOnBoot: true,
    })

    // The warm-up is fired in the background after listen; poll until it lands.
    for (let i = 0; i < 100 && calls.preflight < 2; i += 1) await new Promise((r) => setTimeout(r, 2))
    expect(calls).toEqual({ preflight: 2, listModels: 2 })

    const r = await call(oz, 'GET', '/clis')
    expect(r.status).toBe(200)
    expect(r.json.clis.map((c: { id: string; tested: boolean; models: { canEnumerate: boolean } }) => [c.id, c.tested, c.models.canEnumerate]))
      .toEqual([['alpha', true, true], ['beta', true, true]])
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
      headlessCapable: false,
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

  test('POST /runs/:id/show prefers live Oscar after wrap so the founder can ask follow-up questions', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'oscar', sessionRef: 'surface:oscar' })
    store.createSession({ runId: run.id, persona: 'bob', sessionRef: 'surface:bob' })
    store.createSession({ runId: run.id, persona: 'deb', sessionRef: 'surface:deb' })
    store.setRunStatus(run.id, 'completed')
    await startServer()
    oz!.ctx.liveRefs.add('surface:oscar')
    oz!.ctx.liveRefs.add('surface:bob')
    oz!.ctx.liveRefs.add('surface:deb')

    const r = await call(oz!, 'POST', `/runs/${run.id}/show`)

    expect(r).toMatchObject({ status: 200, json: { sessionRef: 'surface:oscar', persona: 'oscar' } })
    expect(shown.map((s) => s.id)).toEqual(['surface:oscar'])
  })

  test('POST /runs/:id/support-commit commits post-wrap Oscar support edits with a run receipt', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'oscar', sessionRef: 'surface:oscar' })
    store.setRunStatus(run.id, 'completed')
    await startServer(fakeGit(['cocoder/priorities/demo.md', 'packages/stray.ts']))
    oz!.ctx.liveRefs.add('surface:oscar')

    const r = await call(oz!, 'POST', `/runs/${run.id}/support-commit`)

    expect(r).toMatchObject({
      status: 200,
      json: {
        ok: true,
        runId: run.id,
        commitSha: 'sha-committed',
        committedPaths: ['cocoder/priorities/demo.md', 'packages/stray.ts'],
        outOfLanePaths: ['packages/stray.ts'],
        liveOscar: true,
      },
    })
    expect(store.listCommitLinks(run.id)).toEqual([
      expect.objectContaining({
        commitSha: 'sha-committed',
        message: `oscar-post-wrap: demo via CoCoder run ${run.id}`,
        files: ['cocoder/priorities/demo.md', 'packages/stray.ts'],
      }),
    ])
    expect(store.listEvents(run.id).some((e) => e.type === 'post-wrap-support-commit')).toBe(true)
  })

  test('POST /runs/:id/support-commit allows the same wrapped run while Oscar remains live', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'oscar', sessionRef: 'surface:oscar' })
    store.setRunStatus(run.id, 'completed')
    await startServer(fakeGit(['cocoder/SESSION_LOG.md']))
    oz!.ctx.inFlight.set('cocoder', run.id)
    oz!.ctx.liveRefs.add('surface:oscar')

    const r = await call(oz!, 'POST', `/runs/${run.id}/support-commit`)

    expect(r).toMatchObject({
      status: 200,
      json: {
        ok: true,
        runId: run.id,
        commitSha: 'sha-committed',
        committedPaths: ['cocoder/SESSION_LOG.md'],
        liveOscar: true,
      },
    })
  })

  test('POST /oz/messages commit-support routes through the post-wrap support commit path', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(run.id, 'completed')
    await startServer(fakeGit(['cocoder/SESSION_LOG.md']))

    const r = await call(oz!, 'POST', '/oz/messages', { body: { text: `commit-support ${run.id}`, workspaceId: 'cocoder' } })

    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({
      ok: true,
      command: 'support-commit',
      action: {
        type: 'support-commit',
        runId: run.id,
        commitSha: 'sha-committed',
        committedPaths: ['cocoder/SESSION_LOG.md'],
      },
    })
    expect(String(r.json.reply)).toContain(`Committed post-wrap support edits for ${run.id}`)
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

  test('teardown closes the initiating persona last during self-teardown', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'oscar', sessionRef: 'surface:oscar' })
    store.createSession({ runId: run.id, persona: 'bob', sessionRef: 'surface:bob' })
    store.createSession({ runId: run.id, persona: 'deb', sessionRef: 'surface:deb' })
    await startServer()

    const r = await call(oz!, 'POST', `/runs/${run.id}/teardown`, { body: { initiatorPersona: 'oscar' } })

    expect(r.status).toBe(200)
    expect(killed.map((k) => k.id)).toEqual(['surface:bob', 'surface:deb', 'surface:oscar'])
    expect(store.listEvents(run.id).find((e) => e.type === 'teardown')?.data).toMatchObject({
      closed: ['surface:bob', 'surface:deb', 'surface:oscar'],
      failed: [],
      initiatorPersona: 'oscar',
    })
  })

  test('teardown closes a prior-instance final pane via durable workspaceRef (closeWorkspace, not kill)', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    // A session persisted WITH its workspaceRef (the durable data a prior daemon recorded).
    store.createSession({ runId: run.id, persona: 'deb', sessionRef: 'surface:deb', workspaceRef: 'workspace:9' })
    const closes: { workspaceRef: string; surfaceRef: string }[] = []
    const workspaceCloses: { workspaceRef: string }[] = []
    const killedHere: SessionRef[] = []
    // Fresh daemon (empty liveRefs, empty driver spawn-map) — the post-restart state.
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(undefined, (r) => killedHere.push(r), (a) => closes.push(a), (a) => workspaceCloses.push(a)),
      getAdapter: () => okAdapter,
      io: fakeIO(),
    })
    const r = await call(oz, 'POST', `/runs/${run.id}/teardown`)
    expect(r.status).toBe(200)
    expect(r.json.closed).toEqual(['surface:deb'])
    // Closed via the DURABLE workspace path (cross-instance), NOT kill() or last-surface closeSurface.
    expect(closes).toEqual([])
    expect(workspaceCloses).toEqual([{ workspaceRef: 'workspace:9' }])
    expect(killedHere).toEqual([])
  })

  test('teardown closes the shared run workspace for the final durable surface', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'oscar', sessionRef: 'surface:oscar', workspaceRef: 'workspace:run' })
    store.createSession({ runId: run.id, persona: 'bob', sessionRef: 'surface:bob', workspaceRef: 'workspace:run' })
    store.createSession({ runId: run.id, persona: 'deb', sessionRef: 'surface:deb', workspaceRef: 'workspace:run' })
    const closes: { workspaceRef: string; surfaceRef: string }[] = []
    const workspaceCloses: { workspaceRef: string }[] = []
    const receiverToken = Symbol('closeWorkspace receiver')
    const receiverSensitiveHost: SessionHost & { receiverToken: symbol } = {
      ...fakeHost(),
      receiverToken,
      async closeSurface(args) {
        closes.push(args)
        if (args.surfaceRef === 'surface:oscar') throw new Error('invalid_state: Cannot close the last surface')
      },
      closeWorkspace: async function (this: (SessionHost & { receiverToken?: symbol }) | undefined, args) {
        if (this?.receiverToken !== receiverToken) throw new Error("Cannot read properties of undefined (reading '#cli')")
        workspaceCloses.push(args)
      },
    }
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: receiverSensitiveHost,
      getAdapter: () => okAdapter,
      io: fakeIO(),
    })

    const r = await call(oz, 'POST', `/runs/${run.id}/teardown`, { body: { initiatorPersona: 'oscar' } })

    expect(r.status).toBe(200)
    expect(r.json).toEqual({ closed: ['surface:bob', 'surface:deb', 'surface:oscar'], failed: [] })
    expect(closes).toEqual([
      { workspaceRef: 'workspace:run', surfaceRef: 'surface:bob' },
      { workspaceRef: 'workspace:run', surfaceRef: 'surface:deb' },
    ])
    expect(workspaceCloses).toEqual([{ workspaceRef: 'workspace:run' }])
    expect(store.listEvents(run.id).find((e) => e.type === 'teardown')?.data).toMatchObject({
      closed: ['surface:bob', 'surface:deb', 'surface:oscar'],
      failed: [],
      initiatorPersona: 'oscar',
    })
  })

  test('teardown reports a durable still-open workspace as failed when closeWorkspace fails', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'deb', sessionRef: 'surface:deb', workspaceRef: 'workspace:9' })
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: { ...fakeHost(), async closeWorkspace() {
        throw new Error('cmux refused close')
      } },
      getAdapter: () => okAdapter,
      io: fakeIO(),
    })

    const r = await call(oz, 'POST', `/runs/${run.id}/teardown`)

    expect(r.status).toBe(500)
    expect(r.json.closed).toEqual([])
    expect(r.json.failed).toEqual([{ persona: 'deb', sessionRef: 'surface:deb', error: 'cmux refused close' }])
    expect(r.json.error).toMatch(/left 1 run session open/)
    expect(store.listEvents(run.id).find((e) => e.type === 'teardown')?.data).toEqual({
      closed: [],
      failed: [{ persona: 'deb', sessionRef: 'surface:deb', error: 'cmux refused close' }],
      initiatorPersona: null,
    })
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
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))
    const bad = await call(oz!, 'PUT', '/workspaces/cocoder/personas/assignments', { body: { personas: { bob: { cli: 'codex' } } } })
    expect(bad.status).toBe(400) // missing model
    const before = await readFile(join(home, 'cocoder', 'personas', 'assignments.json'), 'utf8')
    expect(before).toContain('"model"') // file untouched by the rejected write

    const ok = await call(oz!, 'PUT', '/workspaces/cocoder/personas/assignments', {
      body: { personas: { oscar: { cli: 'claude', model: 'opus', mode: 'headless' }, bob: { cli: 'codex', model: '' } } },
    })
    expect(ok.status).toBe(200)
    expect(ok.json.committedSha).toBe('sha-governance')
    expect(ok.json.assignments.oscar).toEqual({ cli: 'claude', model: 'opus', mode: 'headless' })
    const after = JSON.parse(await readFile(join(home, 'cocoder', 'personas', 'assignments.json'), 'utf8'))
    expect(after.personas.oscar.model).toBe('opus')
    expect(after.personas.oscar.mode).toBe('headless')
    expect(commits).toEqual([
      {
        cwd: home,
        files: ['cocoder/personas/assignments.json'],
        message: 'governance: update persona assignments (cocoder)',
        author: COCODER_GOVERNANCE,
      },
    ])
  })

  test('PUT assignments rejects an invalid persona mode without touching the file', async () => {
    await startServer()
    const before = await readFile(join(home, 'cocoder', 'personas', 'assignments.json'), 'utf8')

    const invalidMode = await call(oz!, 'PUT', '/workspaces/cocoder/personas/assignments', {
      body: { personas: { oscar: { cli: 'claude', model: 'opus', mode: 'pane' }, bob: { cli: 'codex', model: '' } } },
    })

    expect(invalidMode.status).toBe(400)
    expect(invalidMode.json.error).toMatch(/optional "mode" must be "visible" or "headless"/)
    expect(await readFile(join(home, 'cocoder', 'personas', 'assignments.json'), 'utf8')).toBe(before)
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
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))

    const post = await call(oz!, 'POST', '/workspaces/cocoder/priorities/reorder', { body: { order: ['later', 'missing', 'demo'] } })

    expect(post.status).toBe(200)
    expect(post.json).toEqual({ order: ['later', 'demo'], committedSha: 'sha-governance' })
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'priorities', 'order.json'), 'utf8'))).toEqual(['later', 'demo'])
    expect(commits).toEqual([
      {
        cwd: home,
        files: ['cocoder/priorities/order.json'],
        message: 'governance: reorder priorities (cocoder)',
        author: COCODER_GOVERNANCE,
      },
    ])

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

  test('POST /workspaces/:id/priorities creates a priority with a derived slug and GET returns it', async () => {
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))

    const post = await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { title: 'New Launch Priority', goal: '## Objective\nShip the create endpoint.' } })

    expect(post.status).toBe(201)
    expect(post.json.committedSha).toBe('sha-governance')
    expect(post.json.priority).toMatchObject({
      id: 'new-launch-priority',
      title: 'New Launch Priority',
      goal: '## Objective\nShip the create endpoint.',
      objective: 'Ship the create endpoint.',
      scopeNarrowing: null,
    })
    const parsed = loadPriority(join(home, 'cocoder', 'priorities'), 'new-launch-priority')
    expect(parsed.objective).toBe('Ship the create endpoint.')
    const file = await readFile(join(home, 'cocoder', 'priorities', 'new-launch-priority.md'), 'utf8')
    expect(file).toBe('---\nid: new-launch-priority\ntitle: New Launch Priority\n---\n## Objective\nShip the create endpoint.\n')
    expect(commits).toEqual([
      {
        cwd: home,
        files: ['cocoder/priorities/new-launch-priority.md'],
        message: 'governance: create priority new-launch-priority',
        author: COCODER_GOVERNANCE,
      },
    ])

    const get = await call(oz!, 'GET', '/workspaces/cocoder/priorities')
    expect(get.status).toBe(200)
    expect(get.json.priorities.map((p: any) => p.id)).toContain('new-launch-priority')
  })

  test('POST /workspaces/:id/priorities commits created priority files with the governance identity in a real repo', async () => {
    await initRepo(home)
    await startServer(makeGit())

    const post = await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { id: 'history-backed', title: 'History Backed' } })

    expect(post.status).toBe(201)
    expect(post.json.committedSha).toMatch(/^[0-9a-f]{40}$/)
    expect(await g(home, ['log', '-1', '--format=%an <%ae>'])).toBe('cocoder-governance <governance@cocoder.local>')
    expect(await g(home, ['log', '-1', '--format=%cn <%ce>'])).toBe('cocoder-governance <governance@cocoder.local>')
    expect(await g(home, ['cat-file', '-e', 'HEAD:cocoder/priorities/history-backed.md']).then(() => true, () => false)).toBe(true)
  })

  test('POST /workspaces/:id/priorities creates a priority with an explicit id and skeleton goal in a fresh priorities dir', async () => {
    await rm(join(home, 'cocoder', 'priorities'), { recursive: true, force: true })
    await startServer()

    const post = await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { id: 'explicit-id', title: 'Explicit priority' } })

    expect(post.status).toBe(201)
    expect(post.json.priority).toMatchObject({
      id: 'explicit-id',
      title: 'Explicit priority',
      goal: '## Objective',
      objective: null,
      scopeNarrowing: null,
    })
    expect(loadPriority(join(home, 'cocoder', 'priorities'), 'explicit-id').objective).toBeNull()
    expect(await readFile(join(home, 'cocoder', 'priorities', 'explicit-id.md'), 'utf8')).toBe('---\nid: explicit-id\ntitle: Explicit priority\n---\n## Objective\n')

    const get = await call(oz!, 'GET', '/workspaces/cocoder/priorities')
    expect(get.status).toBe(200)
    expect(get.json.priorities.map((p: any) => p.id)).toEqual(['explicit-id'])
  })

  test('POST /workspaces/:id/priorities rejects missing or empty titles, invalid ids, and oversized fields', async () => {
    await startServer()

    expect((await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: {} })).status).toBe(400)
    expect((await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { title: '   ' } })).status).toBe(400)
    expect((await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { title: 'x'.repeat(201) } })).status).toBe(400)
    expect((await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { title: 'Oversized goal', goal: 'x'.repeat(20_001) } })).status).toBe(400)
    for (const id of ['../x', 'A B', '.hidden', 'a'.repeat(65)]) {
      const r = await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { id, title: 'Bad id' } })
      expect(r.status).toBe(400)
    }
  })

  test('POST /workspaces/:id/priorities rejects frontmatter injection through title before creating a file', async () => {
    await startServer()
    const priorities = join(home, 'cocoder', 'priorities')
    const injectionFile = join(priorities, 'innocent-scope-narrowing-packages-core.md')

    const injected = await call(oz!, 'POST', '/workspaces/cocoder/priorities', {
      body: { title: 'Innocent\nscopeNarrowing: packages/core/**' },
    })
    expect(injected.status).toBe(400)
    expect(await exists(injectionFile)).toBe(false)

    for (const title of ['Carriage\rReturn', 'Tabbed\tTitle']) {
      const r = await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { title } })
      expect(r.status).toBe(400)
    }
  })

  test('POST /workspaces/:id/priorities returns 409 on duplicate ids including case-insensitive disk collisions', async () => {
    await writeFile(join(home, 'cocoder', 'priorities', 'Casey.md'), `---\nid: Casey\ntitle: Invalid but colliding\n---\ntext`)
    await startServer()

    const duplicate = await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { id: 'demo', title: 'Demo again' } })
    expect(duplicate.status).toBe(409)
    expect(duplicate.json.error).toContain('demo')

    const caseInsensitive = await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { id: 'casey', title: 'Case insensitive' } })
    expect(caseInsensitive.status).toBe(409)
    expect(caseInsensitive.json.error).toContain('casey')
  })

  test('POST /workspaces/:id/priorities returns 404 for an unknown workspace', async () => {
    await startServer()

    const r = await call(oz!, 'POST', '/workspaces/nope/priorities', { body: { title: 'No workspace' } })

    expect(r.status).toBe(404)
  })

  test('POST /workspaces/:id/priorities → 403 without a CSRF token (mutation gate)', async () => {
    await startServer()

    const r = await call(oz!, 'POST', '/workspaces/cocoder/priorities', { csrf: false, body: { title: 'Blocked' } })

    expect(r.status).toBe(403)
  })

  test('POST /workspaces/:id/tickets creates an open ticket, indexes it first, and commits both files', async () => {
    await writeTicketIndex(home)
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))

    const post = await call(oz!, 'POST', '/workspaces/cocoder/tickets', {
      body: {
        title: 'Fix Backend Ticket',
        type: 'bug',
        priority: 'oz-dashboard-bugs',
        description: '## Context\nBuild the ticket backend.',
      },
    })

    expect(post.status).toBe(201)
    expect(post.json.committedSha).toBe('sha-governance')
    expect(post.json.ticket).toMatchObject({
      id: '0013',
      title: 'Fix Backend Ticket',
      type: 'bug',
      status: 'Open',
      priority: 'oz-dashboard-bugs',
      owner: 'founder-session',
      state: 'open',
    })
    const ticketPath = join(home, 'cocoder', 'tickets', 'open', '0013-fix-backend-ticket.md')
    expect(await exists(ticketPath)).toBe(true)
    const parsed = await readTickets(join(home, 'cocoder', 'tickets'))
    expect(parsed.find((ticket) => ticket.id === '0013')).toMatchObject({ title: 'Fix Backend Ticket', type: 'bug', state: 'open' })
    const index = await readFile(join(home, 'cocoder', 'tickets', 'INDEX.md'), 'utf8')
    const row = '| [0013](./open/0013-fix-backend-ticket.md) | Fix Backend Ticket | bug | oz-dashboard-bugs | founder-session |'
    expect(index.match(/\| \[0013\]\(\.\/open\/0013-fix-backend-ticket\.md\) \|/g)?.length).toBe(1)
    expect(index.split('\n').slice(0, index.split('\n').indexOf('| [0003](./open/0003-existing-open.md) | Existing open | task | none | founder-session |'))).toContain(row)
    expect(index).toContain('| [0012](./closed/0012-existing-closed.md) | Existing closed | task | 2026-06-17 | Done |')
    expect(commits).toEqual([
      {
        cwd: home,
        files: ['cocoder/tickets/open/0013-fix-backend-ticket.md', 'cocoder/tickets/INDEX.md'],
        message: 'governance: create ticket 0013',
        author: COCODER_GOVERNANCE,
      },
    ])
  })

  test('POST /workspaces/:id/tickets rejects invalid ticket create bodies', async () => {
    await writeTicketIndex(home)
    await startServer()

    expect((await call(oz!, 'POST', '/workspaces/cocoder/tickets', { body: {} })).status).toBe(400)
    expect((await call(oz!, 'POST', '/workspaces/cocoder/tickets', { body: { title: '   ' } })).status).toBe(400)
    expect((await call(oz!, 'POST', '/workspaces/cocoder/tickets', { body: { title: 'Bad type', type: 'feature' } })).status).toBe(400)
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

  test('POST /oz/dashboard/launch → 403 without a CSRF token (mutation gate)', async () => {
    await startServer()
    const r = await call(oz!, 'POST', '/oz/dashboard/launch', { csrf: false })
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

  test('PUT /workspaces/:id rewrites folders, preserves raw paths and settings, and returns re-read roots', async () => {
    const file = await writeWorkspaceFile(home, 'cocoder', {
      folders: [{ path: '${COCODER_HOME}', role: 'primary' }],
      settings: { 'editor.tabSize': 2 },
    })
    await startServer()

    const folders = [
      { name: 'Dogfood', path: '${COCODER_HOME}', role: 'primary', description: 'install root' },
      { path: './support', role: 'readonly' },
    ]
    const r = await call(oz!, 'PUT', '/workspaces/cocoder', { body: { folders } })

    expect(r.status).toBe(200)
    expect(r.json.workspace).toMatchObject({ id: 'cocoder', name: 'cocoder', path: home })
    expect(r.json.workspace.roots).toEqual([
      { name: 'Dogfood', path: home, rawPath: '${COCODER_HOME}', role: 'primary', description: 'install root' },
      { name: 'support', path: join(home, 'local', 'workspace', 'support'), rawPath: './support', role: 'readonly' },
    ])
    const persisted = JSON.parse(await readFile(file, 'utf8'))
    expect(persisted).toEqual({ folders, settings: { 'editor.tabSize': 2 } })
  })

  test('PUT /workspaces/:id rejects invalid folders without touching the file', async () => {
    const file = await writeWorkspaceFile(home)
    await startServer()

    for (const body of [
      { folders: [{ path: '${COCODER_HOME}', role: 'admin' }] },
      { folders: [{ path: '${COCODER_HOME}', role: 'readonly' }] },
      { folders: [{ path: '${COCODER_HOME}', role: 'primary' }, { path: './other', role: 'primary' }] },
      { folders: [{ path: join(home, '..', 'external'), role: 'primary' }] },
      { folders: [{ path: '${COCODER_HOME}/nested', role: 'primary' }, { path: '${COCODER_HOME}', role: 'readonly' }] },
    ]) {
      const before = await readFile(file, 'utf8')
      const r = await call(oz!, 'PUT', '/workspaces/cocoder', { body })
      expect(r.status).toBe(400)
      expect(await readFile(file, 'utf8')).toBe(before)
    }
  })

  test('PUT /workspaces/:id returns 404 for an unknown workspace', async () => {
    await writeWorkspaceFile(home)
    await startServer()

    const r = await call(oz!, 'PUT', '/workspaces/nope', { body: { folders: [{ path: '${COCODER_HOME}', role: 'primary' }] } })

    expect(r.status).toBe(404)
  })

  test('PUT /workspaces/:id returns 409 for a legacy-sourced workspace', async () => {
    await startServer()

    const r = await call(oz!, 'PUT', '/workspaces/cocoder', { body: { folders: [{ path: '${COCODER_HOME}', role: 'primary' }] } })

    expect(r.status).toBe(409)
    expect(r.json.error).toBe('workspace must be migrated to local/workspace/cocoder.code-workspace first')
  })

  test('PUT /workspaces/:id → 403 without a CSRF token', async () => {
    const file = await writeWorkspaceFile(home)
    await startServer()
    const before = await readFile(file, 'utf8')

    const r = await call(oz!, 'PUT', '/workspaces/cocoder', { csrf: false, body: { folders: [{ path: '${COCODER_HOME}', role: 'primary' }] } })

    expect(r.status).toBe(403)
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  test('POST /workspaces creates a workspace file with raw paths and GET serves it', async () => {
    await startServer()
    const folders = [
      { name: 'Dogfood', path: '${COCODER_HOME}', role: 'primary' },
      { path: './docs', role: 'readonly' },
    ]

    const r = await call(oz!, 'POST', '/workspaces', { body: { id: 'new-workspace', folders } })

    expect(r.status).toBe(201)
    expect(r.json.legacyHidden).toEqual(['cocoder'])
    expect(r.json.workspace).toMatchObject({ id: 'new-workspace', name: 'new-workspace', path: home })
    expect(r.json.workspace.roots).toEqual([
      { name: 'Dogfood', path: home, rawPath: '${COCODER_HOME}', role: 'primary' },
      { name: 'docs', path: join(home, 'local', 'workspace', 'docs'), rawPath: './docs', role: 'readonly' },
    ])
    expect(JSON.parse(await readFile(join(home, 'local', 'workspace', 'new-workspace.code-workspace'), 'utf8'))).toEqual({ folders, settings: {} })
    const get = await call(oz!, 'GET', '/workspaces')
    expect(get.json.workspaces.map((workspace: any) => workspace.id)).toEqual(['new-workspace'])
  })

  test('POST /workspaces scaffolds launch-required governance in a fresh primary root', async () => {
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'cocoder-fresh-workspace-'))
    const folders = [
      { name: 'Product', path: workspaceRoot, role: 'primary' },
      { name: 'CoCoder', path: '${COCODER_HOME}', role: 'readonly' },
    ]

    const r = await call(oz!, 'POST', '/workspaces', { body: { id: 'fresh-product', folders } })

    expect(r.status).toBe(201)
    expect(r.json.governanceCommittedSha).toBe('sha-governance')
    expect(await readFile(join(workspaceRoot, 'cocoder', 'AGENTS.md'), 'utf8')).toContain("workspace's governance")
    const claudePointer = await readFile(join(workspaceRoot, 'cocoder', 'CLAUDE.md'), 'utf8')
    expect(claudePointer).toBe('Claude CLI sessions should read AGENTS.md in this same cocoder/ folder for repo instructions.\nKeep workspace-specific guidance there.\n')
    expect(claudePointer).not.toMatch(/CoBuilder|CoPublisher|dogfood/i)
    for (const file of expectedScaffoldFiles) {
      expect(await exists(join(workspaceRoot, file))).toBe(true)
    }
    expect(loadAssignments(join(workspaceRoot, 'cocoder', 'personas', 'assignments.json')).personas).toEqual(expectedScaffoldAssignments)
    expect(loadPriority(join(workspaceRoot, 'cocoder', 'priorities'), 'adhoc-session')).toMatchObject({
      id: 'adhoc-session',
      title: 'Session without a named priority',
    })
    const priorities = await call(oz!, 'GET', '/workspaces/fresh-product/priorities')
    expect(priorities.json.priorities.map((p: any) => p.id)).toEqual(['adhoc-session'])
    const personas = await call(oz!, 'GET', '/workspaces/fresh-product/personas')
    expect(personas.json.personas.map((p: any) => p.id)).not.toEqual(expect.arrayContaining(['AGENTS', 'CLAUDE']))
    expect(commits).toEqual([
      {
        cwd: workspaceRoot,
        files: expectedScaffoldFiles,
        message: 'governance: scaffold workspace governance (fresh-product)',
        author: COCODER_GOVERNANCE,
      },
    ])
  })

  test('POST /workspaces succeeds and audits governance commit failure for a non-git primary root', async () => {
    await startServer(makeGit())
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'cocoder-nongit-workspace-'))

    const r = await call(oz!, 'POST', '/workspaces', {
      body: {
        id: 'nongit-product',
        folders: [
          { path: workspaceRoot, role: 'primary' },
          { path: '${COCODER_HOME}', role: 'readonly' },
        ],
      },
    })

    expect(r.status).toBe(201)
    expect(r.json.governanceCommittedSha).toBeNull()
    expect(loadAssignments(join(workspaceRoot, 'cocoder', 'personas', 'assignments.json')).personas).toEqual(expectedScaffoldAssignments)
    const audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"governance-commit-failed"')
    expect(audit).toContain('"repoPath"')
    expect(audit).toContain('nongit-product')
  })

  test('base ad-hoc priority template parses and stays product-generic', async () => {
    const dir = basePrioritiesDir()
    const text = await readFile(join(dir, 'adhoc-session.md'), 'utf8')

    expect(loadPriority(dir, 'adhoc-session')).toMatchObject({
      id: 'adhoc-session',
      title: 'Session without a named priority',
    })
    expect(text).not.toMatch(/CoBuilder|CoCoder|dogfood/i)
  })

  test('POST /workspaces preserves pre-existing governance files byte-for-byte', async () => {
    await startServer()
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'cocoder-existing-governance-'))
    const personaDir = join(workspaceRoot, 'cocoder', 'personas')
    const priorityDir = join(workspaceRoot, 'cocoder', 'priorities')
    await mkdir(personaDir, { recursive: true })
    await mkdir(priorityDir, { recursive: true })
    const assignmentsPath = join(personaDir, 'assignments.json')
    const priorityPath = join(priorityDir, 'adhoc-session.md')
    const agentsPath = join(workspaceRoot, 'cocoder', 'AGENTS.md')
    const claudePath = join(workspaceRoot, 'cocoder', 'CLAUDE.md')
    const assignmentsBefore = '{"personas":{"oscar":{"cli":"claude","model":""},"bob":{"cli":"codex","model":""}}}\n'
    const priorityBefore = '---\nid: adhoc-session\ntitle: Session without a named priority\n---\n## Objective\nExisting brief.\n'
    const agentsBefore = '# Existing repo instructions\nKeep this exact.\n'
    const claudeBefore = 'Existing CLAUDE pointer.\n'
    await writeFile(assignmentsPath, assignmentsBefore)
    await writeFile(priorityPath, priorityBefore)
    await writeFile(agentsPath, agentsBefore)
    await writeFile(claudePath, claudeBefore)

    const r = await call(oz!, 'POST', '/workspaces', {
      body: {
        id: 'existing-governance',
        folders: [
          { path: workspaceRoot, role: 'primary' },
          { path: '${COCODER_HOME}', role: 'readonly' },
        ],
      },
    })

    expect(r.status).toBe(201)
    expect(await readFile(assignmentsPath, 'utf8')).toBe(assignmentsBefore)
    expect(await readFile(priorityPath, 'utf8')).toBe(priorityBefore)
    expect(await readFile(agentsPath, 'utf8')).toBe(agentsBefore)
    expect(await readFile(claudePath, 'utf8')).toBe(claudeBefore)
  })

  test('POST /workspaces rejects a nonexistent primary root before writing a workspace file', async () => {
    await startServer()
    const missingRoot = join(tmpdir(), `cocoder-missing-product-${process.pid}-${Date.now()}`)

    const r = await call(oz!, 'POST', '/workspaces', {
      body: {
        id: 'missing-product',
        folders: [
          { path: missingRoot, role: 'primary' },
          { path: '${COCODER_HOME}', role: 'readonly' },
        ],
      },
    })

    expect(r.status).toBe(400)
    expect(r.json.error).toContain(`primary root does not exist or is not a directory: ${missingRoot}`)
    expect(await exists(join(home, 'local', 'workspace', 'missing-product.code-workspace'))).toBe(false)
    expect(await exists(join(missingRoot, 'cocoder'))).toBe(false)
  })

  test('POST /workspaces scaffolds at a resolved env-var primary root', async () => {
    await startServer()
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'cocoder-env-workspace-'))
    const prior = process.env.COCODER_TEST_WORKSPACE_ROOT
    process.env.COCODER_TEST_WORKSPACE_ROOT = workspaceRoot
    try {
      const r = await call(oz!, 'POST', '/workspaces', {
        body: {
          id: 'env-workspace',
          folders: [
            { path: '${COCODER_TEST_WORKSPACE_ROOT}', role: 'primary' },
            { path: '${COCODER_HOME}', role: 'readonly' },
          ],
        },
      })

      expect(r.status).toBe(201)
      expect(r.json.workspace.path).toBe(workspaceRoot)
      expect(loadAssignments(join(workspaceRoot, 'cocoder', 'personas', 'assignments.json')).personas).toEqual(expectedScaffoldAssignments)
    } finally {
      if (prior === undefined) {
        delete process.env.COCODER_TEST_WORKSPACE_ROOT
      } else {
        process.env.COCODER_TEST_WORKSPACE_ROOT = prior
      }
    }
  })

  test('POST /workspaces returns 409 for an existing file including case-insensitive collisions', async () => {
    await writeWorkspaceFile(home, 'Casey')
    await startServer()

    const r = await call(oz!, 'POST', '/workspaces', { body: { id: 'casey', folders: [{ path: '${COCODER_HOME}', role: 'primary' }] } })

    expect(r.status).toBe(409)
    expect(r.json.error).toContain('casey')
  })

  test('POST /workspaces migrates a legacy id and reports other legacy ids hidden by directory mode', async () => {
    await writeFile(
      join(home, 'local', 'workspaces.json'),
      JSON.stringify({
        workspaces: [
          { id: 'cocoder', name: 'Legacy CoCoder', path: '${COCODER_HOME}' },
          { id: 'other', name: 'Other', path: '${COCODER_HOME}/other' },
        ],
      }),
    )
    await startServer()

    const r = await call(oz!, 'POST', '/workspaces', { body: { id: 'cocoder', folders: [{ name: 'Migrated', path: '${COCODER_HOME}', role: 'primary' }] } })

    expect(r.status).toBe(201)
    expect(r.json.legacyHidden).toEqual(['other'])
    expect(r.json.workspace).toMatchObject({ id: 'cocoder', name: 'cocoder', path: home })
    expect(r.json.workspace.roots).toEqual([{ name: 'Migrated', path: home, rawPath: '${COCODER_HOME}', role: 'primary' }])
    const get = await call(oz!, 'GET', '/workspaces')
    expect(get.json.workspaces.map((workspace: any) => workspace.id)).toEqual(['cocoder'])
  })

  test('POST /workspaces rejects bad ids and invalid roots', async () => {
    await startServer()

    expect((await call(oz!, 'POST', '/workspaces', { body: { id: '../x', folders: [{ path: '${COCODER_HOME}', role: 'primary' }] } })).status).toBe(400)
    expect((await call(oz!, 'POST', '/workspaces', { body: { id: 'bad-role', folders: [{ path: '${COCODER_HOME}', role: 'admin' }] } })).status).toBe(400)
    expect((await call(oz!, 'POST', '/workspaces', { body: { id: 'missing-root', folders: [{ path: join(home, '..', 'external'), role: 'primary' }] } })).status).toBe(400)
    expect(
      (await call(oz!, 'POST', '/workspaces', { body: { id: 'nested-primary', folders: [{ path: '${COCODER_HOME}/nested', role: 'primary' }, { path: '${COCODER_HOME}', role: 'readonly' }] } })).status,
    ).toBe(400)
  })

  test('POST /workspaces → 403 without a CSRF token', async () => {
    await startServer()

    const r = await call(oz!, 'POST', '/workspaces', { csrf: false, body: { id: 'blocked', folders: [{ path: '${COCODER_HOME}', role: 'primary' }] } })

    expect(r.status).toBe(403)
    expect(await exists(join(home, 'local', 'workspace', 'blocked.code-workspace'))).toBe(false)
  })

  test('DELETE /workspaces/:id removes a file-backed workspace and subsequent GET no longer serves it', async () => {
    const file = await writeWorkspaceFile(home, 'delete-me')
    await writeWorkspaceFile(home, 'keep-me')
    await startServer()

    const r = await call(oz!, 'DELETE', '/workspaces/delete-me')

    expect(r.status).toBe(200)
    expect(r.json).toEqual({ ok: true })
    expect(await exists(file)).toBe(false)
    const get = await call(oz!, 'GET', '/workspaces')
    expect(get.json.workspaces.map((workspace: any) => workspace.id)).toEqual(['keep-me'])
  })

  test('DELETE /workspaces/:id returns 404 for an unknown workspace', async () => {
    await writeWorkspaceFile(home)
    await startServer()

    const r = await call(oz!, 'DELETE', '/workspaces/nope')

    expect(r.status).toBe(404)
  })

  test('DELETE /workspaces/:id returns 409 for a legacy-sourced workspace', async () => {
    await startServer()

    const r = await call(oz!, 'DELETE', '/workspaces/cocoder')

    expect(r.status).toBe(409)
    expect(r.json.error).toBe('workspace must be migrated to local/workspace/cocoder.code-workspace first')
  })

  test('DELETE /workspaces/:id returns 409 while a run is in flight for that workspace', async () => {
    const file = await writeWorkspaceFile(home)
    await startServer()
    oz!.ctx.inFlight.set('cocoder', 'pending')

    const r = await call(oz!, 'DELETE', '/workspaces/cocoder')

    expect(r.status).toBe(409)
    expect(r.json.error).toBe('workspace has an active run')
    expect(await exists(file)).toBe(true)
  })

  test('DELETE /workspaces/:id resurrects legacy fallback when the last workspace file is removed', async () => {
    await writeWorkspaceFile(home, 'cocoder', { folders: [{ name: 'File-backed', path: '${COCODER_HOME}/file-backed', role: 'primary' }, { path: '${COCODER_HOME}', role: 'readonly' }], settings: {} })
    await startServer()

    const deleted = await call(oz!, 'DELETE', '/workspaces/cocoder')
    const get = await call(oz!, 'GET', '/workspaces')

    expect(deleted.status).toBe(200)
    expect(get.json.workspaces).toEqual([{ id: 'cocoder', name: 'CoCoder', path: home, roots: [{ name: 'CoCoder', path: home, rawPath: '${COCODER_HOME}', role: 'primary' }] }])
  })

  test('DELETE /workspaces/:id → 403 without a CSRF token', async () => {
    const file = await writeWorkspaceFile(home)
    await startServer()

    const r = await call(oz!, 'DELETE', '/workspaces/cocoder', { csrf: false })

    expect(r.status).toBe(403)
    expect(await exists(file)).toBe(true)
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

})
