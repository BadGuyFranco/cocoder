// Stage-4 mutations + run-lifecycle correctness: launch (202 / 409 in-flight), deep-link (200 / 409
// non-live, never 500), assignments write (validate + atomic), startup orphan reconciliation.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ClaudeAdapter, type Exec } from '@cocoder/adapters'
import { atomSentinel, composeTicketMarkdown, loadAssignments, loadPriority, makeGit, openRunStore, readTickets, StopRequestedError, workspaceTemplateDir, writePortableRun, type Adapter, type Git, type HeadlessRunInput, type RunnerIO, type RunStore, type SessionHost, type SessionRef } from '@cocoder/core'
import { createOzServer, OZ_CSRF_HEADER, type OzServer } from '../src/index.js'
import { migrateLegacyRunDirsOnce, runRetentionGcOnce, ticketPendingCloseRun } from '../src/launcher.js'
import type { OzContext } from '../src/context.js'
import { listQueuedAuthoring } from '../src/authoring-queue.js'
import { findOrphanedPriorities } from '../src/priority-order.js'
import { validFounderCloseout, validPriorityFounderCloseout, validTicketFounderCloseout } from './helpers/founder-closeout.js'

const exec = promisify(execFile)
const g = (cwd: string, args: string[]): Promise<string> => exec('git', ['-C', cwd, ...args]).then((r) => r.stdout.trim())
const COCODER_GOVERNANCE = { name: 'cocoder-governance', email: 'governance@cocoder.local' } as const
const STORE_RUN_CRITICAL_SCOPE = 'packages/core/src/store/**'

const okAdapter: Adapter = {
  id: 'any',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
  headlessCapable: false,
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
}
const claudeExecOk: Exec = async (command, args) => {
  const key = [command, ...args].join(' ')
  if (key === 'claude --version') return { code: 0, stdout: '2.1.156', stderr: '' }
  if (key === 'claude auth status') return { code: 0, stdout: '{"loggedIn": true}', stderr: '' }
  return { code: 0, stdout: 'OK\n', stderr: '' }
}
interface CliAdapterCalls {
  preflight: number
  listModels: number
}
const cliAdapter = (id: string, detail: string, calls?: CliAdapterCalls, headlessCapable = false, failingModels: readonly string[] = []): Adapter => ({
  id,
  runReadiness: { mechanism: 'launch-flags', flags: [`--${id}`], managesUserConfig: false, detail },
  headlessCapable,
  build: () => ({ command: id, args: [] }),
  preflight: async (model) => {
    if (calls) calls.preflight += 1
    const modelDetail = model ? `validated --model ${model}` : `(${id} default)`
    const modelOk = model === '' || !failingModels.includes(model)
    return {
      ok: modelOk,
      checks: [
        { name: 'installed', ok: true, detail: `${id} installed` },
        { name: 'authenticated', ok: true, detail: `${id} authenticated` },
        { name: 'model', ok: modelOk, detail: modelOk ? modelDetail : `--model ${model} failed (code 1): model ${model} not available` },
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
  'cocoder/counters.json',
  'cocoder/decisions/README.md',
  'cocoder/glossary.md',
  'cocoder/memory/AGENTS.md',
  'cocoder/memory/codebase-map.md',
  'cocoder/memory/design-spec.md',
  'cocoder/memory/tech-stack.md',
  'cocoder/personas/assignments.json',
  'cocoder/personas/custom/.gitkeep',
  'cocoder/priorities/.gitkeep',
  'cocoder/priorities/adhoc-session.md',
  'cocoder/standards/AGENTS.md',
  'cocoder/tickets/INDEX.md',
  'cocoder/workspace.json',
]
const fakeGit = (changed: string[] = [], shas: readonly string[] = ['h0']): Git => {
  let headCalls = 0
  return {
    async isGitRepo() {
      return true
    },
    async initRepo() {},
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
    // ADR-0023 §4 worktree methods — no-ops for the daemon's fake-git launch path.
    async worktreeAdd() {},
    async worktreeRemove() {},
    async listWorktrees() {
      return []
    },
    async currentBranch() {
      return 'trunk'
    },
    async resetHard() {},
    async hasUpstream() {
      return false
    },
    async push() {
      return { ok: true, detail: '' }
    },
    async commitsSince() {
      return []
    },
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
const fakeGitChangedSequence = (changedByCall: readonly (readonly string[])[]): Git => {
  let changedCalls = 0
  return {
    ...fakeGit(),
    async changedFiles() {
      const files = changedByCall[Math.min(changedCalls, changedByCall.length - 1)] ?? []
      changedCalls += 1
      return [...files]
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
function callRaw(oz: OzServer, method: string, path: string, body: string): Promise<Resp> {
  const headers: Record<string, string> = { authorization: `Bearer ${oz.token}`, [OZ_CSRF_HEADER]: oz.csrfToken, 'content-type': 'application/json' }
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: oz.port, path, method, headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }))
    })
    req.on('error', reject)
    req.end(body)
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
async function readAuditEventually(home: string, expected: string): Promise<string> {
  const auditPath = join(home, 'local', 'oz-audit.log')
  let audit = ''
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    try {
      audit = await readFile(auditPath, 'utf8')
      if (audit.includes(expected)) return audit
    } catch {
      // appendAudit writes fire-and-forget; the audit file may not exist on the first poll.
    }
    await sleep(10)
  }
  return audit
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
  async writeDebTerminalSnapshot() {},
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

function committedAtomThenControlledWrapIO(): { readonly io: RunnerIO; release(): void } {
  let releaseAll: (() => void) | null = null
  let directiveCalls = 0
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
        directiveCalls += 1
        if (directiveCalls === 1) return { kind: 'delegate' as const, task: 'touch daemon runtime' }
        await released
        return { kind: 'wrapup' as const, pickup: 'nothing further this run' }
      },
    },
    release() {
      releaseAll?.()
    },
  }
}

function oneAtomThenWrapIO(): RunnerIO {
  let directiveCalls = 0
  return {
    ...fakeIO(),
    async ensureRunDir(runDir) {
      await mkdir(runDir, { recursive: true })
    },
    async awaitDirective() {
      directiveCalls += 1
      return directiveCalls === 1
        ? { kind: 'delegate' as const, task: 'touch daemon runtime' }
        : { kind: 'wrapup' as const, pickup: 'done' }
    },
  }
}

function delayedBobHeadless(): { readonly runHeadless: (input: HeadlessRunInput) => Promise<{ readonly exitCode: number; readonly output: string }>; release(): void } {
  let releaseBob: (() => void) | null = null
  const bobReleased = new Promise<void>((resolve) => {
    releaseBob = resolve
  })
  return {
    async runHeadless(input) {
      if (input.outPath.includes('bob-turn')) {
        await bobReleased
        const output = `implemented daemon atom\n${atomSentinel(0)}`
        input.onData?.(output)
        return { exitCode: 0, output }
      }
      return { exitCode: 0, output: validFounderCloseout() }
    },
    release() {
      releaseBob?.()
    },
  }
}

const queuedCommitGit = (calls: GovernanceCommitCall[], shas: readonly string[] = ['sha-queued']): Git => ({
  ...fakeGit(),
  async addAndCommit(cwd, files, message, author) {
    const sha = shas[Math.min(calls.length, shas.length - 1)] ?? 'sha-queued'
    calls.push({ cwd, files: [...files], message, author })
    return sha
  },
  async commitsSince() {
    return [...shas]
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

async function enableDebRepairFixture(home: string): Promise<void> {
  await mkdir(join(home, 'cocoder', 'personas', 'deltas'), { recursive: true })
  await writeFile(
    join(home, 'cocoder', 'personas', 'assignments.json'),
    JSON.stringify({ personas: { oscar: { cli: 'claude', model: '' }, bob: { cli: 'codex', model: '' }, deb: { cli: 'codex', model: '', enabled: true } } }),
  )
  await writeFile(join(home, 'cocoder', 'personas', 'deltas', 'deb.md'), '---\nid: deb\nwriteScope:\n  - packages/**\n---\n')
}

function appliedDebRepairOutput(): string {
  return JSON.stringify({
    schemaVersion: 1,
    dialogueId: 'repair-placeholder',
    kind: 'applied',
    disposition: 'cocoder-bug',
    mode: 'repair',
    summary: 'Applied route repair.',
    diagnosis: 'Route was missing.',
    whyCocoderOwned: 'Daemon route wiring is CoCoder-owned.',
    filesChanged: ['packages/daemon/src/routes.ts'],
    verification: 'mutation test',
    remainingRisk: 'none',
  })
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

async function writeResumeState(home: string, runId: string, state: unknown): Promise<void> {
  const runDir = join(home, 'local', 'runs', runId)
  await mkdir(runDir, { recursive: true })
  await writeFile(join(runDir, 'resume-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function runDirCandidates(home: string, runId: string): readonly string[] {
  return [join(home, 'local', 'runs', 'cocoder', runId), join(home, 'local', 'runs', runId)]
}

function askFounderResumeState(home: string, runId: string): unknown {
  const runDir = join(home, 'local', 'runs', runId)
  return {
    park: 'pre-dispatch',
    atomNumber: 0,
    founderResolution: {
      kind: 'ask-founder-continue',
      question: 'Should this stay enabled by default?',
      askedAtDirectivePath: join(runDir, 'directive-0.json'),
      nextDirectivePath: join(runDir, 'directive-1.json'),
    },
  }
}

async function initRepo(path: string): Promise<void> {
  await g(path, ['init', '-q', '-b', 'trunk'])
  await g(path, ['config', 'user.email', 't@t.test'])
  await g(path, ['config', 'user.name', 'Test'])
  await g(path, ['add', '-A'])
  await g(path, ['commit', '-q', '-m', 'init'])
}

async function listFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(root, path)
    return entry.isFile() ? [path.slice(root.length + 1)] : []
  }))
  return files.flat().sort()
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

async function createExternalWorkspace(id: string): Promise<string> {
  const workspacePath = await mkdtemp(join(tmpdir(), `cocoder-${id}-workspace-`))
  await mkdir(join(workspacePath, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(workspacePath, 'cocoder', 'personas'), { recursive: true })
  await writeFile(join(workspacePath, 'cocoder', 'priorities', 'demo.md'), `---\nid: demo\ntitle: Demo\n---\n## Objective\nDo the thing.`)
  await writeFile(join(workspacePath, 'cocoder', 'personas', 'oscar.md'), `---\nid: oscar\nlabel: Orchestrator\nrole: orchestrator\nwriteScope: []\n---\nOscar`)
  await writeFile(join(workspacePath, 'cocoder', 'personas', 'bob.md'), `---\nid: bob\nlabel: Builder\nrole: builder\nwriteScope:\n  - packages/**\n---\nBob`)
  await writeFile(
    join(workspacePath, 'cocoder', 'personas', 'assignments.json'),
    JSON.stringify({ personas: { oscar: { cli: 'claude', model: '' }, bob: { cli: 'codex', model: '' } } }),
  )
  return workspacePath
}

async function writeWorkspacesRegistry(home: string, workspaces: ReadonlyArray<{ readonly id: string; readonly name?: string; readonly path: string }>): Promise<void> {
  await writeFile(
    join(home, 'local', 'workspaces.json'),
    JSON.stringify({
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name ?? workspace.id,
        path: workspace.path === home ? '${COCODER_HOME}' : workspace.path,
      })),
    }),
  )
}

async function setBobHeadless(home: string): Promise<void> {
  await writeFile(
    join(home, 'cocoder', 'personas', 'assignments.json'),
    JSON.stringify({ personas: { oscar: { cli: 'claude', model: '' }, bob: { cli: 'codex', model: '', mode: 'headless' } } }),
  )
}

const headlessBobOk = async (input: HeadlessRunInput): Promise<{ readonly exitCode: number; readonly output: string }> => {
  if (input.outPath.includes('bob-turn')) {
    const output = `implemented daemon atom\n${atomSentinel(0)}`
    input.onData?.(output)
    return { exitCode: 0, output }
  }
  return { exitCode: 0, output: validFounderCloseout() }
}

function recordArchiveConfirmationAction(store: RunStore, runId: string, priorityId = 'demo'): void {
  store.recordEvent({
    runId,
    type: 'wrap-disposition',
    data: {
      disposition: 'archive-confirmation',
      buildAtoms: 1,
      signal: null,
      action: { type: 'archive-priority-confirmation', runId, priorityId, endpoint: `/runs/${runId}/archive-confirmation`, method: 'POST', confirmWith: 'archive' },
    },
  })
}

function recordTicketCloseDecision(store: RunStore, runId: string, ticketCloseDecision: 'ask' | 'close' | 'none'): void {
  store.recordEvent({
    runId,
    type: 'wrap-disposition',
    data: {
      disposition: ticketCloseDecision === 'ask' ? 'awaiting-founder' : 'continue',
      buildAtoms: 1,
      signal: null,
      ticketCloseDecision,
    },
  })
}

describe('Oz mutations + lifecycle', () => {
  let home: string
  let store: RunStore
  let oz: OzServer | undefined
  let shown: SessionRef[]
  let killed: SessionRef[]

  const startServer = async (
    git: Git = fakeGit(),
    runHeadless: (input: HeadlessRunInput) => Promise<{ readonly exitCode: number; readonly output: string }> = async () => ({ exitCode: 0, output: validFounderCloseout() }),
    io: RunnerIO = fakeIO(),
    runnerTimeouts?: OzServer['ctx']['runnerTimeouts'],
    independentRunLauncher?: OzServer['ctx']['independentRunLauncher'],
  ): Promise<OzServer> => {
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
      io,
      runHeadless, // headless wrap-up/authoring Play: don't shell out in tests
      ...(runnerTimeouts !== undefined ? { runnerTimeouts } : {}),
      ...(independentRunLauncher !== undefined ? { independentRunLauncher } : {}),
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

  test('fresh workspace default Claude assignment launches without --model, while a pinned model is passed', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'cocoder-fresh-launch-'))
    const spawned: Array<Parameters<SessionHost['spawn']>[0]> = []
    let surface = 0
    const baseHost = fakeHost()
    const sessionHost: SessionHost = {
      ...baseHost,
      async spawn(opts) {
        spawned.push(opts)
        return { id: `surface:${++surface}`, driver: 'fake' }
      },
    }
    const claude = new ClaudeAdapter(claudeExecOk)
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost,
      getAdapter: (cli) => cli === 'claude' ? claude : okAdapter,
      io: fakeIO(),
      runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
    })
    const workspace = await call(oz, 'POST', '/workspaces', {
      body: {
        id: 'fresh-product',
        folders: [
          { path: workspaceRoot, role: 'primary' },
          { path: '${COCODER_HOME}', role: 'readonly' },
        ],
      },
    })
    expect(workspace.status).toBe(201)
    expect(loadAssignments(join(workspaceRoot, 'cocoder', 'personas', 'assignments.json')).personas.oscar?.model).toBe('')

    const defaultLaunch = await call(oz, 'POST', '/runs', { body: { workspaceId: 'fresh-product', priorityId: 'adhoc-session', task: 'First run smoke' } })
    expect(defaultLaunch.status).toBe(202)
    for (let i = 0; i < 50 && spawned.length === 0; i++) await sleep(10)
    const defaultOscar = spawned.find((spawn) => spawn.persona === 'oscar')
    expect(defaultOscar?.command).toBe('claude')
    expect(defaultOscar?.args).not.toContain('--model')

    for (let i = 0; i < 50 && oz.ctx.inFlight.has('fresh-product'); i++) await sleep(10)
    const assignmentsPath = join(workspaceRoot, 'cocoder', 'personas', 'assignments.json')
    const assignments = loadAssignments(assignmentsPath)
    await writeFile(
      assignmentsPath,
      `${JSON.stringify({ personas: { ...assignments.personas, oscar: { ...assignments.personas.oscar!, model: 'sonnet' } } }, null, 2)}\n`,
    )
    spawned.length = 0

    const pinnedLaunch = await call(oz, 'POST', '/runs', { body: { workspaceId: 'fresh-product', priorityId: 'adhoc-session', task: 'Pinned model smoke' } })
    expect(pinnedLaunch.status).toBe(202)
    for (let i = 0; i < 50 && spawned.length === 0; i++) await sleep(10)
    const pinnedOscar = spawned.find((spawn) => spawn.persona === 'oscar')
    expect(pinnedOscar?.command).toBe('claude')
    expect(pinnedOscar?.args).toEqual(expect.arrayContaining(['--model', 'sonnet']))
  })

  test('POST /runs launches with a real runId when the priority Objective is missing', async () => {
    // Regression: a priority whose heading is annotated (e.g. "## Objective (DRAFT …)") parses to a null
    // objective. The daemon once returned 202 with runId:null, which navigated the dashboard to #/run/null.
    // The runner now starts the priority with Required Questions, so the daemon must return a real run id.
    await writeFile(
      join(home, 'cocoder', 'priorities', 'draft.md'),
      `---\nid: draft\ntitle: Draft\n---\n## Objective (DRAFT — founder confirms at launch)\nDo the thing.`,
    )
    await startServer()
    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'draft' } })
    expect(r.status).toBe(202)
    expect(r.json.runId).toMatch(/^run_/)
    expect(r.json.runId).not.toBeNull()
    expect(store.listRuns()).toHaveLength(1)
    expect(store.getRun(r.json.runId)?.priorityId).toBe('draft')
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
      runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
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
      for (
        let i = 0;
        i < 50 && (!store.listEvents(aRunId).some((event) => event.type === 'run-start') || !store.listEvents(bRunId).some((event) => event.type === 'run-start'));
        i++
      ) {
        await sleep(10)
      }
      expect(store.listEvents(aRunId).map((event) => event.type)).toContain('run-start')
      expect(store.listEvents(bRunId).map((event) => event.type)).toContain('run-start')
      expect(join(home, 'local', 'runs', 'cocoder', aRunId)).not.toBe(join(home, 'local', 'runs', 'external', bRunId))

      controlled.release()
      for (let i = 0; i < 50 && (oz.ctx.inFlight.has('cocoder') || oz.ctx.inFlight.has('external')); i++) {
        await sleep(10)
      }

      expect(store.getRun(aRunId)?.status).toBe('completed')
      expect(store.getRun(bRunId)?.status).toBe('completed')
      expect(oz.ctx.inFlight.has('cocoder')).toBe(false)
      expect(oz.ctx.inFlight.has('external')).toBe(false)
      expect(await exists(join(home, 'local', 'runs', 'cocoder', aRunId))).toBe(true)
      expect(await exists(join(home, 'local', 'runs', 'external', bRunId))).toBe(true)

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

  test('POST /runs enforces the default global concurrency ceiling of three for new workspaces', async () => {
    const alphaPath = await createExternalWorkspace('alpha')
    const betaPath = await createExternalWorkspace('beta')
    const gammaPath = await createExternalWorkspace('gamma')
    await writeWorkspacesRegistry(home, [
      { id: 'cocoder', name: 'CoCoder', path: home },
      { id: 'alpha', path: alphaPath },
      { id: 'beta', path: betaPath },
      { id: 'gamma', path: gammaPath },
    ])
    await startServer()
    oz!.ctx.inFlight.set('cocoder', 'run_a')
    oz!.ctx.inFlight.set('alpha', 'run_b')
    oz!.ctx.inFlight.set('beta', 'run_c')

    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'gamma', priorityId: 'demo' } })

    expect(r.status).toBe(409)
    expect(r.json).toMatchObject({
      code: 'global-run-ceiling',
      activeRuns: 3,
      ceiling: 3,
      error: 'refusing to launch: 3 runs already in flight (ceiling 3) — wait for one to finish or raise the ceiling',
    })
    expect(oz!.ctx.inFlight.has('gamma')).toBe(false)
  })

  test('POST /runs admits a new workspace below a configured ceiling', async () => {
    const alphaPath = await createExternalWorkspace('alpha')
    const betaPath = await createExternalWorkspace('beta')
    await writeWorkspacesRegistry(home, [
      { id: 'cocoder', name: 'CoCoder', path: home },
      { id: 'alpha', path: alphaPath },
      { id: 'beta', path: betaPath },
    ])
    await writeFile(join(home, 'local', 'settings.json'), JSON.stringify({ maxConcurrentRuns: 3 }))
    const controlled = controlledDirectiveIO()
    await startServer(fakeGit(), async () => ({ exitCode: 0, output: validFounderCloseout() }), controlled.io)
    oz!.ctx.inFlight.set('cocoder', 'run_a')
    oz!.ctx.inFlight.set('alpha', 'run_b')

    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'beta', priorityId: 'demo' } })

    expect(r.status).toBe(202)
    expect(r.json.runId).toMatch(/^run_/)
    expect(oz!.ctx.inFlight.get('beta')).toBe(r.json.runId)
    controlled.release()
  })

  test('POST /runs keeps the per-workspace guard precedence when already at the global ceiling', async () => {
    await writeFile(join(home, 'local', 'settings.json'), JSON.stringify({ maxConcurrentRuns: 1 }))
    await startServer()
    oz!.ctx.inFlight.set('cocoder', 'run_busy')

    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })

    expect(r.status).toBe(409)
    expect(r.json).toMatchObject({ code: 'workspace-in-flight', runId: 'run_busy' })
    expect(r.json.error).toBe('a run is already in flight for workspace "cocoder"')
  })

  test('daemon-touching commits reload only after the run is idle', async () => {
    await setBobHeadless(home)
    await writeFile(join(home, 'cocoder', 'priorities', 'daemon-work.md'), `---\nid: daemon-work\ntitle: Daemon Work\nscopeNarrowing:\n  - packages/**\n---\n## Objective\nDo the thing.`)
    const controlled = committedAtomThenControlledWrapIO()
    let restarts = 0
    let builds = 0
    const buildObservedInFlight: number[] = []
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGitChangedSequence([[], ['packages/daemon/src/routes.ts'], []]),
      sessionHost: fakeHost(),
      getAdapter: () => okAdapter,
      io: controlled.io,
      runHeadless: async (input) => {
        if (input.outPath.includes('bob-turn')) return headlessBobOk(input)
        return { exitCode: 0, output: validTicketFounderCloseout() }
      },
      buildDaemonForReload: async () => {
        builds += 1
        buildObservedInFlight.push(oz!.ctx.inFlight.size)
        return { exitCode: 0, output: 'daemon typecheck ok' }
      },
      restartDaemon: () => {
        restarts += 1
      },
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'daemon-work', allowSelfImpacting: true } })
    expect(r.status).toBe(202)
    const runId = r.json.runId as string
    for (let i = 0; i < 50 && !store.listEvents(runId).some((event) => event.type === 'commit' && ((event.data as { files?: string[] } | null)?.files ?? []).includes('packages/daemon/src/routes.ts')); i++) {
      await sleep(10)
    }

    expect(oz.ctx.inFlight.get('cocoder')).toBe(runId)
    expect(builds).toBe(0)
    expect(restarts).toBe(0)

    controlled.release()
    for (let i = 0; i < 50 && restarts === 0; i++) await sleep(10)

    expect(builds).toBe(1)
    expect(buildObservedInFlight).toEqual([0])
    expect(restarts).toBe(1)
    expect(oz.ctx.inFlight.has('cocoder')).toBe(false)
    const types = store.listEvents(runId).map((event) => event.type)
    expect(types).toEqual(expect.arrayContaining([
      'daemon-auto-reload-pending',
      'daemon-auto-reload-build-started',
      'daemon-auto-reload-build-succeeded',
      'daemon-auto-reload-restart-queued',
    ]))
  })

  test('daemon reload build failure is surfaced and does not restart the daemon', async () => {
    await setBobHeadless(home)
    await writeFile(join(home, 'cocoder', 'priorities', 'daemon-work.md'), `---\nid: daemon-work\ntitle: Daemon Work\nscopeNarrowing:\n  - packages/**\n---\n## Objective\nDo the thing.`)
    const controlled = committedAtomThenControlledWrapIO()
    let restarts = 0
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGitChangedSequence([[], ['packages/core/src/runner/runner.ts'], []]),
      sessionHost: fakeHost(),
      getAdapter: () => okAdapter,
      io: controlled.io,
      runHeadless: headlessBobOk,
      buildDaemonForReload: async () => ({ exitCode: 2, output: 'daemon typecheck failed' }),
      restartDaemon: () => {
        restarts += 1
      },
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'daemon-work', allowSelfImpacting: true } })
    expect(r.status).toBe(202)
    const runId = r.json.runId as string
    controlled.release()
    let event = store.listEvents(runId).find((item) => item.type === 'daemon-auto-reload-build-failed')
    for (let i = 0; i < 50 && !event; i++) {
      await sleep(10)
      event = store.listEvents(runId).find((item) => item.type === 'daemon-auto-reload-build-failed')
    }

    expect(restarts).toBe(0)
    expect(event?.data).toMatchObject({ command: 'pnpm --filter @cocoder/core --filter @cocoder/daemon typecheck', exitCode: 2, output: 'daemon typecheck failed', files: ['packages/core/src/runner/runner.ts'] })
  })

  test('POST /runs rejects invalid targets before creating a run', async () => {
    await startServer()

    const playbookOnly = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', playbookId: 'drift-audit' } })
    const priorityAndTicket = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo', ticketId: '0003' } })
    const neither = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder' } })

    expect(playbookOnly).toEqual({ status: 400, json: { error: 'exactly one of priorityId or ticketId is required' } })
    expect(priorityAndTicket).toEqual({ status: 400, json: { error: 'exactly one of priorityId or ticketId is required' } })
    expect(neither).toEqual({ status: 400, json: { error: 'exactly one of priorityId or ticketId is required' } })
    expect(store.listRuns()).toEqual([])
  })

  test('POST /runs leaves a ticket open when a ticket-fix run produces no verified commit', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
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
      runHeadless: async () => ({ exitCode: 0, output: validTicketFounderCloseout() }),
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
    expect(await exists(join(ticketDir, 'open', '0003-existing-open.md'))).toBe(true)
    const closedPath = join(ticketDir, 'closed', '0003-existing-open.md')
    expect(await exists(closedPath)).toBe(false)
    const loaded = (await readTickets(ticketDir)).find((ticket) => ticket.id === '0003')
    expect(loaded).toMatchObject({ id: '0003', state: 'open', status: 'Open' })

    const index = await readFile(join(ticketDir, 'INDEX.md'), 'utf8')
    const openSection = index.slice(index.indexOf('## Open'), index.indexOf('## Recently Closed'))
    const closedSection = index.slice(index.indexOf('## Recently Closed'))
    expect(openSection).toContain('0003')
    expect(closedSection).not.toContain('| [0003](./closed/0003-existing-open.md) | Existing open | task |')
    expect(JSON.parse(await readFile(join(ticketDir, 'order.json'), 'utf8'))).toEqual(['0003', '0004'])
    expect(commits).not.toContainEqual(expect.objectContaining({ message: `governance: close ticket 0003 via run ${runId}` }))
    const audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"ticket-close-skipped"')
    expect(audit).toContain('"ticketId":"0003"')
    expect(audit).toContain('"reason":"missing-verified-commit"')
  })

  test('POST /runs leaves a ticket open when wrap-up asks the founder before closing', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    const commits: GovernanceCommitCall[] = []
    const decision = 'Yes — close ticket `0003` only after the founder confirms this fix is complete.'
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: recordingGovernanceGit(commits),
      sessionHost: fakeHost(),
      getAdapter: () => okAdapter,
      io: fakeIO(),
      runHeadless: async () => ({ exitCode: 0, output: validTicketFounderCloseout('needs closing', decision) }),
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', ticketId: '0003' } })

    expect(r.status).toBe(202)
    const runId = String(r.json.runId)
    let detail: Resp | null = null
    for (let i = 0; i < 50; i++) {
      detail = await call(oz, 'GET', `/runs/${runId}`)
      if (detail.json.run.status !== 'running') break
      await sleep(10)
    }

    const ticketDir = join(home, 'cocoder', 'tickets')
    expect(detail?.json.run).toMatchObject({ id: runId, ticketId: '0003', status: 'awaiting-founder' })
    expect(await exists(join(ticketDir, 'open', '0003-existing-open.md'))).toBe(true)
    expect(await exists(join(ticketDir, 'closed', '0003-existing-open.md'))).toBe(false)
    expect((await readTickets(ticketDir)).find((ticket) => ticket.id === '0003')).toMatchObject({ id: '0003', state: 'open', status: 'Open' })
    const index = await readFile(join(ticketDir, 'INDEX.md'), 'utf8')
    const openSection = index.slice(index.indexOf('## Open'), index.indexOf('## Recently Closed'))
    expect(openSection).toContain('| [0003](./open/0003-existing-open.md) | Existing open | task |')
    expect(JSON.parse(await readFile(join(ticketDir, 'order.json'), 'utf8'))).toEqual(['0003', '0004'])
    expect(commits).not.toContainEqual(expect.objectContaining({ message: expect.stringContaining('close ticket 0003') }))
    const delivery = await readFile(join(home, 'local', 'runs', 'cocoder', runId, 'wrapup-delivery.md'), 'utf8')
    expect(delivery).toContain(decision)
    const audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"ticket-close-deferred"')
    expect(audit).toContain('"reason":"wrap requested founder close decision"')
  })

  test('POST /runs/:id/ticket-close-confirmation closes an awaiting ticket run through the governed spine', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0003' })
    store.recordCommitLink({ runId: run.id, commitSha: 'sha-build', message: 'atom 0', files: ['packages/core/src/tickets/create.ts'] })
    recordTicketCloseDecision(store, run.id, 'ask')
    store.setRunStatus(run.id, 'awaiting-founder')
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))

    const detailBefore = await call(oz!, 'GET', `/runs/${run.id}`)
    const close = await call(oz!, 'POST', `/runs/${run.id}/ticket-close-confirmation`, { body: {} })
    const detailAfter = await call(oz!, 'GET', `/runs/${run.id}`)

    expect(detailBefore.json.actions).toEqual([{ type: 'ticket-close-confirmation', method: 'POST', endpoint: `/runs/${run.id}/ticket-close-confirmation`, confirmWith: 'close' }])
    expect(close).toMatchObject({ status: 200, json: { ok: true, closed: true, runId: run.id, ticketId: '0003', commitSha: 'sha-governance' } })
    expect(detailAfter.json.run).toMatchObject({ id: run.id, status: 'completed' })
    const ticketDir = join(home, 'cocoder', 'tickets')
    expect(await exists(join(ticketDir, 'open', '0003-existing-open.md'))).toBe(false)
    expect(await exists(join(ticketDir, 'closed', '0003-existing-open.md'))).toBe(true)
    expect(JSON.parse(await readFile(join(ticketDir, 'order.json'), 'utf8'))).toEqual(['0004'])
    expect(commits).toContainEqual(expect.objectContaining({
      cwd: home,
      files: ['cocoder/tickets/closed/0003-existing-open.md', 'cocoder/tickets/open/0003-existing-open.md', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'],
      message: 'governance: founder-confirmation close ticket 0003',
      author: COCODER_GOVERNANCE,
    }))
    expect(store.listEvents(run.id).some((event) => event.type === 'ticket-close-confirmation-closed')).toBe(true)
  })

  test('ticket 0079: ticket-close confirmation wait survives orchestrationMs until requestTicketCloseConfirmation', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    await setBobHeadless(home)
    const decision = 'Yes — close ticket `0003` only after the founder confirms this fix is complete.'
    const commits: GovernanceCommitCall[] = []
    const git: Git = {
      ...fakeGitChangedSequence([[], ['packages/ticket-fix.ts']]),
      async addAndCommit(cwd, files, message, author) {
        commits.push({ cwd, files: [...files], message, author })
        return message.startsWith('governance:') ? 'sha-governance' : 'sha-build'
      },
    }
    await startServer(
      git,
      async (input) => {
        if (input.outPath.includes('bob-turn')) {
          const output = `fixed ticket\n${atomSentinel(0)}`
          input.onData?.(output)
          return { exitCode: 0, output }
        }
        return { exitCode: 0, output: validTicketFounderCloseout('needs closing', decision) }
      },
      oneAtomThenWrapIO(),
      { orchestrationMs: 1, buildMs: 1_000, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
    )

    const launched = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', ticketId: '0003' } })
    expect(launched.status).toBe(202)
    const runId = String(launched.json.runId)
    for (let i = 0; i < 50 && store.getRun(runId)?.status === 'running'; i++) await sleep(10)
    await sleep(10)

    expect(store.getRun(runId)?.status).toBe('awaiting-founder')
    const parkedEvents = store.listEvents(runId)
    expect(parkedEvents.find((event) => event.type === 'run-end')?.data).toMatchObject({ status: 'awaiting-founder' })
    expect(parkedEvents.some((event) => event.type === 'directive-timeout')).toBe(false)
    expect(parkedEvents.some((event) => event.type === 'fault-triaged')).toBe(false)
    const detailBefore = await call(oz!, 'GET', `/runs/${runId}`)
    expect(detailBefore.json.actions).toEqual([{ type: 'ticket-close-confirmation', method: 'POST', endpoint: `/runs/${runId}/ticket-close-confirmation`, confirmWith: 'close' }])

    const close = await call(oz!, 'POST', `/runs/${runId}/ticket-close-confirmation`, { body: {} })

    expect(close).toMatchObject({ status: 200, json: { ok: true, closed: true, runId, ticketId: '0003', commitSha: 'sha-governance' } })
    expect(store.getRun(runId)?.status).toBe('completed')
    expect(store.listEvents(runId).some((event) => event.type === 'ticket-close-confirmation-closed')).toBe(true)
    expect(store.listEvents(runId).some((event) => event.type === 'directive-timeout')).toBe(false)
    expect(commits).toContainEqual(expect.objectContaining({ message: 'governance: founder-confirmation close ticket 0003' }))
  })

  test('POST /runs/:id/ticket-close-confirmation refuses an unrelated founder decision', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0003' })
    recordTicketCloseDecision(store, run.id, 'none')
    store.setRunStatus(run.id, 'awaiting-founder')
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))

    const detailBefore = await call(oz!, 'GET', `/runs/${run.id}`)
    const close = await call(oz!, 'POST', `/runs/${run.id}/ticket-close-confirmation`, { body: {} })

    expect(detailBefore.json.actions).toEqual([])
    expect(close).toMatchObject({ status: 409, json: { ok: false, closed: false, reason: 'not-awaiting-ticket-close-confirmation', runId: run.id } })
    expect(await exists(join(home, 'cocoder', 'tickets', 'open', '0003-existing-open.md'))).toBe(true)
    expect(await exists(join(home, 'cocoder', 'tickets', 'closed', '0003-existing-open.md'))).toBe(false)
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0003', '0004'])
    expect(commits).toEqual([])
    expect(store.getRun(run.id)?.status).toBe('awaiting-founder')
  })

  test('POST /runs/:id/ticket-close-confirmation recovers a stranded needs-closing wrap recorded as none', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0003' })
    recordTicketCloseDecision(store, run.id, 'none')
    store.setRunStatus(run.id, 'awaiting-founder')
    const runDir = join(home, 'local', 'runs', 'cocoder', run.id)
    await mkdir(runDir, { recursive: true })
    await writeFile(
      join(runDir, 'pickup.md'),
      validTicketFounderCloseout('Run Status: needs closing', 'Yes — close ticket `0003` after the founder confirms this fix is complete.'),
    )
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))

    const close = await call(oz!, 'POST', `/runs/${run.id}/ticket-close-confirmation`, { body: {} })

    expect(close).toMatchObject({ status: 200, json: { ok: true, closed: true, runId: run.id, ticketId: '0003', commitSha: 'sha-governance' } })
    expect(await exists(join(home, 'cocoder', 'tickets', 'open', '0003-existing-open.md'))).toBe(false)
    expect(await exists(join(home, 'cocoder', 'tickets', 'closed', '0003-existing-open.md'))).toBe(true)
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0004'])
    expect(store.listEvents(run.id).filter((event) => event.type === 'wrap-disposition').at(-1)?.data).toMatchObject({
      ticketCloseDecision: 'ask',
      recoveredFrom: 'pickup.md',
    })
    expect(commits).toContainEqual(expect.objectContaining({ message: 'governance: founder-confirmation close ticket 0003' }))
  })

  test('POST /workspaces/:id/tickets/:ticketId/close refuses while the latest ticket run awaits founder input', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0003' })
    store.setRunStatus(run.id, 'awaiting-founder')
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))

    const close = await call(oz!, 'POST', '/workspaces/cocoder/tickets/0003/close', { body: { resolution: 'Reconciled too early.' } })

    expect(close).toMatchObject({ status: 409, json: { ok: false, closed: false, reason: 'awaiting-founder-decision', runId: run.id } })
    const ticketDir = join(home, 'cocoder', 'tickets')
    expect(await exists(join(ticketDir, 'open', '0003-existing-open.md'))).toBe(true)
    expect(await exists(join(ticketDir, 'closed', '0003-existing-open.md'))).toBe(false)
    const index = await readFile(join(ticketDir, 'INDEX.md'), 'utf8')
    const openSection = index.slice(index.indexOf('## Open'), index.indexOf('## Recently Closed'))
    const closedSection = index.slice(index.indexOf('## Recently Closed'))
    expect(openSection).toContain('| [0003](./open/0003-existing-open.md) | Existing open | task | none | founder-session |')
    expect(closedSection).not.toContain('| [0003](./closed/0003-existing-open.md) |')
    expect(JSON.parse(await readFile(join(ticketDir, 'order.json'), 'utf8'))).toEqual(['0003', '0004'])
    expect(commits).toEqual([])
  })

  test('POST /runs/:id/ticket-close-confirmation refuses while the owning run is still active', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003'], null, 2)}\n`)
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0003' })
    await startServer(recordingGovernanceGit([]))
    oz!.ctx.inFlight.set('cocoder', run.id)

    const close = await call(oz!, 'POST', `/runs/${run.id}/ticket-close-confirmation`, { body: {} })

    expect(close.status).toBe(409)
    expect(String(close.json.error)).toContain('still active')
    expect(await exists(join(home, 'cocoder', 'tickets', 'open', '0003-existing-open.md'))).toBe(true)
  })

  test('built-pending-close ticket is marked in the queue and cannot be relaunched as fresh work', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0003' })
    store.recordCommitLink({ runId: run.id, commitSha: 'sha-build', message: 'atom 0', files: ['packages/core/src/tickets/create.ts'] })
    recordTicketCloseDecision(store, run.id, 'ask')
    store.setRunStatus(run.id, 'awaiting-founder')
    await startServer()

    const tickets = await call(oz!, 'GET', '/workspaces/cocoder/tickets')
    const relaunch = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', ticketId: '0003' } })

    expect(tickets.status).toBe(200)
    expect(tickets.json.tickets[0]).toMatchObject({ id: '0003', state: 'open', pendingCloseRunId: run.id })
    expect(relaunch.status).toBe(409)
    expect(String(relaunch.json.error)).toContain(`run ${run.id} awaiting founder close confirmation`)
  })

  test('a stale awaiting-founder run the founder has moved past does NOT block relaunch of its ticket', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    // An old run for 0003 wrapped awaiting-founder and was never finalized (the universal resting state)...
    const stale = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0003' })
    store.setRunStatus(stale.id, 'awaiting-founder')
    // ...but the founder has since moved on to other work, so it is no longer the workspace tip.
    const newer = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0004' })
    store.setRunStatus(newer.id, 'completed')
    await startServer()

    const tickets = await call(oz!, 'GET', '/workspaces/cocoder/tickets')

    expect(tickets.status).toBe(200)
    // 0003 is no longer flagged pending-close — the stale run is not the current tip, so relaunch is allowed.
    expect(tickets.json.tickets.find((t: { id: string }) => t.id === '0003').pendingCloseRunId).toBeUndefined()
    expect(ticketPendingCloseRun(oz!.ctx, 'cocoder', '0003')).toBeNull()
  })

  test('tearing down an awaiting-founder run finalizes it to terminal (so it stops blocking relaunch)', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    await startServer()
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0003' })
    recordTicketCloseDecision(store, run.id, 'ask')
    store.setRunStatus(run.id, 'awaiting-founder')

    const teardown = await call(oz!, 'POST', `/runs/${run.id}/teardown`, { body: {} })

    expect(teardown.status).toBe(200)
    expect(store.getRun(run.id)?.status).toBe('completed')
    expect(store.listEvents(run.id).some((e) => e.type === 'run-finalized')).toBe(true)
  })

  test('reconciliation close finalizes the owning awaiting-founder run', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const held = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0003' })
    store.setRunStatus(held.id, 'held')
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0003' })
    recordTicketCloseDecision(store, run.id, 'ask')
    store.setRunStatus(run.id, 'awaiting-founder')
    await startServer(recordingGovernanceGit([]))

    const close = await call(oz!, 'POST', `/runs/${run.id}/ticket-close-confirmation`, { body: {} })

    expect(close.status).toBe(200)
    expect(store.getRun(run.id)?.status).toBe('completed')
    expect(store.getRun(held.id)?.status).toBe('held')
    expect(store.listEvents(run.id).some((e) => e.type === 'run-finalized')).toBe(true)
    expect(store.listEvents(held.id).some((e) => e.type === 'run-finalized')).toBe(false)
  })

  test('POST /runs does not close a completed ticket run that needs another run', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    const commits: GovernanceCommitCall[] = []
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: recordingGovernanceGit(commits),
      sessionHost: fakeHost(),
      getAdapter: () => okAdapter,
      io: fakeIO(),
      runHeadless: async () => ({ exitCode: 0, output: validTicketFounderCloseout('needs another run') }),
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', ticketId: '0003' } })

    expect(r.status).toBe(202)
    const runId = String(r.json.runId)
    let detail: Resp | null = null
    for (let i = 0; i < 50; i++) {
      detail = await call(oz, 'GET', `/runs/${runId}`)
      if (detail.json.run.status !== 'running') break
      await sleep(10)
    }

    const ticketDir = join(home, 'cocoder', 'tickets')
    expect(detail?.json.run).toMatchObject({ id: runId, ticketId: '0003', status: 'completed' })
    expect(await exists(join(ticketDir, 'open', '0003-existing-open.md'))).toBe(true)
    expect(await exists(join(ticketDir, 'closed', '0003-existing-open.md'))).toBe(false)
    expect((await readTickets(ticketDir)).find((ticket) => ticket.id === '0003')).toMatchObject({ id: '0003', state: 'open', status: 'Open' })
    expect(JSON.parse(await readFile(join(ticketDir, 'order.json'), 'utf8'))).toEqual(['0003', '0004'])
    expect(commits).not.toContainEqual(expect.objectContaining({ message: expect.stringContaining('close ticket 0003') }))
  })

  test('POST /runs reconciles stale ticket order when the ticket is already closed before completion', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    const commits: GovernanceCommitCall[] = []
    const controlled = controlledDirectiveIO()
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: recordingGovernanceGit(commits),
      sessionHost: fakeHost(),
      getAdapter: () => okAdapter,
      io: controlled.io,
      runHeadless: async () => ({ exitCode: 0, output: validTicketFounderCloseout('closed', 'None.', 'Priority: `demo` — continue the remaining priority atoms') }),
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', ticketId: '0003' } })

    expect(r.status).toBe(202)
    const runId = String(r.json.runId)
    for (let i = 0; i < 50 && store.getRun(runId)?.status !== 'running'; i++) {
      await sleep(10)
    }
    expect(store.getRun(runId)?.status).toBe('running')

    const ticketDir = join(home, 'cocoder', 'tickets')
    const openPath = join(ticketDir, 'open', '0003-existing-open.md')
    const closedPath = join(ticketDir, 'closed', '0003-existing-open.md')
    const markdown = await readFile(openPath, 'utf8')
    await rm(openPath)
    await writeFile(closedPath, markdown.replace('status: Open', 'status: Closed'))

    controlled.release()
    let detail: Resp | null = null
    for (let i = 0; i < 50; i++) {
      detail = await call(oz, 'GET', `/runs/${runId}`)
      if (detail.json.run.status !== 'running') break
      await sleep(10)
    }

    expect(detail?.json.run).toMatchObject({ id: runId, ticketId: '0003', status: 'completed' })
    expect(JSON.parse(await readFile(join(ticketDir, 'order.json'), 'utf8'))).toEqual(['0004'])
    expect(commits).toContainEqual(expect.objectContaining({
      cwd: home,
      files: ['cocoder/tickets/order.json'],
      message: `governance: reconcile stale ticket 0003 order entry via run ${runId}`,
      author: COCODER_GOVERNANCE,
    }))
    const audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"ticket-order-reconciled"')
    expect(audit).toContain('"reason":"already-closed"')
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
      runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
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
      runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
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

  test('POST /runs/:id/resume resumes a held run through the same run id', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const held = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(held.id, 'held')
    await writeResumeState(home, held.id, { park: 'pre-dispatch', atomNumber: 0 })
    await startServer()

    const r = await call(oz!, 'POST', `/runs/${held.id}/resume`)

    expect(r).toEqual({ status: 202, json: { resuming: true, runId: held.id } })
    expect(store.listRuns({ workspaceId: 'cocoder' }).map((run) => run.id)).toEqual([held.id])
    for (let i = 0; i < 50 && store.getRun(held.id)?.status !== 'completed'; i++) await sleep(10)
    expect(store.getRun(held.id)?.status).toBe('completed')
    expect(store.listRuns({ workspaceId: 'cocoder' }).map((run) => run.id)).toEqual([held.id])
    const events = store.listEvents(held.id)
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['launch-run-resume', 'run-resumed', 'run-end']))
    expect(events.find((event) => event.type === 'run-resumed')?.data).toEqual({ park: 'pre-dispatch', atom: 0 })
    for (let i = 0; i < 50 && !(await exists(join(home, 'local', 'oz-audit.log'))); i++) await sleep(10)
    const audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"resume"')
    expect(audit).toContain(`"runId":"${held.id}"`)
  })

  test('POST /runs/:id/founder-answer records the answer and resumes with it', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const held = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(held.id, 'held')
    await writeResumeState(home, held.id, askFounderResumeState(home, held.id))
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
      runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
    })

    const r = await call(oz, 'POST', `/runs/${held.id}/founder-answer`, { body: { answer: '  Keep it enabled by default.  ' } })

    expect(r).toEqual({ status: 202, json: { resuming: true, runId: held.id } })
    for (let i = 0; i < 50 && !prompts.some((prompt) => prompt.includes('# Resuming after founder decision')); i++) await sleep(10)
    const prompt = prompts.find((text) => text.includes('# Resuming after founder decision'))
    expect(prompt).toContain('Should this stay enabled by default?')
    expect(prompt).toContain('Keep it enabled by default.')
    const answerPath = join(home, 'local', 'runs', 'cocoder', held.id, 'founder-answer.json')
    const answer = JSON.parse(await readFile(answerPath, 'utf8'))
    expect(answer).toMatchObject({
      kind: 'founder-answer',
      runId: held.id,
      question: 'Should this stay enabled by default?',
      answer: 'Keep it enabled by default.',
      nextDirectivePath: join(home, 'local', 'runs', held.id, 'directive-1.json'),
    })
    expect(store.listEvents(held.id).map((event) => event.type)).toEqual(expect.arrayContaining(['founder-answer-recorded', 'launch-run-resume']))
    const audit = await readAuditEventually(home, '"action":"founder-answer"')
    expect(audit).toContain(`"runId":"${held.id}"`)
  })

  test('POST /runs/:id/founder-answer rejects stale, non-marker, and blank answers without relaunching', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const completed = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(completed.id, 'completed')
    await writeResumeState(home, completed.id, askFounderResumeState(home, completed.id))
    const heldWithoutMarker = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(heldWithoutMarker.id, 'held')
    await writeResumeState(home, heldWithoutMarker.id, { park: 'pre-dispatch', atomNumber: 0 })
    const blank = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(blank.id, 'held')
    await writeResumeState(home, blank.id, askFounderResumeState(home, blank.id))
    await startServer()

    const stale = await call(oz!, 'POST', `/runs/${completed.id}/founder-answer`, { body: { answer: 'keep it enabled' } })
    const missingMarker = await call(oz!, 'POST', `/runs/${heldWithoutMarker.id}/founder-answer`, { body: { answer: 'keep it enabled' } })
    const empty = await call(oz!, 'POST', `/runs/${blank.id}/founder-answer`, { body: { answer: '   ' } })

    expect(stale.status).toBe(409)
    expect(stale.json.code).toBe('founder-answer-not-held')
    expect(missingMarker.status).toBe(409)
    expect(missingMarker.json.code).toBe('founder-answer-not-awaited')
    expect(empty).toEqual({ status: 400, json: { error: 'founder answer is required' } })
    for (const runId of [completed.id, heldWithoutMarker.id, blank.id]) {
      for (const runDir of runDirCandidates(home, runId)) {
        expect(await exists(join(runDir, 'founder-answer.json'))).toBe(false)
      }
      expect(store.listEvents(runId).map((event) => event.type)).not.toContain('launch-run-resume')
    }
  })

  test('POST /runs/:id/resume rejects unknown, non-held, and workspace-busy runs', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const running = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    const completed = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(completed.id, 'completed')
    const stopped = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(stopped.id, 'stopped')
    const held = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(held.id, 'held')
    await writeResumeState(home, held.id, { park: 'pre-dispatch', atomNumber: 0 })
    await startServer()

    expect((await call(oz!, 'POST', '/runs/nope/resume')).status).toBe(404)
    expect((await call(oz!, 'POST', `/runs/${running.id}/resume`)).status).toBe(409)
    expect((await call(oz!, 'POST', `/runs/${completed.id}/resume`)).status).toBe(409)
    expect((await call(oz!, 'POST', `/runs/${stopped.id}/resume`)).status).toBe(409)

    oz!.ctx.inFlight.set('cocoder', running.id)
    const busy = await call(oz!, 'POST', `/runs/${held.id}/resume`)
    expect(busy.status).toBe(409)
    expect(busy.json).toEqual({
      error: 'a run is already in flight for workspace "cocoder"',
      code: 'workspace-in-flight',
      runId: running.id,
    })
    expect(store.getRun(held.id)?.status).toBe('held')
  })

  test('POST /runs --resume reads a prior run pickup (200/202); a missing pickup is a 400', async () => {
    await startServer()
    // Resuming a run with no pickup brief fails cleanly (400, not a 500) and releases the reservation.
    const bad = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo', resumeFromRunId: 'run_missing' } })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toMatch(/cannot resume/)

    // A prior run left a pickup brief on disk (the continuation artifact; F8) → resume launches.
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const prior = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(prior.id, 'held')
    await mkdir(join(home, 'local', 'runs', prior.id), { recursive: true })
    await writeFile(join(home, 'local', 'runs', prior.id, 'pickup.md'), '# Pickup\nstart at the parser')
    const ok = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo', resumeFromRunId: prior.id } })
    expect(ok.status).toBe(202)
    expect(ok.json.runId).toMatch(/^run_/)
    expect(ok.json.runId).not.toBe(prior.id)
    expect(store.getRun(prior.id)?.status).toBe('held')
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
      runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
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
      runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
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

  test('POST /runs refuses a priority whose scope touches runner machinery before spawning', async () => {
    await writeFile(
      join(home, 'cocoder', 'priorities', 'runner-touch.md'),
      `---\nid: runner-touch\ntitle: Runner Touch\nscopeNarrowing:\n  - ${STORE_RUN_CRITICAL_SCOPE}\n---\n## Objective\nDo the thing.`,
    )
    let spawns = 0
    const baseHost = fakeHost()
    const sessionHost: SessionHost = {
      ...baseHost,
      async spawn(opts) {
        spawns += 1
        return baseHost.spawn(opts)
      },
    }
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit([], ['same-sha']),
      sessionHost,
      getAdapter: () => okAdapter,
      io: fakeIO(),
      runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'runner-touch' } })

    expect(r.status).toBe(409)
    expect(r.json).toMatchObject({ code: 'self-impacting-priority', runnerImpact: true, override: 'allowSelfImpacting' })
    expect(r.json.reasons).toEqual([
      `scopeNarrowing "${STORE_RUN_CRITICAL_SCOPE}" intersects run-critical machinery "${STORE_RUN_CRITICAL_SCOPE}"`,
    ])
    expect(String(r.json.recommendation)).toContain('runnerless path')
    expect(String(r.json.recommendation)).toContain('independent-of-runner: true')
    expect(store.listRuns()).toHaveLength(0)
    expect(oz.ctx.inFlight.has('cocoder')).toBe(false)
    expect(spawns).toBe(0)
    const audit = await readAuditEventually(home, '"disposition":"refused-impacting"')
    expect(audit).toContain('"action":"launch-runner-impact"')
    expect(audit).toContain('"priorityId":"runner-touch"')
  })

  test('POST /runs refuses an independent-of-runner priority from the normal runner', async () => {
    await writeFile(
      join(home, 'cocoder', 'priorities', 'runnerless.md'),
      `---\nid: runnerless\ntitle: Runnerless\nindependent-of-runner: true\n---\n## Objective\nDo the thing.`,
    )
    let spawns = 0
    const baseHost = fakeHost()
    const sessionHost: SessionHost = {
      ...baseHost,
      async spawn(opts) {
        spawns += 1
        return baseHost.spawn(opts)
      },
    }
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit([], ['same-sha']),
      sessionHost,
      getAdapter: () => okAdapter,
      io: fakeIO(),
      runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
    })

    const r = await call(oz, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'runnerless' } })

    expect(r.status).toBe(409)
    expect(r.json).toMatchObject({ code: 'independent-of-runner-required', independentOfRunner: true })
    expect(String(r.json.error)).toContain('runnerless path')
    expect(store.listRuns()).toHaveLength(0)
    expect(oz.ctx.inFlight.has('cocoder')).toBe(false)
    expect(spawns).toBe(0)
    const audit = await readAuditEventually(home, '"disposition":"refused-independent"')
    expect(audit).toContain('"action":"launch-runner-impact"')
    expect(audit).toContain('"priorityId":"runnerless"')
  })

  test('POST /runs/independent-handoff writes a durable runnerless handoff without creating a daemon run', async () => {
    await writeFile(
      join(home, 'cocoder', 'priorities', 'runnerless.md'),
      `---\nid: runnerless\ntitle: Runnerless\nindependent-of-runner: true\n---\n## Objective\nDo the runnerless thing.`,
    )
    await startServer(fakeGit([], ['same-sha']))
    oz!.ctx.inFlight.set('cocoder', 'run_active')

    const r = await call(oz!, 'POST', '/runs/independent-handoff', { body: { workspaceId: 'cocoder', priorityId: 'runnerless' } })

    expect(r.status).toBe(202)
    expect(r.json).toMatchObject({ ok: true, runnerless: true, workspaceId: 'cocoder', priorityId: 'runnerless' })
    expect(String(r.json.command)).toContain('cocoder run-independent runnerless')
    expect(String(r.json.handoffPath)).toMatch(/^local\/runnerless-handoffs\/cocoder\/.*runnerless\.md$/)
    const handoff = await readFile(join(home, String(r.json.handoffPath)), 'utf8')
    expect(handoff).toContain('Runnerless handoff: Runnerless')
    expect(handoff).toContain('cocoder run-independent runnerless')
    expect(handoff).toContain('Do the runnerless thing.')
    expect(store.listRuns()).toHaveLength(0)
    expect(oz!.ctx.inFlight.get('cocoder')).toBe('run_active')
    const audit = await readAuditEventually(home, '"action":"runnerless-handoff"')
    expect(audit).toContain('"priorityId":"runnerless"')
  })

  test('POST /runs/independent-launch starts a detached runnerless CLI without creating a daemon run', async () => {
    await writeFile(
      join(home, 'cocoder', 'priorities', 'runnerless.md'),
      `---\nid: runnerless\ntitle: Runnerless\nindependent-of-runner: true\ndestructive: true\n---\n## Objective\nDo the runnerless thing.`,
    )
    const launches: Array<{ command: string; args: readonly string[]; cwd: string }> = []
    await startServer(fakeGit([], ['same-sha']), undefined, undefined, undefined, {
      spawn(input) {
        launches.push(input)
        return {
          pid: 4321,
          on: () => undefined,
          unref: () => undefined,
        }
      },
    })
    oz!.ctx.inFlight.set('cocoder', 'run_active')

    const r = await call(oz!, 'POST', '/runs/independent-launch', { body: { workspaceId: 'cocoder', priorityId: 'runnerless' } })

    expect(r.status).toBe(202)
    expect(r.json).toMatchObject({ ok: true, runnerless: true, launched: true, workspaceId: 'cocoder', priorityId: 'runnerless', pid: 4321 })
    expect(String(r.json.command)).toContain('cocoder run-independent runnerless')
    expect(launches).toHaveLength(1)
    expect(launches[0]).toMatchObject({ command: process.execPath, cwd: home })
    expect(launches[0]!.args).toEqual([join(home, 'packages', 'cli', 'bin', 'cocoder.mjs'), 'run-independent', 'runnerless'])
    expect(store.listRuns()).toHaveLength(0)
    expect(oz!.ctx.inFlight.get('cocoder')).toBe('run_active')
    const audit = await readAuditEventually(home, '"action":"runnerless-launch"')
    expect(audit).toContain('"priorityId":"runnerless"')
  })

  test('POST /runs allowSelfImpacting proceeds while recording the runner-impact alert', async () => {
    await writeFile(
      join(home, 'cocoder', 'priorities', 'runner-touch.md'),
      `---\nid: runner-touch\ntitle: Runner Touch\nscopeNarrowing:\n  - ${STORE_RUN_CRITICAL_SCOPE}\n---\n## Objective\nDo the thing.`,
    )
    await startServer(fakeGit([], ['same-sha']))

    const r = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'runner-touch', allowSelfImpacting: true } })

    expect(r.status).toBe(202)
    expect(r.json.runId).toMatch(/^run_/)
    expect(store.listEvents(String(r.json.runId)).map((event) => event.type)).toContain('launch-self-impact-override')
    const audit = await readAuditEventually(home, '"disposition":"override-impacting"')
    expect(audit).toContain('"action":"launch-runner-impact"')
    expect(audit).toContain('"priorityId":"runner-touch"')
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
        model: { ok: false, detail: 'not yet tested' },
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
        model: { ok: false, detail: 'not yet tested' },
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
      model: { ok: true, detail: '(alpha default)' },
      models: { canEnumerate: true, models: ['alpha-model-a', 'alpha-model-b'], detail: 'alpha model list' },
      configManaged: adapters[0]!.runReadiness,
      headlessCapable: false,
    })
    expect(tested.json.cli.testedAt).toEqual(expect.any(Number))

    const cached = await call(oz, 'GET', '/clis')
    expect(cached.status).toBe(200)
    expect(cached.json.clis[0]).toEqual(tested.json.cli)
  })

  test('POST /clis/:id/test validates non-default configured models for that CLI', async () => {
    await writeFile(
      join(home, 'cocoder', 'personas', 'assignments.json'),
      JSON.stringify({ personas: { oscar: { cli: 'claude', model: 'opus' }, bob: { cli: 'codex', model: '' } } }),
    )
    const calls: CliAdapterCalls = { preflight: 0, listModels: 0 }
    const adapters = [cliAdapter('claude', 'managed claude', calls, false, ['opus'])]
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

    const tested = await call(oz, 'POST', '/clis/claude/test')

    expect(tested.status).toBe(200)
    expect(calls).toEqual({ preflight: 2, listModels: 1 })
    expect(tested.json.cli.auth).toEqual({ ok: true, detail: 'claude authenticated' })
    expect(tested.json.cli.install).toEqual({ ok: true, detail: 'claude installed' })
    expect(tested.json.cli.model).toEqual({ ok: false, detail: '--model opus failed (code 1): model opus not available' })
    expect(tested.json.cli.tested).toBe(true)
    expect(tested.json.cli.models.models).toEqual(['claude-model-a', 'claude-model-b'])
    expect(tested.json.cli.auth.ok).toBe(true)
    const cached = await call(oz, 'GET', '/clis')
    expect(cached.json.clis[0].tested).toBe(true)
    expect(cached.json.clis[0].auth.ok).toBe(true)
    expect(cached.json.clis[0].model.ok).toBe(false)
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
    expect(r.json).toEqual({
      error: 'a run is already in flight for workspace "cocoder"',
      code: 'workspace-in-flight',
      runId: 'run_existing',
    })
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

  test('POST /runs/:id/support-commit commits support edits and flags out-of-lane files (0053)', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'oscar', sessionRef: 'surface:oscar' })
    store.setRunStatus(run.id, 'completed')
    await writePortableRun(home, {
      run: { id: run.id, displayNumber: 1 },
      workspace: { id: 'cocoder' },
      target: { kind: 'priority' },
      priorityId: 'demo',
      playbookId: null,
      ticketId: null,
      status: 'completed',
      createdAt: run.createdAt,
      endedAt: run.endedAt,
    })
    await startServer(fakeGit(['cocoder/priorities/demo.md', 'packages/stray.ts']))
    oz!.ctx.liveRefs.add('surface:oscar')

    const r = await call(oz!, 'POST', `/runs/${run.id}/support-commit`)

    // Option B: post-wrap support commits the whole changed set and keeps out-of-lane paths visible.
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
        message: `oscar-post-wrap: demo via CoCoder workspace run 1 (technical id: ${run.id})`,
        files: ['cocoder/priorities/demo.md', 'packages/stray.ts'],
      }),
    ])
    expect(store.listCommitLinks(run.id).flatMap((l) => l.files)).toContain('packages/stray.ts')
    expect(store.listEvents(run.id).some((e) => e.type === 'post-wrap-support-commit')).toBe(true)
  })

  test('POST /runs/:id/support-commit commits and flags concurrent out-of-lane packages/ui edits (run_88 regression, 0053)', async () => {
    // Pins the run_232/run_88 incident: while logging via commit-support, the spine swept the founder's
    // concurrent, unrelated packages/ui edits (outside the run's Surface-A lane) into the post-wrap commit
    // 8164afe. Option B intentionally commits those paths, but keeps them visible as out-of-lane.
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'oscar', sessionRef: 'surface:oscar' })
    store.setRunStatus(run.id, 'completed')
    await writePortableRun(home, {
      run: { id: run.id, displayNumber: 1 },
      workspace: { id: 'cocoder' },
      target: { kind: 'priority' },
      priorityId: 'demo',
      playbookId: null,
      ticketId: null,
      status: 'completed',
      createdAt: run.createdAt,
      endedAt: run.endedAt,
    })
    const uiCode = 'packages/ui/src/renderer/sections/dashboard/Priorities.tsx'
    const uiTest = 'packages/ui/tests/priorities-panel-active.test.tsx'
    await startServer(fakeGit(['cocoder/priorities/demo.md', uiCode, uiTest]))
    oz!.ctx.liveRefs.add('surface:oscar')

    const r = await call(oz!, 'POST', `/runs/${run.id}/support-commit`)

    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({
      ok: true,
      commitSha: 'sha-committed',
      committedPaths: ['cocoder/priorities/demo.md', uiCode, uiTest],
      outOfLanePaths: [uiCode, uiTest],
    })
    const committedFiles = store.listCommitLinks(run.id).flatMap((l) => l.files)
    expect(committedFiles).toEqual(['cocoder/priorities/demo.md', uiCode, uiTest])
  })

  test('POST /runs/:id/support-commit refuses to archive the active priority directly', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'oscar', sessionRef: 'surface:oscar' })
    store.setRunStatus(run.id, 'completed')
    await startServer(fakeGit(['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md']))

    const r = await call(oz!, 'POST', `/runs/${run.id}/support-commit`)

    expect(r.status).toBe(409)
    expect(r.json).toMatchObject({
      refusedPaths: ['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md'],
    })
    expect(String(r.json.error)).toContain(`cocoder oz archive-priority ${run.priorityId}`)
    expect(store.listCommitLinks(run.id)).toEqual([])
    expect(store.listEvents(run.id).some((e) => e.type === 'post-wrap-support-commit-refused')).toBe(true)
  })

  test('POST /workspaces/:id/authoring-plays/archive-priority dispatches the one archive Play lane', async () => {
    await writeFile(
      join(home, 'cocoder', 'personas', 'assignments.json'),
      JSON.stringify({
        personas: {
          oz: {
            cli: 'fake',
            model: 'oz-model',
            plays: { 'archive-priority': { cli: 'fake', model: 'author-model' } },
          },
          oscar: { cli: 'claude', model: '' },
          bob: { cli: 'codex', model: '' },
        },
      }),
    )
    const prompts: string[] = []
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md']),
      sessionHost: fakeHost(),
      getAdapter: () => ({
        ...okAdapter,
        build: (input) => {
          prompts.push(input.prompt)
          return { command: 'fake-cli', args: ['authoring'] }
        },
      }),
      io: fakeIO(),
      runHeadless: async () => {
        // Faithful archive: the Play actually moves the live priority out of the live tree (0052 — the
        // lane no longer trusts a reported commit over a still-live file).
        await mkdir(join(home, 'cocoder', 'priorities', 'archive'), { recursive: true })
        await rename(join(home, 'cocoder', 'priorities', 'demo.md'), join(home, 'cocoder', 'priorities', 'archive', 'demo.md'))
        return { exitCode: 0, output: 'archived demo' }
      },
    })

    // Ticket 0023: the orphan /author route must stay gone; only authoring-plays dispatches.
    expect(await call(oz!, 'POST', '/workspaces/cocoder/author', { body: { playId: 'archive-priority', invocation: { id: 'demo' } } }))
      .toEqual({ status: 404, json: { error: 'not found' } })

    const r = await call(oz!, 'POST', '/workspaces/cocoder/authoring-plays/archive-priority', { body: { invocation: { id: 'demo' } } })

    expect(r).toMatchObject({
      status: 200,
      json: {
        ok: true,
        archived: true,
        committedPaths: ['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md'],
        commitSha: 'sha-committed',
        outOfLanePaths: [],
        exitCode: 0,
      },
    })
    expect(prompts[0]).toContain('# Archive Priority Play')
    expect(prompts[0]).toContain('"id": "demo"')
    const audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"authoring-play"')
  })

  test('archive-ready run detail exposes archive confirmation action', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(run.id, 'awaiting-archive-confirmation')
    recordArchiveConfirmationAction(store, run.id)
    await startServer()

    const detail = await call(oz!, 'GET', `/runs/${run.id}`)

    expect(detail.status).toBe(200)
    expect(detail.json.run).toMatchObject({ id: run.id, status: 'awaiting-archive-confirmation' })
    expect(detail.json.actions).toEqual([
      { type: 'archive-priority-confirmation', method: 'POST', endpoint: `/runs/${run.id}/archive-confirmation`, priorityId: 'demo', confirmWith: 'archive' },
    ])
  })

  test('ticket 0079: archive confirmation wait survives orchestrationMs until requestArchiveConfirmation', async () => {
    await startServer(
      fakeGit(),
      async () => ({
        exitCode: 0,
        output: validPriorityFounderCloseout(
          'archive ready',
          'None.',
          'Priority: `demo` — archive after founder confirmation',
          'The priority is ready to archive.',
        ),
      }),
      fakeIO(),
      { orchestrationMs: 1, buildMs: 1, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
    )

    const launched = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
    expect(launched.status).toBe(202)
    const runId = String(launched.json.runId)
    for (let i = 0; i < 50 && store.getRun(runId)?.status === 'running'; i++) await sleep(10)
    await sleep(10)

    expect(store.getRun(runId)?.status).toBe('awaiting-archive-confirmation')
    const parkedEvents = store.listEvents(runId)
    expect(parkedEvents.find((event) => event.type === 'run-end')?.data).toMatchObject({ status: 'awaiting-archive-confirmation' })
    expect(parkedEvents.some((event) => event.type === 'directive-timeout')).toBe(false)
    expect(parkedEvents.some((event) => event.type === 'fault-triaged')).toBe(false)
    const detailBefore = await call(oz!, 'GET', `/runs/${runId}`)
    expect(detailBefore.json.actions).toEqual([
      { type: 'archive-priority-confirmation', method: 'POST', endpoint: `/runs/${runId}/archive-confirmation`, priorityId: 'demo', confirmWith: 'archive' },
    ])

    const declined = await call(oz!, 'POST', `/runs/${runId}/archive-confirmation`, { body: { confirmation: 'not yet' } })

    expect(declined).toMatchObject({ status: 200, json: { ok: true, archived: false, runId, priorityId: 'demo', status: 'awaiting-archive-confirmation' } })
    expect(store.getRun(runId)?.status).toBe('awaiting-archive-confirmation')
    expect(store.listEvents(runId).some((event) => event.type === 'archive-confirmation-declined')).toBe(true)
    expect(store.listEvents(runId).some((event) => event.type === 'directive-timeout')).toBe(false)
  })

  test('run detail hides archive confirmation action after the run leaves awaiting-archive-confirmation', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const completed = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(completed.id, 'completed')
    recordArchiveConfirmationAction(store, completed.id)
    const running = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    recordArchiveConfirmationAction(store, running.id)
    await startServer()

    const completedDetail = await call(oz!, 'GET', `/runs/${completed.id}`)
    const runningDetail = await call(oz!, 'GET', `/runs/${running.id}`)

    expect(completedDetail.status).toBe(200)
    expect(completedDetail.json.run).toMatchObject({ id: completed.id, status: 'completed' })
    expect(completedDetail.json.actions).toEqual([])
    expect(runningDetail.status).toBe(200)
    expect(runningDetail.json.run).toMatchObject({ id: running.id, status: 'failed' })
    expect(runningDetail.json.actions).toEqual([])
  })

  test('POST /runs/:id/archive-confirmation archives through archive-priority and prunes order.json', async () => {
    await writeFile(
      join(home, 'cocoder', 'personas', 'assignments.json'),
      JSON.stringify({
        personas: {
          oz: {
            cli: 'fake',
            model: 'oz-model',
            plays: { 'archive-priority': { cli: 'fake', model: 'author-model' } },
          },
          oscar: { cli: 'claude', model: '' },
          bob: { cli: 'codex', model: '' },
        },
      }),
    )
    await writeFile(join(home, 'cocoder', 'priorities', 'order.json'), `${JSON.stringify(['demo'], null, 2)}\n`)
    const ticketsDir = join(home, 'cocoder', 'tickets')
    await mkdir(join(ticketsDir, 'open'), { recursive: true })
    await mkdir(join(ticketsDir, 'closed'), { recursive: true })
    await writeFile(join(ticketsDir, 'open', '0001-handled-ticket.md'), composeTicketMarkdown('0001', {
      title: 'Handled ticket',
      type: 'bug',
      priority: 'demo',
      bindingReason: 'Founder chose demo for this ticket.',
      provenance: 'run_279',
      description: 'Handled by demo.',
    }, '2026-06-25'))
    await writeFile(join(ticketsDir, 'open', '0002-standalone-none.md'), composeTicketMarkdown('0002', { title: 'Standalone none', type: 'task', priority: 'none', description: 'Standalone.' }, '2026-06-25'))
    await writeFile(join(ticketsDir, 'open', '0003-standalone-unassigned.md'), composeTicketMarkdown('0003', { title: 'Standalone unassigned', type: 'task', priority: 'unassigned', description: 'Standalone.' }, '2026-06-25'))
    await writeFile(join(ticketsDir, 'open', '0004-other-priority.md'), composeTicketMarkdown('0004', { title: 'Other priority', type: 'task', priority: 'other-priority', description: 'Handled elsewhere.' }, '2026-06-25'))
    await writeFile(join(ticketsDir, 'closed', '0005-closed-handled.md'), composeTicketMarkdown('0005', { title: 'Closed handled', type: 'task', priority: 'demo', description: 'Already closed.' }, '2026-06-25'))
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(run.id, 'awaiting-archive-confirmation')
    recordArchiveConfirmationAction(store, run.id)
    const prompts: string[] = []
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md', 'cocoder/priorities/order.json']),
      sessionHost: fakeHost(),
      getAdapter: () => ({
        ...okAdapter,
        build: (input) => {
          prompts.push(input.prompt)
          return { command: 'fake-cli', args: ['authoring'] }
        },
      }),
      io: fakeIO(),
      runHeadless: async () => {
        await mkdir(join(home, 'cocoder', 'priorities', 'archive'), { recursive: true })
        await rename(join(home, 'cocoder', 'priorities', 'demo.md'), join(home, 'cocoder', 'priorities', 'archive', 'demo.md'))
        await writeFile(join(home, 'cocoder', 'priorities', 'order.json'), `${JSON.stringify([], null, 2)}\n`)
        return { exitCode: 0, output: 'archived demo' }
      },
    })

    const r = await call(oz!, 'POST', `/runs/${run.id}/archive-confirmation`, { body: { confirmation: 'archive' } })

    expect(r).toMatchObject({
      status: 200,
      json: {
        ok: true,
        archived: true,
        runId: run.id,
        priorityId: 'demo',
        committedPaths: ['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md', 'cocoder/priorities/order.json'],
        releasedTickets: ['0001'],
        ticketReleaseCommitSha: 'sha-committed',
        ticketReleaseCommittedPaths: ['cocoder/tickets/open/0001-handled-ticket.md', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'],
      },
    })
    expect(prompts[0]).toContain('# Archive Priority Play')
    expect(prompts[0]).toContain('"id": "demo"')
    expect(store.getRun(run.id)?.status).toBe('completed')
    expect(store.listEvents(run.id).some((event) => event.type === 'archive-confirmation-archived')).toBe(true)
    await expect(stat(join(home, 'cocoder', 'priorities', 'archive', 'demo.md'))).resolves.toBeDefined()
    await expect(stat(join(home, 'cocoder', 'priorities', 'demo.md'))).rejects.toThrow()
    await expect(stat(join(ticketsDir, 'open', '0001-handled-ticket.md'))).resolves.toBeDefined()
    await expect(stat(join(ticketsDir, 'closed', '0001-handled-ticket.md'))).rejects.toThrow()
    const releasedRaw = await readFile(join(ticketsDir, 'open', '0001-handled-ticket.md'), 'utf8')
    expect(releasedRaw).toContain('\npriority: none\n')
    expect(releasedRaw).not.toContain('\nbinding-reason:')
    expect(releasedRaw).toContain('\nprovenance: run_279\n')
    const tickets = await readTickets(ticketsDir)
    expect(tickets.find((ticket) => ticket.id === '0001')).toMatchObject({ id: '0001', state: 'open', status: 'Open', priority: 'none', bindingReason: null })
    expect(tickets.filter((ticket) => ticket.state === 'open' && ticket.priority === 'demo')).toEqual([])
    expect(r.json.releasedTickets).not.toEqual(expect.arrayContaining(['0002', '0003', '0004', '0005']))
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'priorities', 'order.json'), 'utf8'))).toEqual([])
  })

  test('POST /runs/:id/archive-confirmation refuses while the owning run is still active', async () => {
    await writeFile(join(home, 'cocoder', 'priorities', 'order.json'), `${JSON.stringify(['demo'], null, 2)}\n`)
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(run.id, 'awaiting-archive-confirmation')
    recordArchiveConfirmationAction(store, run.id)
    await startServer(fakeGit(['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md', 'cocoder/priorities/order.json']))
    oz!.ctx.inFlight.set('cocoder', run.id)

    const r = await call(oz!, 'POST', `/runs/${run.id}/archive-confirmation`, { body: { confirmation: 'archive' } })

    expect(r.status).toBe(409)
    expect(String(r.json.error)).toContain('still active')
    await expect(stat(join(home, 'cocoder', 'priorities', 'demo.md'))).resolves.toBeDefined()
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'priorities', 'order.json'), 'utf8'))).toEqual(['demo'])
  })

  // 0052 route parity: a no-move archive through the confirmation route surfaces the loud named failure,
  // leaves the run awaiting (never completed), and records no archived event.
  test('POST /runs/:id/archive-confirmation surfaces a no-move archive as a loud failure', async () => {
    await writeFile(
      join(home, 'cocoder', 'personas', 'assignments.json'),
      JSON.stringify({
        personas: {
          oz: { cli: 'fake', model: 'oz-model', plays: { 'archive-priority': { cli: 'fake', model: 'author-model' } } },
          oscar: { cli: 'claude', model: '' },
          bob: { cli: 'codex', model: '' },
        },
      }),
    )
    await writeFile(join(home, 'cocoder', 'priorities', 'order.json'), `${JSON.stringify(['demo'], null, 2)}\n`)
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(run.id, 'awaiting-archive-confirmation')
    recordArchiveConfirmationAction(store, run.id)
    // The Play reports success but moves nothing: live demo.md and its order entry stay put (run_88).
    await startServer(fakeGit(), async () => ({ exitCode: 0, output: 'archived demo' }))

    const r = await call(oz!, 'POST', `/runs/${run.id}/archive-confirmation`, { body: { confirmation: 'archive' } })

    expect(r.status).toBe(422)
    expect(r.json).toMatchObject({ ok: false, archived: false, runId: run.id, priorityId: 'demo' })
    expect(String(r.json.error)).toContain('archive-priority for "demo" moved nothing')
    expect(store.getRun(run.id)?.status).toBe('awaiting-archive-confirmation')
    expect(store.listEvents(run.id).some((event) => event.type === 'archive-confirmation-archived')).toBe(false)
    await expect(stat(join(home, 'cocoder', 'priorities', 'demo.md'))).resolves.toBeDefined()
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'priorities', 'order.json'), 'utf8'))).toEqual(['demo'])
  })

  test('POST /runs/:id/archive-confirmation with any non-archive answer leaves the priority live', async () => {
    await writeFile(join(home, 'cocoder', 'priorities', 'order.json'), `${JSON.stringify(['demo'], null, 2)}\n`)
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(run.id, 'awaiting-archive-confirmation')
    recordArchiveConfirmationAction(store, run.id)
    await startServer(fakeGit(['cocoder/priorities/archive/demo.md']), async () => {
      throw new Error('archive Play must not run for non-archive confirmation')
    })

    const r = await call(oz!, 'POST', `/runs/${run.id}/archive-confirmation`, { body: { confirmation: 'not yet' } })

    expect(r).toMatchObject({ status: 200, json: { ok: true, archived: false, runId: run.id, priorityId: 'demo', status: 'awaiting-archive-confirmation' } })
    expect(store.getRun(run.id)?.status).toBe('awaiting-archive-confirmation')
    expect(store.listCommitLinks(run.id)).toEqual([])
    expect(store.listEvents(run.id).some((event) => event.type === 'archive-confirmation-declined')).toBe(true)
    await expect(stat(join(home, 'cocoder', 'priorities', 'demo.md'))).resolves.toBeDefined()
    await expect(stat(join(home, 'cocoder', 'priorities', 'archive', 'demo.md'))).rejects.toThrow()
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'priorities', 'order.json'), 'utf8'))).toEqual(['demo'])
  })

  test('POST /runs/:id/archive-confirmation rejects ticket runs, non-awaiting runs without an action, and empty confirmations', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const ticketRun = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0003' })
    store.setRunStatus(ticketRun.id, 'awaiting-archive-confirmation')
    recordArchiveConfirmationAction(store, ticketRun.id, 'ticket-fix')
    const ordinaryRun = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(ordinaryRun.id, 'completed')
    const awaitingRun = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(awaitingRun.id, 'awaiting-archive-confirmation')
    await startServer()

    const ticket = await call(oz!, 'POST', `/runs/${ticketRun.id}/archive-confirmation`, { body: { confirmation: 'archive' } })
    const notAwaiting = await call(oz!, 'POST', `/runs/${ordinaryRun.id}/archive-confirmation`, { body: { confirmation: 'archive' } })
    const missing = await call(oz!, 'POST', `/runs/${awaitingRun.id}/archive-confirmation`, { body: {} })
    const empty = await call(oz!, 'POST', `/runs/${awaitingRun.id}/archive-confirmation`, { body: { confirmation: '   ' } })

    expect(ticket).toEqual({ status: 409, json: { error: 'archive confirmation applies only to priority-launched runs' } })
    expect(notAwaiting.status).toBe(409)
    expect(notAwaiting.json.error).toBe('run is "completed" and is not awaiting priority archive confirmation')
    expect(missing).toEqual({ status: 400, json: { error: 'archive confirmation requires string field "confirmation"' } })
    expect(empty).toEqual({ status: 400, json: { error: 'archive confirmation requires string field "confirmation"' } })
  })

  test('routes source keeps exactly one authoring HTTP dispatch path', async () => {
    const routes = await readFile(fileURLToPath(new URL('../src/routes.ts', import.meta.url)), 'utf8')

    expect([...routes.matchAll(/seg\[2\] === 'authoring-plays'/g)]).toHaveLength(1)
    expect(routes).not.toContain("seg[2] === 'author'")
  })

  test('POST /workspaces/:id/authoring-plays/:playId can dispatch through the one authoring Play owner as Oscar', async () => {
    await writeFile(
      join(home, 'cocoder', 'personas', 'assignments.json'),
      JSON.stringify({
        personas: {
          oscar: {
            cli: 'fake',
            model: 'oscar-model',
            plays: { 'archive-priority': { cli: 'fake', model: 'author-model' } },
          },
          bob: { cli: 'codex', model: '' },
        },
      }),
    )
    const builds: Array<{ readonly persona: string; readonly model: string; readonly prompt: string }> = []
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md']),
      sessionHost: fakeHost(),
      getAdapter: () => ({
        ...okAdapter,
        build: (input) => {
          builds.push({ persona: input.persona!, model: input.model, prompt: input.prompt })
          return { command: 'fake-cli', args: ['authoring'] }
        },
      }),
      io: fakeIO(),
      runHeadless: async () => {
        // Faithful archive move so the lane's no-move guard (0052) sees the live priority actually leave.
        await mkdir(join(home, 'cocoder', 'priorities', 'archive'), { recursive: true })
        await rename(join(home, 'cocoder', 'priorities', 'demo.md'), join(home, 'cocoder', 'priorities', 'archive', 'demo.md'))
        return { exitCode: 0, output: 'archived demo' }
      },
    })

    const r = await call(oz!, 'POST', '/workspaces/cocoder/authoring-plays/archive-priority', { body: { persona: 'oscar', invocation: { id: 'demo' } } })

    expect(r).toMatchObject({
      status: 200,
      json: {
        ok: true,
        archived: true,
        committedPaths: ['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md'],
        commitSha: 'sha-committed',
        outOfLanePaths: [],
        exitCode: 0,
      },
    })
    expect(builds[0]).toMatchObject({ persona: 'oscar', model: 'author-model' })
    expect(builds[0]?.prompt).toContain('# Archive Priority Play')
    expect(builds[0]?.prompt).toContain('"id": "demo"')
  })

  test('POST /workspaces/:id/authoring-plays/:playId surfaces unknown workspace from the authoring owner', async () => {
    await startServer()

    const r = await call(oz!, 'POST', '/workspaces/missing/authoring-plays/archive-priority', { body: { invocation: { id: 'demo' } } })

    expect(r).toEqual({ status: 404, json: { error: 'unknown workspace' } })
  })

  test('POST /workspaces/:id/authoring-plays/:playId surfaces unsupported play before dispatch', async () => {
    await startServer()

    const r = await call(oz!, 'POST', '/workspaces/cocoder/authoring-plays/rename-priority', { body: { invocation: { id: 'demo' } } })

    expect(r).toEqual({ status: 400, json: { error: 'unsupported authoring Play "rename-priority"' } })
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
    expect(store.listCommitLinks(run.id)).toEqual([
      expect.objectContaining({
        commitSha: 'sha-committed',
        message: `oscar-post-wrap: demo via CoCoder run ${run.id}`,
      }),
    ])
  })

  test('POST /workspaces/:id/oscar-deb-repairs routes through the Oscar-Deb repair operation', async () => {
    await enableDebRepairFixture(home)
    // A non-interfering .md self-fix is the only autonomous Deb commit under the overseer model (ADR-0041).
    await startServer(fakeGit(['cocoder/PLAYBOOK.md']), async () => ({ exitCode: 0, output: appliedDebRepairOutput() }))

    const r = await call(oz!, 'POST', '/workspaces/cocoder/oscar-deb-repairs', {
      body: {
        problem: 'wire the route',
        evidence: [{ kind: 'test', ref: 'mutations.test.ts', summary: 'Route should call requestOscarDebRepair.' }],
        desiredOutcome: 'route receipt is returned',
      },
    })

    expect(r).toMatchObject({
      status: 200,
      json: {
        ok: true,
        state: 'complete',
        outcome: 'applied',
        committedPaths: ['cocoder/PLAYBOOK.md'],
        commitSha: 'sha-committed',
        outOfLanePaths: [],
      },
    })
    expect(String(r.json.dialogueId)).toMatch(/^repair-/)
  })

  test('POST /workspaces/:id/oscar-deb-repairs rejects invalid JSON body', async () => {
    await startServer()

    const r = await callRaw(oz!, 'POST', '/workspaces/cocoder/oscar-deb-repairs', '{')

    expect(r).toEqual({ status: 400, json: { error: 'invalid JSON body' } })
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
    expect(put.json).toEqual({
      pollIntervalMs: 5000,
      defaultWorkspaceId: null,
      ozAutoCompactRuns: 3,
      maxConcurrentRuns: 3,
      retention: { enabled: false, keepLastNPerWorkspace: 25 },
    })
    const persisted = JSON.parse(await readFile(join(home, 'local', 'settings.json'), 'utf8'))
    expect(persisted).toEqual({
      pollIntervalMs: 5000,
      defaultWorkspaceId: null,
      ozAutoCompactRuns: 3,
      maxConcurrentRuns: 3,
      retention: { enabled: false, keepLastNPerWorkspace: 25 },
    })
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

  test('GET /workspaces/:id/priorities exposes independent-of-runner for dashboard routing', async () => {
    await writeFile(
      join(home, 'cocoder', 'priorities', 'runnerless.md'),
      `---\nid: runnerless\ntitle: Runnerless\nindependent-of-runner: true\n---\n## Objective\nDo the runnerless thing.`,
    )
    await startServer()

    const get = await call(oz!, 'GET', '/workspaces/cocoder/priorities')

    expect(get.status).toBe(200)
    expect(get.json.priorities.find((p: any) => p.id === 'runnerless')).toMatchObject({ independentOfRunner: true })
    expect(get.json.priorities.find((p: any) => p.id === 'demo')).toMatchObject({ independentOfRunner: false })
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

  test('POST /workspaces/:id/tickets/reorder writes order.json, commits, audits, and subsequent GET reflects it', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'open', '0004-second-open.md'), ticketFile('0004', 'Second open'))
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))

    const post = await call(oz!, 'POST', '/workspaces/cocoder/tickets/reorder', { body: { order: ['0004', 'missing', '0012', '0003'] } })

    expect(post.status).toBe(200)
    expect(post.json).toEqual({ order: ['0004', '0003'], committedSha: 'sha-governance' })
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0004', '0003'])
    expect(commits).toEqual([
      {
        cwd: home,
        files: ['cocoder/tickets/order.json'],
        message: 'governance: reorder tickets (cocoder)',
        author: COCODER_GOVERNANCE,
      },
    ])

    const get = await call(oz!, 'GET', '/workspaces/cocoder/tickets')
    expect(get.status).toBe(200)
    expect(get.json.tickets.map((ticket: any) => [ticket.id, ticket.state])).toEqual([
      ['0004', 'open'],
      ['0003', 'open'],
      ['0012', 'closed'],
    ])

    let audit = ''
    for (let i = 0; i < 20 && !audit.includes('ticket-reorder'); i++) {
      audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8').catch(() => '')
      if (!audit.includes('ticket-reorder')) await sleep(10)
    }
    expect(audit).toContain('"action":"ticket-reorder"')
    expect(audit).toContain('"committedSha":"sha-governance"')
  })

  test('active-run ticket reorder and priority create queue without writes and survive daemon reload', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'open', '0004-second-open.md'), ticketFile('0004', 'Second open'))
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    oz!.ctx.inFlight.set('cocoder', run.id)
    const ticketOrderPath = join(home, 'cocoder', 'tickets', 'order.json')
    const priorityOrderPath = join(home, 'cocoder', 'priorities', 'order.json')
    const priorityPath = join(home, 'cocoder', 'priorities', 'queued-http-priority.md')

    const reorder = await call(oz!, 'POST', '/workspaces/cocoder/tickets/reorder', { body: { order: ['0004', '0003'] } })
    const priority = await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { id: 'queued-http-priority', title: 'Queued HTTP Priority' } })

    expect(reorder.status).toBe(202)
    expect(reorder.json).toEqual({ ok: true, queued: true, queuedId: 'ticket-reorder-0001', status: 'queued' })
    expect(priority.status).toBe(202)
    expect(priority.json).toEqual({ ok: true, queued: true, queuedId: 'priority-create-queued-http-priority', priorityId: 'queued-http-priority', status: 'queued' })
    expect(await exists(ticketOrderPath)).toBe(false)
    expect(await exists(priorityPath)).toBe(false)
    expect(await exists(priorityOrderPath)).toBe(false)
    expect(commits).toEqual([])

    await oz!.close()
    oz = undefined
    store = openRunStore(':memory:')
    await startServer(recordingGovernanceGit(commits))
    const queued = (await call(oz!, 'GET', '/workspaces/cocoder/tickets')).json.queuedAuthoring
    expect(queued).toEqual([
      expect.objectContaining({ queuedId: 'ticket-reorder-0001', action: 'ticket-reorder', status: 'queued' }),
      expect.objectContaining({ queuedId: 'priority-create-queued-http-priority', action: 'priority-create', priorityId: 'queued-http-priority', status: 'queued' }),
    ])
    expect(commits).toEqual([])
  })

  test('POST /workspaces/:id/tickets/reorder rejects invalid bodies', async () => {
    await startServer()

    expect((await call(oz!, 'POST', '/workspaces/cocoder/tickets/reorder', { body: { order: '0003' } })).status).toBe(400)
    expect((await call(oz!, 'POST', '/workspaces/cocoder/tickets/reorder', { body: { order: ['0003', 1] } })).status).toBe(400)
  })

  test('POST /workspaces/:id/tickets/reorder returns 404 for an unknown workspace', async () => {
    await startServer()

    const r = await call(oz!, 'POST', '/workspaces/nope/tickets/reorder', { body: { order: ['0003'] } })

    expect(r.status).toBe(404)
  })

  test('POST /workspaces/:id/priorities creates a priority with a derived slug and GET returns it', async () => {
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))
    const orderPath = join(home, 'cocoder', 'priorities', 'order.json')
    const beforeOrder = await readFile(orderPath, 'utf8').catch(() => '')

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
    expect(await readFile(orderPath, 'utf8')).not.toBe(beforeOrder)
    expect(JSON.parse(await readFile(orderPath, 'utf8'))).toEqual(['demo', 'new-launch-priority'])
    expect(await findOrphanedPriorities(join(home, 'cocoder', 'priorities'))).toEqual([])
    expect(commits).toEqual([
      {
        cwd: home,
        files: ['cocoder/priorities/new-launch-priority.md', 'cocoder/priorities/order.json'],
        message: 'governance: create priority new-launch-priority',
        author: COCODER_GOVERNANCE,
      },
    ])

    const get = await call(oz!, 'GET', '/workspaces/cocoder/priorities')
    expect(get.status).toBe(200)
    expect(get.json.priorities.map((p: any) => p.id)).toContain('new-launch-priority')
  })

  test('POST /workspaces/:id/priorities registers the created priority in order.json before committing', async () => {
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))
    const orderPath = join(home, 'cocoder', 'priorities', 'order.json')
    const beforeOrder = await readFile(orderPath, 'utf8').catch(() => '')

    const post = await call(oz!, 'POST', '/workspaces/cocoder/priorities', { body: { id: 'registration-guard', title: 'Registration Guard' } })

    expect(post.status).toBe(201)
    expect(await exists(join(home, 'cocoder', 'priorities', 'registration-guard.md'))).toBe(true)
    expect(await readFile(orderPath, 'utf8')).not.toBe(beforeOrder)
    expect(JSON.parse(await readFile(orderPath, 'utf8'))).toEqual(['demo', 'registration-guard'])
    expect(await findOrphanedPriorities(join(home, 'cocoder', 'priorities'))).toEqual([])
    expect(commits).toEqual([
      {
        cwd: home,
        files: ['cocoder/priorities/registration-guard.md', 'cocoder/priorities/order.json'],
        message: 'governance: create priority registration-guard',
        author: COCODER_GOVERNANCE,
      },
    ])
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

  test('POST /workspaces/:id/tickets creates an open ticket, indexes and enqueues it, and commits the governed files', async () => {
    await writeTicketIndex(home)
    const commits: GovernanceCommitCall[] = []
    await startServer(recordingGovernanceGit(commits))

    const post = await call(oz!, 'POST', '/workspaces/cocoder/tickets', {
      body: {
        title: 'Fix Backend Ticket',
        type: 'bug',
        priority: 'oz-dashboard-bugs',
        bindingReason: 'Founder chose oz-dashboard-bugs for this backend ticket.',
        provenance: 'run_279 (ticketing-paths-hardening)',
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
      bindingReason: 'Founder chose oz-dashboard-bugs for this backend ticket.',
      provenance: 'run_279 (ticketing-paths-hardening)',
      owner: 'founder-session',
      state: 'open',
    })
    const ticketPath = join(home, 'cocoder', 'tickets', 'open', '0013-fix-backend-ticket.md')
    expect(await exists(ticketPath)).toBe(true)
    const parsed = await readTickets(join(home, 'cocoder', 'tickets'))
    expect(parsed.find((ticket) => ticket.id === '0013')).toMatchObject({
      title: 'Fix Backend Ticket',
      type: 'bug',
      state: 'open',
      priority: 'oz-dashboard-bugs',
      bindingReason: 'Founder chose oz-dashboard-bugs for this backend ticket.',
      provenance: 'run_279 (ticketing-paths-hardening)',
    })
    const index = await readFile(join(home, 'cocoder', 'tickets', 'INDEX.md'), 'utf8')
    const row = '| [0013](./open/0013-fix-backend-ticket.md) | Fix Backend Ticket | bug | oz-dashboard-bugs | founder-session |'
    expect(index.match(/\| \[0013\]\(\.\/open\/0013-fix-backend-ticket\.md\) \|/g)?.length).toBe(1)
    expect(index.split('\n').slice(0, index.split('\n').indexOf('| [0003](./open/0003-existing-open.md) | Existing open | task | none | founder-session |'))).toContain(row)
    expect(index).toContain('| [0012](./closed/0012-existing-closed.md) | Existing closed | task | 2026-06-17 | Done |')
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0013'])
    expect(commits).toEqual([
      {
        cwd: home,
        files: ['cocoder/tickets/open/0013-fix-backend-ticket.md', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'],
        message: 'governance: create ticket 0013',
        author: COCODER_GOVERNANCE,
      },
    ])
  })

  test('POST /workspaces/:id/tickets queues with a reserved id while the workspace has an active run', async () => {
    await writeTicketIndex(home)
    const commits: GovernanceCommitCall[] = []
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    await startServer(recordingGovernanceGit(commits))
    oz!.ctx.inFlight.set('cocoder', run.id)

    const post = await call(oz!, 'POST', '/workspaces/cocoder/tickets', {
      body: {
        title: 'Queued Backend Ticket',
        type: 'bug',
        priority: 'oz-dashboard-bugs',
        bindingReason: 'Founder chose oz-dashboard-bugs for this queued ticket.',
        description: '## Context\nQueue this ticket while a run is active.',
      },
    })

    expect(post.status).toBe(202)
    expect(post.json).toEqual({ ok: true, queued: true, queuedId: 'ticket-create-0013', reservedTicketId: '0013', status: 'queued' })
    expect(await exists(join(home, 'cocoder', 'tickets', 'open', '0013-queued-backend-ticket.md'))).toBe(false)
    expect(commits).toEqual([])
    expect((await listQueuedAuthoring(home, 'cocoder'))[0]).toMatchObject({
      queuedId: 'ticket-create-0013',
      status: 'queued',
      reservedTicketId: '0013',
      input: { title: 'Queued Backend Ticket', type: 'bug', priority: 'oz-dashboard-bugs', bindingReason: 'Founder chose oz-dashboard-bugs for this queued ticket.' },
    })
  })

  test('POST /workspaces/:id/tickets rejects a priority binding without a reason as a client error', async () => {
    await writeTicketIndex(home)
    await startServer()

    const post = await call(oz!, 'POST', '/workspaces/cocoder/tickets', {
      body: {
        title: 'Reasonless Binding',
        type: 'bug',
        priority: 'oz-dashboard-bugs',
        description: 'Do not create this ticket.',
      },
    })

    expect(post.status).toBe(400)
    expect(post.json).toEqual({ error: 'ticket binding to oz-dashboard-bugs requires a binding reason' })
  })

  test('POST /workspaces/:id/tickets defaults to standalone and stores provenance separately', async () => {
    await writeTicketIndex(home)
    await startServer()

    const post = await call(oz!, 'POST', '/workspaces/cocoder/tickets', {
      body: {
        title: 'Standalone Backend Ticket',
        type: 'task',
        provenance: 'run_279 (ticketing-paths-hardening)',
        description: 'Create a standalone ticket.',
      },
    })

    expect(post.status).toBe(201)
    expect(post.json.ticket).toMatchObject({
      id: '0013',
      priority: 'none',
      bindingReason: null,
      provenance: 'run_279 (ticketing-paths-hardening)',
    })
  })

  test('active-run mixed ticket and priority queue drains after an atom pass and is ledgered before wrap audit', async () => {
    await writeTicketIndex(home)
    await setBobHeadless(home)
    const commits: GovernanceCommitCall[] = []
    const bob = delayedBobHeadless()
    await startServer(queuedCommitGit(commits), bob.runHeadless, oneAtomThenWrapIO(), { monitorCadenceMs: 10 })

    const launch = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
    expect(launch.status).toBe(202)
    const runId = launch.json.runId as string
    for (let i = 0; i < 50 && oz!.ctx.inFlight.get('cocoder') !== runId; i++) await sleep(10)
    expect(oz!.ctx.inFlight.get('cocoder')).toBe(runId)

    const post = await call(oz!, 'POST', '/workspaces/cocoder/tickets', {
      body: {
        title: 'Queued During Run',
        type: 'bug',
        priority: 'none',
        description: 'Queue while Bob is still running.',
      },
    })
    expect(post.status).toBe(202)
    expect(post.json).toMatchObject({ queued: true, reservedTicketId: '0013', status: 'queued' })
    const priority = await call(oz!, 'POST', '/workspaces/cocoder/priorities', {
      body: { id: 'queued-during-run', title: 'Queued During Run', goal: '## Objective\nQueue a priority while Bob is still running.' },
    })
    expect(priority.status).toBe(202)
    expect(priority.json).toMatchObject({ queued: true, priorityId: 'queued-during-run', status: 'queued' })

    const pending = await call(oz!, 'GET', '/workspaces/cocoder/tickets')
    expect(pending.status).toBe(200)
    expect(pending.json.queuedAuthoring).toEqual([
      expect.objectContaining({ queuedId: 'ticket-create-0013', reservedTicketId: '0013', status: 'queued' }),
      expect.objectContaining({ queuedId: 'priority-create-queued-during-run', priorityId: 'queued-during-run', status: 'queued' }),
    ])

    bob.release()
    const ticketPath = join(home, 'cocoder', 'tickets', 'open', '0013-queued-during-run.md')
    const priorityPath = join(home, 'cocoder', 'priorities', 'queued-during-run.md')
    for (let i = 0; i < 100 && (!(await exists(ticketPath)) || !(await exists(priorityPath))); i++) await sleep(10)
    expect(await exists(ticketPath)).toBe(true)
    expect(await exists(priorityPath)).toBe(true)
    for (let i = 0; i < 100 && oz!.ctx.inFlight.has('cocoder'); i++) await sleep(10)

    expect(JSON.parse(await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0013'])
    expect((await readFile(join(home, 'cocoder', 'tickets', 'INDEX.md'), 'utf8'))).toContain('| [0013](./open/0013-queued-during-run.md) | Queued During Run | bug | none | founder-session |')
    expect(loadPriority(join(home, 'cocoder', 'priorities'), 'queued-during-run').objective).toBe('Queue a priority while Bob is still running.')
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'priorities', 'order.json'), 'utf8'))).toEqual(['demo', 'queued-during-run'])
    expect(await listQueuedAuthoring(home, 'cocoder')).toEqual([])
    expect(store.listCommitLinks(runId).map((link) => link.commitSha)).toContain('sha-queued')
    expect(store.listEvents(runId).filter((event) => event.type === 'queued-authoring-commit')).toHaveLength(2)
    expect(store.listEvents(runId).some((event) => event.type === 'run-wrap-bypass-detected')).toBe(false)
    expect(commits.some((commit) => commit.message === 'governance: create queued ticket 0013')).toBe(true)
    expect(commits.some((commit) => commit.message === 'governance: create queued priority queued-during-run')).toBe(true)
  })

  test('queued ticket drain errors remain visible and do not abort the active run', async () => {
    await writeTicketIndex(home)
    await setBobHeadless(home)
    const bob = delayedBobHeadless()
    await startServer(queuedCommitGit([]), bob.runHeadless, oneAtomThenWrapIO(), { monitorCadenceMs: 10 })

    const launch = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
    expect(launch.status).toBe(202)
    const runId = launch.json.runId as string
    for (let i = 0; i < 50 && oz!.ctx.inFlight.get('cocoder') !== runId; i++) await sleep(10)

    const post = await call(oz!, 'POST', '/workspaces/cocoder/tickets', {
      body: { title: 'Will Conflict', type: 'task', priority: 'none', description: 'This reservation will collide before drain.' },
    })
    expect(post.status).toBe(202)
    await writeFile(join(home, 'cocoder', 'tickets', 'open', '0013-conflict.md'), ticketFile('0013', 'Conflict'))

    bob.release()
    for (let i = 0; i < 100 && oz!.ctx.inFlight.has('cocoder'); i++) await sleep(10)

    expect(store.getRun(runId)?.status).toBe('completed')
    expect(store.listEvents(runId).some((event) => event.type === 'safe-commit-boundary-failed')).toBe(false)
    const queued = await listQueuedAuthoring(home, 'cocoder')
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ queuedId: 'ticket-create-0013', status: 'error', reservedTicketId: '0013', error: 'ticket id 0013 already exists' })
    expect((await call(oz!, 'GET', '/workspaces/cocoder/tickets')).json.queuedAuthoring).toEqual([
      expect.objectContaining({ queuedId: 'ticket-create-0013', status: 'error', reservedTicketId: '0013' }),
    ])
  })

  test('POST /workspaces/:id/tickets/:ticketId/close queues during an active run and drains at wrap when there is no next atom', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    const commits: GovernanceCommitCall[] = []
    const controlled = controlledDirectiveIO()
    await startServer(queuedCommitGit(commits), async () => ({ exitCode: 0, output: validFounderCloseout() }), controlled.io)

    const launch = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', priorityId: 'demo' } })
    expect(launch.status).toBe(202)
    const runId = launch.json.runId as string
    for (let i = 0; i < 50 && oz!.ctx.inFlight.get('cocoder') !== runId; i++) await sleep(10)

    const close = await call(oz!, 'POST', '/workspaces/cocoder/tickets/0003/close', { body: { resolution: 'Closed after final wrap.' } })

    expect(close.status).toBe(202)
    expect(close.json).toEqual({ ok: true, queued: true, queuedId: 'ticket-close-0003', ticketId: '0003', status: 'queued' })
    expect(commits).toEqual([])
    expect(await exists(join(home, 'cocoder', 'tickets', 'open', '0003-existing-open.md'))).toBe(true)

    controlled.release()
    for (let i = 0; i < 100 && oz!.ctx.inFlight.has('cocoder'); i++) await sleep(10)

    expect(store.getRun(runId)?.status).toBe('completed')
    expect(await exists(join(home, 'cocoder', 'tickets', 'open', '0003-existing-open.md'))).toBe(false)
    expect(await exists(join(home, 'cocoder', 'tickets', 'closed', '0003-existing-open.md'))).toBe(true)
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0004'])
    expect(await listQueuedAuthoring(home, 'cocoder')).toEqual([])
    expect(store.listEvents(runId).filter((event) => event.type === 'queued-authoring-commit')).toHaveLength(1)
    expect(commits).toContainEqual(expect.objectContaining({
      files: ['cocoder/tickets/closed/0003-existing-open.md', 'cocoder/tickets/open/0003-existing-open.md', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'],
      message: 'governance: close queued ticket 0003',
    }))
  })

  test('queued ticket close refuses after the ticket run wraps awaiting-founder', async () => {
    await writeTicketIndex(home)
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '0004'], null, 2)}\n`)
    const commits: GovernanceCommitCall[] = []
    const controlled = controlledDirectiveIO()
    const decision = 'Yes — close ticket `0003` only after the founder confirms this fix is complete.'
    await startServer(queuedCommitGit(commits), async () => ({ exitCode: 0, output: validTicketFounderCloseout('needs closing', decision) }), controlled.io)

    const launch = await call(oz!, 'POST', '/runs', { body: { workspaceId: 'cocoder', ticketId: '0003' } })
    expect(launch.status).toBe(202)
    const runId = launch.json.runId as string
    for (let i = 0; i < 50 && oz!.ctx.inFlight.get('cocoder') !== runId; i++) await sleep(10)

    const close = await call(oz!, 'POST', '/workspaces/cocoder/tickets/0003/close', { body: { resolution: 'Queued too early.' } })
    expect(close.status).toBe(202)
    expect(close.json).toMatchObject({ queued: true, queuedId: 'ticket-close-0003', ticketId: '0003' })

    controlled.release()
    for (let i = 0; i < 100 && oz!.ctx.inFlight.has('cocoder'); i++) await sleep(10)

    expect(store.getRun(runId)?.status).toBe('awaiting-founder')
    const ticketDir = join(home, 'cocoder', 'tickets')
    expect(await exists(join(ticketDir, 'open', '0003-existing-open.md'))).toBe(true)
    expect(await exists(join(ticketDir, 'closed', '0003-existing-open.md'))).toBe(false)
    expect(JSON.parse(await readFile(join(ticketDir, 'order.json'), 'utf8'))).toEqual(['0003', '0004'])
    const queued = await listQueuedAuthoring(home, 'cocoder')
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ queuedId: 'ticket-close-0003', status: 'error', error: expect.stringContaining(`run ${runId} is awaiting an unanswered founder decision`) })
    expect(commits).not.toContainEqual(expect.objectContaining({ message: 'governance: close queued ticket 0003' }))
  })

  test('POST /workspaces/:id/tickets/:ticketId/repoint queues during an active run without mutating immediately', async () => {
    await writeTicketIndex(home)
    const commits: GovernanceCommitCall[] = []
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    await startServer(recordingGovernanceGit(commits))
    oz!.ctx.inFlight.set('cocoder', run.id)
    const before = await readFile(join(home, 'cocoder', 'tickets', 'open', '0003-existing-open.md'), 'utf8')

    const repoint = await call(oz!, 'POST', '/workspaces/cocoder/tickets/0003/repoint', { body: { targetPriority: 'demo', bindingReason: 'Queued rehome to demo while the run is active.' } })

    expect(repoint.status).toBe(202)
    expect(repoint.json).toEqual({ ok: true, queued: true, queuedId: 'ticket-repoint-0003', ticketId: '0003', status: 'queued' })
    expect(commits).toEqual([])
    expect(await readFile(join(home, 'cocoder', 'tickets', 'open', '0003-existing-open.md'), 'utf8')).toBe(before)
    await expect(listQueuedAuthoring(home, 'cocoder')).resolves.toEqual([
      expect.objectContaining({ queuedId: 'ticket-repoint-0003', action: 'ticket-repoint', ticketId: '0003', status: 'queued' }),
    ])
  })

  test('POST /workspaces/:id/tickets rejects invalid ticket create bodies', async () => {
    await writeTicketIndex(home)
    await startServer()

    expect((await call(oz!, 'POST', '/workspaces/cocoder/tickets', { body: {} })).status).toBe(400)
    expect((await call(oz!, 'POST', '/workspaces/cocoder/tickets', { body: { title: '   ' } })).status).toBe(400)
    expect((await call(oz!, 'POST', '/workspaces/cocoder/tickets', { body: { title: 'Bad type', type: 'feature' } })).status).toBe(400)
  })

  test('POST /workspaces/:id/migrate-portable-history exports DB history counts', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.createSession({ runId: run.id, persona: 'bob', sessionRef: 'surface:1' })
    store.recordEvent({ runId: run.id, type: 'test-event', data: { keep: true } })
    await startServer()

    const res = await call(oz!, 'POST', '/workspaces/cocoder/migrate-portable-history')

    expect(res).toEqual({ status: 200, json: { runsExported: 1, sessionsExported: 1 } })
    await expect(readFile(join(home, 'cocoder', 'runs', `1-${run.id}`, 'run.json'), 'utf8')).resolves.toContain(`"id": "${run.id}"`)
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

  test('POST /workspaces initializes and commits governance for a non-git primary root', async () => {
    await startServer(makeGit())
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'cocoder-nongit-workspace-'))
    await mkdir(join(workspaceRoot, 'src'), { recursive: true })
    await mkdir(join(workspaceRoot, 'node_modules', 'left-pad'), { recursive: true })
    await writeFile(join(workspaceRoot, 'package.json'), '{"name":"product"}\n')
    await writeFile(join(workspaceRoot, 'src', 'app.ts'), 'export const app = true\n')
    await writeFile(join(workspaceRoot, 'node_modules', 'left-pad', 'index.js'), 'module.exports = true\n')

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
    expect(r.json.governanceCommitted).toBe(true)
    expect(r.json.governanceCommittedSha).toMatch(/^[0-9a-f]{40}$/)
    expect(r.json.disclosure).toEqual({
      primaryRoot: workspaceRoot,
      roots: [
        { name: basename(workspaceRoot), path: workspaceRoot, rawPath: workspaceRoot, role: 'primary' },
        { name: basename(home), path: home, rawPath: '${COCODER_HOME}', role: 'readonly' },
      ],
      initializedRepo: true,
      baselineCommitted: true,
      outsideCocoderFiles: ['.gitignore'],
    })
    expect(await g(workspaceRoot, ['rev-parse', '--is-inside-work-tree'])).toBe('true')
    expect(await g(workspaceRoot, ['symbolic-ref', '--short', 'HEAD'])).toBe('main')
    expect((await g(workspaceRoot, ['log', '-1', '--format=%s'])).trim()).toBe('chore: import existing tree (baseline)')
    expect((await g(workspaceRoot, ['log', '-1', '--format=%s', r.json.governanceCommittedSha])).trim()).toBe('governance: scaffold workspace governance (nongit-product)')
    expect(await g(workspaceRoot, ['remote'])).toBe('')
    expect(loadAssignments(join(workspaceRoot, 'cocoder', 'personas', 'assignments.json')).personas).toEqual(expectedScaffoldAssignments)
    const gitignore = await readFile(join(workspaceRoot, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.DS_Store')
    expect(gitignore).toContain('*.zip')
    expect(await g(workspaceRoot, ['ls-files', '--', 'package.json', 'src/app.ts'])).toBe('package.json\nsrc/app.ts')
    expect(await g(workspaceRoot, ['ls-files', '--', 'node_modules/left-pad/index.js'])).toBe('')
    expect(await g(workspaceRoot, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
    const committedFiles = (await g(workspaceRoot, ['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n')
    expect(committedFiles).toEqual(expect.arrayContaining(['.gitignore', 'cocoder/AGENTS.md', 'cocoder/counters.json', 'cocoder/glossary.md', 'cocoder/personas/assignments.json', 'cocoder/workspace.json', 'package.json', 'src/app.ts']))
    await expect(g(workspaceRoot, ['cat-file', '-e', `${r.json.governanceCommittedSha}:cocoder/AGENTS.md`])).resolves.toBe('')
    await expect(g(workspaceRoot, ['cat-file', '-e', `${r.json.governanceCommittedSha}:cocoder/counters.json`])).resolves.toBe('')
    await expect(g(workspaceRoot, ['cat-file', '-e', `${r.json.governanceCommittedSha}:cocoder/workspace.json`])).resolves.toBe('')
    const audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).not.toContain('"action":"governance-commit-failed"')
    expect(audit).toContain('nongit-product')
  })

  test('POST /workspaces surfaces a baseline-import commit failure as a 500 (never a silent success)', async () => {
    // WS3 spine contract: commitBaselineTree routes ['.'] through commitFiles, which surfaces a commit
    // failure in the receipt instead of throwing. The re-throw must preserve the old raw-addAndCommit
    // behavior — a failed baseline import propagates to the 500 handler and is NEVER swallowed into a 201.
    const git = makeGit()
    await startServer({
      ...git,
      async addAndCommit(cwd, files, message, author) {
        if (files.length === 1 && files[0] === '.') throw new Error('baseline import boom')
        return git.addAndCommit(cwd, files, message, author)
      },
    })
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'cocoder-baseline-fail-workspace-'))
    await writeFile(join(workspaceRoot, 'package.json'), '{"name":"product"}\n')

    const r = await call(oz!, 'POST', '/workspaces', {
      body: {
        id: 'baseline-fail-product',
        folders: [
          { path: workspaceRoot, role: 'primary' },
          { path: '${COCODER_HOME}', role: 'readonly' },
        ],
      },
    })

    expect(r.status).toBe(500)
    // The workspace registry write happens AFTER commitBaselineTree, so the throw must leave the workspace
    // unregistered — it is never surfaced as a created workspace.
    const list = await call(oz!, 'GET', '/workspaces')
    expect(list.json.workspaces.map((w: any) => w.id)).not.toContain('baseline-fail-product')
  })

  test('POST /workspaces leaves an existing git root remote and root gitignore untouched', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'cocoder-existing-git-workspace-'))
    await exec('git', ['-C', workspaceRoot, 'init', '-b', 'main'])
    await exec('git', ['-C', workspaceRoot, 'remote', 'add', 'origin', 'https://example.invalid/product.git'])
    await writeFile(join(workspaceRoot, 'package.json'), '{"name":"existing-product"}\n')
    const git = makeGit()
    let initCalls = 0
    await startServer({
      ...git,
      async initRepo(cwd) {
        initCalls += 1
        await git.initRepo(cwd)
      },
    })

    const r = await call(oz!, 'POST', '/workspaces', {
      body: {
        id: 'existing-git-product',
        folders: [
          { path: workspaceRoot, role: 'primary' },
          { path: '${COCODER_HOME}', role: 'readonly' },
        ],
      },
    })

    expect(r.status).toBe(201)
    expect(r.json.governanceCommitted).toBe(true)
    expect(r.json.governanceCommittedSha).toMatch(/^[0-9a-f]{40}$/)
    expect(r.json.disclosure).toEqual({
      primaryRoot: workspaceRoot,
      roots: [
        { name: basename(workspaceRoot), path: workspaceRoot, rawPath: workspaceRoot, role: 'primary' },
        { name: basename(home), path: home, rawPath: '${COCODER_HOME}', role: 'readonly' },
      ],
      initializedRepo: false,
      baselineCommitted: false,
      outsideCocoderFiles: [],
    })
    expect(initCalls).toBe(0)
    expect(await g(workspaceRoot, ['symbolic-ref', '--short', 'HEAD'])).toBe('main')
    expect(await g(workspaceRoot, ['remote', 'get-url', 'origin'])).toBe('https://example.invalid/product.git')
    expect(await exists(join(workspaceRoot, '.gitignore'))).toBe(false)
    expect((await g(workspaceRoot, ['log', '--format=%s'])).trim()).toBe('governance: scaffold workspace governance (existing-git-product)')
    expect(await g(workspaceRoot, ['ls-files', '--', 'package.json'])).toBe('')
    expect(await g(workspaceRoot, ['status', '--porcelain', '--untracked-files=all'])).toContain('?? package.json')
    const committedFiles = (await g(workspaceRoot, ['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n')
    expect(committedFiles).toEqual(expect.arrayContaining(['cocoder/AGENTS.md', 'cocoder/counters.json', 'cocoder/personas/assignments.json', 'cocoder/workspace.json']))
    expect(committedFiles).not.toContain('.gitignore')
    expect(committedFiles).not.toContain('package.json')
    const trackedCocoder = (await g(workspaceRoot, ['ls-files', '--', 'cocoder'])).split('\n').filter(Boolean).sort()
    const ignoredCocoder = (await g(workspaceRoot, ['ls-files', '--others', '-i', '--exclude-standard', '--', 'cocoder'])).split('\n').filter(Boolean)
    const expectedTrackedCocoder = (await listFiles(join(workspaceRoot, 'cocoder')))
      .map((file) => `cocoder/${file}`)
      .filter((file) => !ignoredCocoder.includes(file))
      .sort()
    expect(trackedCocoder).toEqual(expectedTrackedCocoder)
    expect(trackedCocoder).toEqual(expect.arrayContaining(['cocoder/counters.json', 'cocoder/workspace.json']))
  })

  test('ad-hoc priority template parses and stays product-generic', async () => {
    const dir = join(workspaceTemplateDir(), 'priorities')
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

  test('migrateLegacyRunDirsOnce moves known flat run dirs and records a run event', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-daemon-runs-'))
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(run.id, 'completed')
    await mkdir(join(runsRoot, run.id), { recursive: true })
    await writeFile(join(runsRoot, run.id, 'state.json'), '{"kept":true}')

    migrateLegacyRunDirsOnce({ runsRoot, store, inFlight: new Map<string, string>() } as unknown as OzContext)

    const nestedDir = join(runsRoot, 'cocoder', run.id)
    expect(await exists(join(runsRoot, run.id))).toBe(false)
    await expect(readFile(join(nestedDir, 'state.json'), 'utf8')).resolves.toBe('{"kept":true}')
    const event = store.listEvents(run.id).find((item) => item.type === 'run-dir-migrated')
    expect(event?.data).toEqual({ from: join(runsRoot, run.id), to: nestedDir })
  })

  test('migrateLegacyRunDirsOnce leaves in-flight flat run dirs untouched and records no event', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-daemon-runs-'))
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    await mkdir(join(runsRoot, run.id), { recursive: true })
    await writeFile(join(runsRoot, run.id, 'state.json'), '{"active":true}')

    migrateLegacyRunDirsOnce({
      runsRoot,
      store,
      inFlight: new Map<string, string>([['cocoder', run.id]]),
    } as unknown as OzContext)

    await expect(readFile(join(runsRoot, run.id, 'state.json'), 'utf8')).resolves.toBe('{"active":true}')
    expect(await exists(join(runsRoot, 'cocoder', run.id))).toBe(false)
    expect(store.listEvents(run.id).some((item) => item.type === 'run-dir-migrated')).toBe(false)
  })

  test('runRetentionGcOnce is inert with default disabled retention settings', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-daemon-retention-runs-'))
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(run.id, 'completed')
    await mkdir(join(runsRoot, 'cocoder', run.id), { recursive: true })
    await writeFile(join(runsRoot, 'cocoder', run.id, 'state.json'), '{"kept":true}')

    await runRetentionGcOnce(retentionContext(runsRoot))

    expect(store.getRun(run.id)).not.toBeNull()
    await expect(readFile(join(runsRoot, 'cocoder', run.id, 'state.json'), 'utf8')).resolves.toBe('{"kept":true}')
  })

  test('runRetentionGcOnce prunes only projected terminal runs beyond retention while preserving gated runs', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-daemon-retention-runs-'))
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    await writeFile(
      join(home, 'local', 'settings.json'),
      JSON.stringify({ retention: { enabled: true, keepLastNPerWorkspace: 2 } }),
    )

    const oldProjected = await createRetentionRun(runsRoot, 'completed', true, 1)
    const oldUnprojected = await createRetentionRun(runsRoot, 'completed', false, 2)
    const oldRunning = await createRetentionRun(runsRoot, 'running', true, 3)
    const prunedA = await createRetentionRun(runsRoot, 'completed', true, 4)
    const prunedB = await createRetentionRun(runsRoot, 'completed', true, 5)
    const prunedC = await createRetentionRun(runsRoot, 'completed', true, 6)
    const keptRecentA = await createRetentionRun(runsRoot, 'completed', true, 7)
    const keptRecentB = await createRetentionRun(runsRoot, 'completed', true, 8)

    await runRetentionGcOnce(retentionContext(runsRoot))

    for (const run of [oldProjected, prunedA, prunedB, prunedC]) {
      expect(store.getRun(run.id)).toBeNull()
      expect(await exists(join(runsRoot, 'cocoder', run.id))).toBe(false)
    }
    for (const run of [oldUnprojected, oldRunning, keptRecentA, keptRecentB]) {
      expect(store.getRun(run.id)).not.toBeNull()
      expect(await exists(join(runsRoot, 'cocoder', run.id))).toBe(true)
    }

    const audit = await readFile(join(home, 'local', 'oz-audit.log'), 'utf8')
    expect(audit).toContain('"action":"retention-gc"')
    expect(audit).toContain(`"prunedRunIds":["${prunedC.id}","${prunedB.id}","${prunedA.id}","${oldProjected.id}"]`)
  })

  test('runRetentionGcOnce swallows startup GC errors so boot is not blocked', async () => {
    await writeFile(
      join(home, 'local', 'settings.json'),
      JSON.stringify({ retention: { enabled: true, keepLastNPerWorkspace: 1 } }),
    )
    const throwingStore = {
      listRuns: () => {
        throw new Error('store unavailable')
      },
    }

    await expect(runRetentionGcOnce({ ...retentionContext(join(home, 'local', 'runs')), store: throwingStore } as unknown as OzContext)).resolves.toBeUndefined()
  })

  function retentionContext(runsRoot: string): OzContext {
    return {
      cocoderHome: home,
      runsRoot,
      store,
      inFlight: new Map<string, string>(),
      stopControllers: new Map<string, AbortController>(),
    } as unknown as OzContext
  }

  async function createRetentionRun(runsRoot: string, status: 'completed' | 'running', projected: boolean, displayNumber: number) {
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    if (status !== 'running') store.setRunStatus(run.id, status)
    const current = store.getRun(run.id)
    if (current === null) throw new Error(`missing run ${run.id}`)
    await mkdir(join(runsRoot, 'cocoder', run.id), { recursive: true })
    await writeFile(join(runsRoot, 'cocoder', run.id, 'state.json'), status)
    if (projected) {
      await writePortableRun(home, {
        run: { id: run.id, displayNumber },
        workspace: { id: 'cocoder' },
        target: { kind: 'priority' },
        priorityId: 'demo',
        playbookId: null,
        ticketId: null,
        status: current.status,
        createdAt: current.createdAt,
        endedAt: current.endedAt,
      })
    }
    return current
  }

})
