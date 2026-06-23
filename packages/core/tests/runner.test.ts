import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  type Adapter,
  AuditWriteBoundaryError,
  type DebStatus,
  type Directive,
  DirtyWorkingTreeError,
  type Git,
  type HeadlessRunInput,
  type MakeJudge,
  type NudgeRequest,
  MissingObjectiveError,
  type Play,
  type PlayAssignment,
  PreflightError,
  type ResolvedPersona,
  type RunnerDeps,
  type RunnerIO,
  type RunInput,
  type SpawnOptions,
  type SessionHost,
  type SessionRef,
  StopRequestedError,
  openRunStore,
  runRun,
} from '../src/index.js'

const persona = (over: Partial<ResolvedPersona> & { id: string; cli: string }): ResolvedPersona => ({
  label: over.id,
  role: 'r',
  writeScope: [],
  body: `${over.id} body`,
  model: '',
  ...over,
})

const oscar = persona({ id: 'oscar', cli: 'claude', writeScope: [] })
const bob = persona({ id: 'bob', cli: 'codex', writeScope: ['packages/**'] })
const deb = persona({ id: 'deb', cli: 'claude', writeScope: [] })
const priority = { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'do the small thing', objective: 'do the small thing' }
const workspaceRoot = join(tmpdir(), `cocoder-runner-unit-repo-${process.pid}`)
const workspace = { id: 'cocoder', path: workspaceRoot, name: 'CoCoder' }

beforeAll(async () => {
  await mkdir(join(workspaceRoot, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(workspaceRoot, 'cocoder', 'tickets', 'open'), { recursive: true })
  await writeFile(join(workspaceRoot, 'cocoder', 'priorities', 'demo.md'), '# Demo\n')
  await writeFile(join(workspaceRoot, 'cocoder', 'tickets', 'open', '0015-demo-ticket.md'), '# Demo ticket\n')
})

afterAll(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

function fakeSessionHost(over: Partial<SessionHost> = {}): SessionHost {
  let n = 0
  const ref = (): SessionRef => ({ id: `surface:${++n}`, driver: 'fake' })
  return {
    async spawn() {
      return ref()
    },
    async readScreen() {
      return ''
    },
    async status() {
      return { state: 'running' } // alive — the monitor's judge decides when an atom is done
    },
    async waitForExit() {
      return { state: 'exited', code: 0 }
    },
    async sendInput() {},
    async show() {},
    async kill() {},
    async closeSurface() {},
    ...over,
  } as SessionHost
}

// The worktree port methods (ADR-0023 §4 lineage) the runner doesn't exercise in these fake-git unit
// tests — spread into every fake so the Git interface stays satisfied (real git math is covered by
// the live-git test in git-worktree.test.ts).
const worktreeStubs = {
  async isGitRepo() {
    return true
  },
  async initRepo() {},
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
}

// Git that returns a scripted changed-file set per atom and advances HEAD on commit (so per-atom
// self-commit detection and commit attribution can be asserted).
function scriptedGit(changedPerAtom: string[][]): Git {
  let head = 'h0'
  let call = 0
  let started = false
  return {
    ...worktreeStubs,
    async headSha() {
      return head
    },
    async changedFiles() {
      // FIRST call = the run-start pre-existing-dirt snapshot (clean in these fakes). Then one changed
      // set per commit-gate / quarantine call.
      if (!started) {
        started = true
        return []
      }
      return changedPerAtom[call++] ?? []
    },
    async addAndCommit() {
      head = `sha-${call}`
      return head
    },
    async restoreToHead() {},
    async show() {
      return ''
    },
  }
}

function recordingScriptedGit(changedPerAtom: string[][]): { readonly git: Git; readonly commits: string[][] } {
  const commits: string[][] = []
  let head = 'h0'
  let call = 0
  let started = false
  return {
    commits,
    git: {
      ...worktreeStubs,
      async headSha() {
        return head
      },
      async changedFiles() {
        if (!started) {
          started = true
          return []
        }
        return changedPerAtom[call++] ?? []
      },
      async addAndCommit(_cwd, files) {
        commits.push([...files])
        head = `sha-${call}`
        return head
      },
      async restoreToHead() {},
      async show() {
        return ''
      },
    },
  }
}

const okAdapter: Adapter = {
  id: 'any',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
  headlessCapable: false,
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
}

// IO that scripts Oscar's directive sequence + per-atom verdicts (default: every atom passes).
const fakeIO = (opts: {
  directives: Directive[]
  verdicts?: { verdict: 'pass' | 'fail'; reason: string | null }[]
  triage?: {
    disposition: 'cocoder-bug' | 'repo-bug' | 'one-off'
    summary: string
    proposal?: string
    mode?: 'propose' | 'repair'
    diagnosis?: string
    whyCocoderOwned?: string
    filesChanged?: string[]
    verification?: string
    remainingRisk?: string
    escalation?: 'repair' | 'ticket' | 'recommend-priority'
    ticketId?: string
  }
  /** Nudge recommendation returned for every readNudgeRequest call, unless nudges/readNudge override it. */
  nudge?: NudgeRequest | null
  /** Path-aware nudge recommendations, keyed by basename such as deb-nudge.json or oz-nudge.json. */
  nudges?: Partial<Record<'deb-nudge.json' | 'oz-nudge.json', NudgeRequest | null>>
  readNudge?: (nudgePath: string) => Promise<NudgeRequest | null>
  /** Status snapshots captured each time the runner refreshes the feed. */
  statusWrites?: DebStatus[]
  pickupWrites?: string[]
  artifactWrites?: Array<{ runDir: string; fileName: string; contents: string }>
  recordWrites?: string[]
}): RunnerIO => {
  let di = 0
  let vi = 0
  return {
    async ensureRunDir() {},
    async awaitDirective() {
      const d = opts.directives[di++]
      if (!d) throw new Error('test: ran out of scripted directives')
      return d
    },
    async awaitVerification() {
      return opts.verdicts?.[vi++] ?? { verdict: 'pass' as const, reason: 'looks good' }
    },
    async awaitTriage() {
      return { mode: 'propose' as const, ...(opts.triage ?? { disposition: 'cocoder-bug' as const, summary: 'machinery fault', proposal: '--- a\n+++ b' }) }
    },
    async writeFaultContext() {},
    async writeDisposition(runDir, index) {
      return `${runDir}/disposition-${index}.md`
    },
    async writeDebStatus(_runDir, status) {
      opts.statusWrites?.push(status)
    },
    async readNudgeRequest(nudgePath) {
      if (opts.readNudge) return await opts.readNudge(nudgePath)
      const file = nudgePath.endsWith('oz-nudge.json') ? 'oz-nudge.json' : nudgePath.endsWith('deb-nudge.json') ? 'deb-nudge.json' : null
      if (file && Object.prototype.hasOwnProperty.call(opts.nudges ?? {}, file)) return opts.nudges?.[file] ?? null
      return opts.nudge ?? null
    },
    async writePickup(runDir, markdown) {
      opts.pickupWrites?.push(markdown)
      return `${runDir}/pickup.md`
    },
    async writeRunArtifact(runDir, fileName, contents) {
      opts.artifactWrites?.push({ runDir, fileName, contents })
      return `${runDir}/${fileName}`
    },
    async writeRunRecord(runDir) {
      opts.recordWrites?.push(runDir)
      return `${runDir}/record.md`
    },
  }
}

// A judge that completes every atom on the first sample — keeps the loop deterministic + fast.
const doneJudge: MakeJudge = () => async () => ({ state: 'done' })

const delegate = (task: string): Directive => ({ kind: 'delegate', task })
const loopDelegate = (task: string, over: Partial<NonNullable<Extract<Directive, { kind: 'delegate' }>['loop']>> = {}): Directive => ({
  kind: 'delegate',
  task,
  loop: {
    goal: 'Make the criterion green',
    criterion: 'pnpm test exits 0',
    maxIterations: 1,
    wallClockMs: 1_000_000,
    ...over,
  },
})
const wrapup = (pickup: string): Directive => ({ kind: 'wrapup', pickup })
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const wrapPlayRaw = readFileSync(join(repoRoot, 'packages', 'personas', 'base', 'plays', 'wrap-up.md'), 'utf8')
const wrapPlayBody = wrapPlayRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
const wrapPlay: Play = {
  id: 'wrap-up',
  label: 'Wrap-up',
  kind: 'headless',
  outputValidator: { ref: 'validators/founder-closeout' },
  writeScope: ['docs/**'],
  body: wrapPlayBody,
}
const wrapPlayAssignment: PlayAssignment = { cli: 'cursor-agent', model: 'cheap-wrap' }

type FounderCloseoutRole =
  | 'title'
  | 'atomComplete'
  | 'runStatus'
  | 'whatChanged'
  | 'whatRemains'
  | 'nextStep'
  | 'decisionNeeded'
  | 'commitState'
  | 'teardownReadiness'
  | 'judgment'

const founderCloseoutRole = (labelText: string): FounderCloseoutRole | null => {
  const normalized = labelText
    .replace(/\*/g, '')
    .replace(/:/g, '')
    .trim()
    .toLowerCase()
  if (normalized === 'founder completion brief') return 'title'
  if (normalized === 'atom complete') return 'atomComplete'
  if (normalized === 'run status') return 'runStatus'
  if (normalized === 'what changed') return 'whatChanged'
  if (normalized === 'what remains') return 'whatRemains'
  if (normalized === 'recommended next step') return 'nextStep'
  if (normalized === 'founder decision needed') return 'decisionNeeded'
  if (normalized === 'commit state') return 'commitState'
  if (normalized === 'teardown readiness') return 'teardownReadiness'
  if (normalized === 'judgment') return 'judgment'
  return null
}

const founderCloseoutContract = (playBody: string): { labels: Record<FounderCloseoutRole, string>; orderedRoles: readonly FounderCloseoutRole[]; finalLine: string } => {
  const fence = playBody.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/)
  if (!fence?.[1]) throw new Error('test wrap-up Play is missing a fenced founder closeout contract')
  const sections = [...fence[1].matchAll(/^\*\*[^*\n]+?\*\*\s*$/gm)].map((match) => match[0].trim())
  const roleEntries = sections.flatMap((section): readonly [FounderCloseoutRole, string][] => {
    const role = founderCloseoutRole(section)
    return role ? [[role, section]] : []
  })
  const labels = Object.fromEntries(roleEntries) as Partial<Record<FounderCloseoutRole, string>>
  const finalLine = fence[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (
    !labels.title ||
    !labels.atomComplete ||
    !labels.runStatus ||
    !labels.whatChanged ||
    !labels.whatRemains ||
    !labels.nextStep ||
    !labels.decisionNeeded ||
    !labels.commitState ||
    !labels.teardownReadiness ||
    !labels.judgment ||
    !finalLine ||
    finalLine.startsWith('**')
  ) {
    throw new Error('test wrap-up Play founder closeout contract is malformed')
  }
  return {
    labels: labels as Record<FounderCloseoutRole, string>,
    orderedRoles: roleEntries.map(([role]) => role),
    finalLine,
  }
}

const closeoutContract = founderCloseoutContract(wrapPlayBody)
const label = (role: FounderCloseoutRole): string => closeoutContract.labels[role]
const issue = (role: FounderCloseoutRole, text: string): string => `${label(role)} ${text}`
const block = (role: FounderCloseoutRole, text: string): string => `${label(role)}\n${text}`
const renderFounderCloseout = (input: {
  summary?: string
  atomComplete?: string
  runStatus?: string
  whatRemains?: string
  nextStep?: string
  decisionNeeded?: string
  commitState?: string
  teardownReadiness?: string
  judgment?: string
  finalLine?: string
} = {}): string => {
  const content: Record<FounderCloseoutRole, string> = {
    title: '',
    atomComplete: input.atomComplete ?? 'Yes',
    runStatus: input.runStatus ?? 'continue',
    whatChanged: input.summary ?? 'The requested work was completed.',
    whatRemains: input.whatRemains ?? '- Continue the remaining priority atoms.',
    nextStep: input.nextStep ?? 'Priority: `demo` — continue the remaining priority atoms',
    decisionNeeded: input.decisionNeeded ?? 'None.',
    commitState: input.commitState ?? 'The runner reports the authoritative commit outcome after this brief.',
    teardownReadiness: input.teardownReadiness ?? 'Standing by; teardown requires an explicit founder request.',
    judgment: input.judgment ?? 'Oscar stopped at a clean wrap-up point.',
  }
  const body = closeoutContract.orderedRoles
    .map((role) => (role === 'title' ? label(role) : block(role, content[role])))
    .join('\n\n')
  return `${body}\n\n${input.finalLine ?? closeoutContract.finalLine}\n`
}
const validFounderCloseout = (summary = 'The requested work was completed.'): string => renderFounderCloseout({ summary })

const baseDeps = (over: Partial<RunnerDeps>): RunnerDeps => ({
  store: openRunStore(':memory:'),
  sessionHost: fakeSessionHost(),
  git: scriptedGit([['packages/x.ts']]),
  getAdapter: () => okAdapter,
  io: fakeIO({ directives: [delegate('do it'), wrapup('resume here')] }),
  makeJudge: doneJudge,
  timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
  ...over,
})

// This suite drives the runner with a FAKE git over the historical opt-in isolation lineage (ADR-0023 §4):
// worktree create/land are stubbed, so the loop/verify/commit machinery is exercised without a real repo.
// The new direct-mode DEFAULT (ADR-0023 §2) is proven against LIVE git in runner-direct.test.ts.
const input = { workspace, priority, oscar, bob, sharedStandards: 'STANDARDS', engineHome: workspaceRoot, runsRoot: '/runs' }
const stopFaultEvents = new Set(['directive-timeout', 'builder-failed', 'verify-failed', 'triage-dispatch', 'fault-triaged', 'triage-skipped'])

describe('runRun (multi-atom loop)', () => {
  test('missing Objective rejects before any store writes', async () => {
    const store = openRunStore(':memory:')
    await expect(runRun(baseDeps({ store }), { ...input, priority: { ...priority, objective: null } })).rejects.toBeInstanceOf(MissingObjectiveError)
    expect(store.listRuns()).toEqual([])
  })

  test('cmux group label carries workspace, target, and run while group key stays the run id', async () => {
    const spawns: SpawnOptions[] = []
    await runRun(
      baseDeps({
        sessionHost: fakeSessionHost({
          async spawn(opts) {
            spawns.push(opts)
            return { id: `surface:${spawns.length}`, driver: 'fake' }
          },
        }),
      }),
      { ...input, ticketId: '0003', target: { type: 'ticket', slug: '0003' } },
    )

    expect(spawns).toHaveLength(2)
    expect(spawns.map((spawn) => spawn.group)).toEqual(['run_1', 'run_1'])
    expect(spawns.map((spawn) => spawn.groupLabel)).toEqual(['CoCoder · ticket:0003 #1', 'CoCoder · ticket:0003 #1'])
    expect(spawns.map((spawn) => spawn.label)).toEqual(['oscar | Claude | Opus 4.8', 'bob | Codex | default'])
  })

  test('default model assignments launch Claude without a --model flag', async () => {
    const spawns: SpawnOptions[] = []
    const preflightModels: string[] = []
    const launchedModels: string[] = []
    const claudeAdapter: Adapter = {
      ...okAdapter,
      id: 'claude',
      build: (buildInput) => {
        launchedModels.push(buildInput.model)
        const args = ['run']
        if (buildInput.model) args.push('--model', buildInput.model)
        args.push(buildInput.prompt)
        return { command: 'claude', args }
      },
      preflight: async (model) => {
        preflightModels.push(model)
        return { ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }, { name: 'model', ok: true, detail: model || '(default)' }] }
      },
    }
    await runRun(
      baseDeps({
        getAdapter: () => claudeAdapter,
        sessionHost: fakeSessionHost({
          async spawn(opts) {
            spawns.push(opts)
            return { id: `surface:${spawns.length}`, driver: 'fake' }
          },
        }),
      }),
      { ...input, bob: { ...bob, cli: 'claude', model: '' } },
    )

    expect(preflightModels.slice(0, 2)).toEqual(['', ''])
    expect(launchedModels.slice(0, 2)).toEqual(['', ''])
    expect(spawns).toHaveLength(2)
    expect(spawns.flatMap((spawn) => spawn.args)).not.toContain('--model')
  })

  test('cmux group label derives compatibility targets when RunInput.target is absent', async () => {
    const groupLabelsFor = async (overrides: Partial<RunInput>): Promise<Array<string | undefined>> => {
      const spawns: SpawnOptions[] = []
      await runRun(
        baseDeps({
          sessionHost: fakeSessionHost({
            async spawn(opts) {
              spawns.push(opts)
              return { id: `surface:${spawns.length}`, driver: 'fake' }
            },
          }),
        }),
        { ...input, ...overrides },
      )
      return spawns.map((spawn) => spawn.groupLabel)
    }

    await expect(groupLabelsFor({})).resolves.toEqual([
      expect.stringMatching(/^CoCoder · priority:demo #\d+$/),
      expect.stringMatching(/^CoCoder · priority:demo #\d+$/),
    ])
    await expect(groupLabelsFor({ ticketId: '0003' })).resolves.toEqual([
      expect.stringMatching(/^CoCoder · ticket:0003 #\d+$/),
      expect.stringMatching(/^CoCoder · ticket:0003 #\d+$/),
    ])
    await expect(groupLabelsFor({ priority: { ...priority, id: 'adhoc-session' } })).resolves.toEqual([
      expect.stringMatching(/^CoCoder · ad-hoc:adhoc-session #\d+$/),
      expect.stringMatching(/^CoCoder · ad-hoc:adhoc-session #\d+$/),
    ])
  })

  test('drives Bob through MULTIPLE atoms, commits each, ends on Oscar wrap-up', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/a.ts'], ['packages/b.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), delegate('atom 1'), wrapup('next: do atom 2')] }),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(store.getRun(result.runId)?.status).toBe('completed')
    expect(result.atoms).toBe(2)
    expect(result.committedShas).toHaveLength(2)
    expect(result.committedFiles).toEqual(['packages/a.ts', 'packages/b.ts'])
    expect(result.pickupPath).toMatch(/\/runs\/run_.*\/pickup\.md$/)

    // One work_item + one commit_link PER ATOM (the F8 continuation substrate, activated).
    const wis = store.listWorkItems(result.runId)
    expect(wis.map((w) => w.task)).toEqual(['atom 0', 'atom 1'])
    expect(wis.every((w) => w.status === 'done')).toBe(true)
    expect(store.listCommitLinks(result.runId).filter((c) => c.workItemId !== null).map((c) => c.files)).toEqual([['packages/a.ts'], ['packages/b.ts']])
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['run-start', 'spawn', 'delegation', 'builder-done', 'verify-pass', 'commit', 'wrapup', 'run-end']))
  })

  test('onboard-existing audit recon writes are in-scope while product writes are still hard-refused', async () => {
    const store = openRunStore(':memory:')
    const { git, commits } = recordingScriptedGit([['cocoder/audit/recon.md']])
    const onboardingPriority = { ...priority, id: 'onboard-existing', scopeNarrowing: ['cocoder/**'], auditWriteBoundary: ['cocoder/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('write recon'), wrapup('done')] }),
      }),
      { ...input, priority: onboardingPriority },
    )

    expect(result.status).toBe('completed')
    expect(commits).toContainEqual(['cocoder/audit/recon.md'])
    expect(store.listEvents(result.runId).some((event) => event.type === 'out-of-scope-committed')).toBe(false)
  })

  test('refuses onboard-existing product-code writes before the ordinary atom gate commits', async () => {
    const store = openRunStore(':memory:')
    const { git, commits } = recordingScriptedGit([['packages/core/src/foo.ts']])
    const onboardingPriority = { ...priority, id: 'onboard-existing', scopeNarrowing: ['cocoder/**'], auditWriteBoundary: ['cocoder/**'] }

    await expect(runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('audit the repo'), wrapup('done')] }),
      }),
      { ...input, priority: onboardingPriority },
    )).rejects.toBeInstanceOf(AuditWriteBoundaryError)

    const runId = store.listRuns()[0]?.id
    expect(runId).toBeDefined()
    expect(commits).toEqual([])
    expect(store.listCommitLinks(runId!)).toEqual([])
    const event = store.listEvents(runId!).find((item) => item.type === 'audit-write-boundary-refused')
    expect(event?.data).toMatchObject({ label: 'onboard-existing', files: ['packages/core/src/foo.ts'] })
  })

  test('onboard-existing blocks expensive reads after recon until spend approval is recorded', async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), 'cocoder-onboarding-spend-block-'))
    await mkdir(join(targetRoot, 'cocoder', 'audit'), { recursive: true })
    await writeFile(join(targetRoot, 'cocoder', 'audit', 'recon.md'), '# Recon\n')
    const store = openRunStore(':memory:')
    const onboardingPriority = { ...priority, id: 'onboard-existing', scopeNarrowing: ['cocoder/**'], auditWriteBoundary: ['cocoder/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/audit/deep-read.md']]),
        io: fakeIO({ directives: [delegate('deep read after recon'), wrapup('pause for founder approval')] }),
      }),
      { ...input, workspace: { id: 'target', path: targetRoot, name: 'Target' }, priority: onboardingPriority, engineHome: targetRoot },
    )

    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    expect(events.some((event) => event.type === 'builder-dispatch')).toBe(false)
    expect(events.find((event) => event.type === 'onboarding-spend-approval-required')?.data).toMatchObject({
      atom: 0,
      message: 'recon complete; spend approval required before expensive read — record approval at cocoder/audit/spend-approval.json',
      reconPath: 'cocoder/audit/recon.md',
      approvalPath: 'cocoder/audit/spend-approval.json',
    })
  })

  test('onboard-existing proceeds after a valid spend approval checkpoint', async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), 'cocoder-onboarding-spend-open-'))
    await mkdir(join(targetRoot, 'cocoder', 'audit'), { recursive: true })
    await writeFile(join(targetRoot, 'cocoder', 'audit', 'recon.md'), '# Recon\n')
    await writeFile(join(targetRoot, 'cocoder', 'audit', 'spend-approval.json'), JSON.stringify({ approved: true }))
    const store = openRunStore(':memory:')
    const onboardingPriority = { ...priority, id: 'onboard-existing', scopeNarrowing: ['cocoder/**'], auditWriteBoundary: ['cocoder/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/audit/deep-read.md']]),
        io: fakeIO({ directives: [delegate('deep read after approval'), wrapup('done')] }),
      }),
      { ...input, workspace: { id: 'target', path: targetRoot, name: 'Target' }, priority: onboardingPriority, engineHome: targetRoot },
    )

    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    expect(events.some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(events.some((event) => event.type === 'onboarding-spend-approval-required')).toBe(false)
  })

  test('onboard-existing recon retries are not blocked before recon exists', async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), 'cocoder-onboarding-retry-open-'))
    await mkdir(join(targetRoot, 'cocoder'), { recursive: true })
    const store = openRunStore(':memory:')
    const onboardingPriority = { ...priority, id: 'onboard-existing', scopeNarrowing: ['cocoder/**'], auditWriteBoundary: ['cocoder/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/audit/recon.md']]),
        io: fakeIO({ directives: [delegate('retry recon'), wrapup('done')] }),
      }),
      { ...input, workspace: { id: 'target', path: targetRoot, name: 'Target' }, priority: onboardingPriority, engineHome: targetRoot },
    )

    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    expect(events.some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(events.some((event) => event.type === 'onboarding-spend-approval-required')).toBe(false)
  })

  test('non-onboarding priorities do not run the spend gate', async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), 'cocoder-non-onboarding-open-'))
    await mkdir(join(targetRoot, 'cocoder', 'audit'), { recursive: true })
    await writeFile(join(targetRoot, 'cocoder', 'audit', 'recon.md'), '# Recon\n')
    const store = openRunStore(':memory:')

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/deep-read.ts']]),
        io: fakeIO({ directives: [delegate('ordinary deep read'), wrapup('done')] }),
      }),
      { ...input, workspace: { id: 'target', path: targetRoot, name: 'Target' }, engineHome: targetRoot },
    )

    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    expect(events.some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(events.some((event) => event.type === 'onboarding-spend-approval-required')).toBe(false)
  })

  test('ordinary priorities keep whole-tree commit behavior and only flag out-of-lane files', async () => {
    const store = openRunStore(':memory:')
    const { git, commits } = recordingScriptedGit([['packages/core/src/foo.ts']])
    const governanceBob = { ...bob, writeScope: ['cocoder/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('ordinary work'), wrapup('done')] }),
      }),
      { ...input, bob: governanceBob },
    )

    expect(result.status).toBe('completed')
    expect(store.getRun(result.runId)?.status).toBe('completed')
    expect(commits[0]).toEqual(['packages/core/src/foo.ts'])
    expect(result.committedFiles).toEqual(['packages/core/src/foo.ts'])
    expect(result.outOfScope).toEqual(['packages/core/src/foo.ts'])
    expect(store.listEvents(result.runId).some((item) => item.type === 'audit-write-boundary-refused')).toBe(false)
  })

  test('rebuilds the Oz UI bundle once at landing when committed files touch packages/ui', async () => {
    const store = openRunStore(':memory:')
    const builds: string[] = []

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/ui/app/App.tsx'], ['packages/ui/app/styles/fusion.css']]),
        io: fakeIO({ directives: [delegate('atom 0'), delegate('atom 1'), wrapup('done')] }),
        buildUiBundle: async ({ cwd }) => {
          builds.push(cwd)
          return { exitCode: 0, output: 'built ui bundle' }
        },
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(builds).toEqual([workspaceRoot])
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types.filter((type) => type === 'ui-bundle-rebuild-started')).toHaveLength(1)
    expect(types.filter((type) => type === 'ui-bundle-rebuild-succeeded')).toHaveLength(1)
  })

  test('does not rebuild the Oz UI bundle when no committed file touches packages/ui', async () => {
    const store = openRunStore(':memory:')
    let builds = 0

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/core/src/x.ts']]),
        buildUiBundle: async () => {
          builds += 1
          return { exitCode: 0, output: 'should not run' }
        },
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(builds).toBe(0)
    expect(store.listEvents(result.runId).some((e) => e.type.startsWith('ui-bundle-rebuild-'))).toBe(false)
  })

  test('fails plainly when the Oz UI bundle rebuild command fails', async () => {
    const store = openRunStore(':memory:')

    await expect(
      runRun(
        baseDeps({
          store,
          git: scriptedGit([['packages/ui/app/App.tsx']]),
          buildUiBundle: async () => ({ exitCode: 2, output: 'vite build failed' }),
        }),
        input,
      ),
    ).rejects.toThrow('Oz UI bundle rebuild failed')

    expect(store.listRuns()[0]?.status).toBe('failed')
    const event = store.listEvents('run_1').find((e) => e.type === 'ui-bundle-rebuild-failed')
    expect(event?.data).toMatchObject({ command: 'pnpm --dir packages/ui build', exitCode: 2, output: 'vite build failed' })
  })

  test('blocks and restores if the UI bundle rebuild dirties committed app source', async () => {
    const store = openRunStore(':memory:')
    const restored: string[][] = []
    const git: Git = {
      ...scriptedGit([['packages/ui/app/App.tsx'], [], ['packages/ui/app/App.tsx']]),
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
    }

    await expect(
      runRun(
        baseDeps({
          store,
          git,
          buildUiBundle: async () => ({ exitCode: 0, output: 'built but dirtied source' }),
        }),
        input,
      ),
    ).rejects.toThrow('dirtied committed app source')

    expect(restored).toEqual([['packages/ui/app/App.tsx']])
    expect(store.listRuns()[0]?.status).toBe('failed')
    const event = store.listEvents('run_1').find((e) => e.type === 'ui-bundle-rebuild-clobber-blocked')
    expect(event?.data).toMatchObject({ files: ['packages/ui/app/App.tsx'], restored: true, restoreError: null })
  })

  test('headless Oscar runs as fresh captured invocations while Bob keeps his pane', async () => {
    const store = openRunStore(':memory:')
    const spawns: Array<{ persona: string; ref: SessionRef }> = []
    const sends: Array<{ ref: SessionRef; text: string }> = []
    let n = 0
    const sessionHost = fakeSessionHost({
      async spawn(opts) {
        const ref = { id: `surface:${++n}`, driver: 'fake' }
        spawns.push({ persona: opts.persona, ref })
        return ref
      },
      async sendInput(ref, text) {
        sends.push({ ref, text })
      },
    })
    const prompts: string[] = []
    const runHeadlessCalls: HeadlessRunInput[] = []
    const adapter: Adapter = {
      ...okAdapter,
      build(input) {
        prompts.push(input.prompt)
        return { command: 'headless-oscar', args: [input.prompt] }
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        sessionHost,
        getAdapter: () => adapter,
        runHeadless: async (i) => {
          runHeadlessCalls.push(i)
          return { exitCode: 0, output: `turn ${runHeadlessCalls.length - 1} complete` }
        },
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }),
      }),
      { ...input, oscar: { ...oscar, mode: 'headless' } },
    )

    expect(result.status).toBe('completed')
    expect(spawns.map((s) => s.persona)).toEqual(['bob'])
    expect(store.listSessions(result.runId).map((s) => s.persona)).toEqual(['bob'])
    expect(sends.every((send) => send.ref.id !== 'headless:oscar')).toBe(true)
    expect(runHeadlessCalls.length).toBeGreaterThanOrEqual(3)
    const headlessPrompts = runHeadlessCalls.map((call) => String(call.args[0]))
    expect(headlessPrompts[0]).toContain('/runs/run_1/directive-0.json')
    const verifyPrompt = headlessPrompts.find((prompt) => prompt.includes('/runs/run_1/verify-0.json'))
    expect(verifyPrompt).toContain('This is a FRESH session resuming an in-progress run')
    expect(verifyPrompt).toContain('directive-*.json')
    expect(verifyPrompt).not.toContain('your FIRST action in this run is to write the required')
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'spawn' && (e.data as { persona?: string }).persona === 'oscar')?.data).toEqual({
      persona: 'oscar',
      ref: 'headless:oscar',
      mode: 'headless',
    })
    expect(events.some((e) => e.type === 'wrapup-delivery-skipped' && (e.data as { reason?: string }).reason === 'headless-oscar')).toBe(true)
    expect(events.find((e) => e.type === 'verify-dispatch')?.data).toMatchObject({ ref: 'headless:oscar', atom: 0 })
  })

  test('visible or absent Oscar mode never invokes runHeadless for Oscar', async () => {
    for (const mode of [undefined, 'visible' as const]) {
      const store = openRunStore(':memory:')
      let headlessCalls = 0
      await runRun(
        baseDeps({
          store,
          io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }),
          runHeadless: async () => {
            headlessCalls += 1
            return { exitCode: 0, output: 'unexpected' }
          },
        }),
        { ...input, oscar: mode === undefined ? oscar : { ...oscar, mode } },
      )
      expect(headlessCalls, `mode ${mode ?? 'absent'}`).toBe(0)
    }
  })

  test('abort while awaiting directive ends stopped without fault or triage', async () => {
    const store = openRunStore(':memory:')
    const signal = new AbortController()
    const recordWrites: string[] = []
    const io: RunnerIO = {
      ...fakeIO({ directives: [], recordWrites }),
      async awaitDirective(_path, opts) {
        signal.abort()
        if (opts.signal?.aborted) throw new StopRequestedError()
        throw new Error('test: signal was not threaded')
      },
      async awaitTriage() {
        throw new Error('triage should not run for stop')
      },
    }

    const result = await runRun(baseDeps({ store, io, signal: signal.signal }), input)

    expect(result.status).toBe('stopped')
    expect(result.atoms).toBe(0)
    expect(store.getRun(result.runId)?.status).toBe('stopped')
    expect(recordWrites).toHaveLength(1)
    expect(store.listWorkItems(result.runId)).toEqual([])
    const events = store.listEvents(result.runId)
    expect(events.filter((e) => e.type === 'run-stopped').map((e) => e.data)).toEqual([{ atom: null }])
    expect(events.some((e) => stopFaultEvents.has(e.type))).toBe(false)
    expect(events.some((e) => e.type === 'integrated')).toBe(false)
  })

  test('abort while monitoring Bob abandons and quarantines the active atom', async () => {
    const store = openRunStore(':memory:')
    const signal = new AbortController()
    const recordWrites: string[] = []
    const restored: string[][] = []
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      changedFiles: (() => {
        let first = true
        return async () => (first ? ((first = false), []) : ['packages/half-built.ts']) // call 0 = run-start (clean)
      })(),
      async addAndCommit(_cwd, files) {
        if (files.every((file) => file.startsWith('cocoder/'))) return 'sha-history'
        throw new Error('stopped atom should not commit')
      },
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
      async show() {
        return ''
      },
    }
    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('half build')], recordWrites }),
        sessionHost: fakeSessionHost({
          async readScreen() {
            signal.abort()
            return 'working'
          },
        }),
        makeJudge: () => async () => ({ state: 'progressing' }),
        signal: signal.signal,
      }),
      input,
    )

    expect(result.status).toBe('stopped')
    expect(result.atoms).toBe(1)
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['abandoned'])
    expect(restored).toEqual([['packages/half-built.ts']])
    expect(recordWrites).toHaveLength(1)
    const events = store.listEvents(result.runId)
    expect(events.filter((e) => e.type === 'run-stopped').map((e) => e.data)).toEqual([{ atom: 0 }])
    expect(events.some((e) => e.type === 'atom-quarantined')).toBe(true)
    expect(events.some((e) => stopFaultEvents.has(e.type))).toBe(false)
    expect(events.some((e) => e.type === 'integrated')).toBe(false)
  })

  test('abort while awaiting verify abandons and quarantines the active atom', async () => {
    const store = openRunStore(':memory:')
    const signal = new AbortController()
    const recordWrites: string[] = []
    const restored: string[][] = []
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      changedFiles: (() => {
        let first = true
        return async () => (first ? ((first = false), []) : ['packages/unverified.ts']) // call 0 = run-start (clean)
      })(),
      async addAndCommit(_cwd, files) {
        if (files.every((file) => file.startsWith('cocoder/'))) return 'sha-history'
        throw new Error('stopped atom should not commit')
      },
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
      async show() {
        return ''
      },
    }
    const io: RunnerIO = {
      ...fakeIO({ directives: [delegate('needs verify')], recordWrites }),
      async awaitVerification(_path, opts) {
        signal.abort()
        if (opts.signal?.aborted) throw new StopRequestedError()
        throw new Error('test: signal was not threaded')
      },
    }

    const result = await runRun(baseDeps({ store, git, io, signal: signal.signal }), input)

    expect(result.status).toBe('stopped')
    expect(result.atoms).toBe(1)
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['abandoned'])
    expect(restored).toEqual([['packages/unverified.ts']])
    expect(recordWrites).toHaveLength(1)
    const events = store.listEvents(result.runId)
    expect(events.filter((e) => e.type === 'run-stopped').map((e) => e.data)).toEqual([{ atom: 0 }])
    expect(events.some((e) => e.type === 'atom-quarantined')).toBe(true)
    expect(events.some((e) => stopFaultEvents.has(e.type))).toBe(false)
    expect(events.some((e) => e.type === 'integrated')).toBe(false)
  })

  test('a single atom then wrap-up still works (one atom, one commit)', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(baseDeps({ store }), input)
    expect(result.atoms).toBe(1)
    expect(result.committedShas).toHaveLength(1)
    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).filter((e) => e.type === 'loop-iteration')).toHaveLength(0)
  })

  test('dispatches the wrap-up Play as a HEADLESS subprocess (no pane), pickup from its output, gate-commits its scope', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const adapterCalls: string[] = []
    const wrapBuilds: { prompt: string; model: string }[] = []
    const headlessCalls: HeadlessRunInput[] = []
    const paneSpawns: string[] = []
    const runsRoot = await mkdtemp(join(tmpdir(), 'runner-wrap-play-'))
    const wrapAdapter: Adapter = {
      id: 'cursor-agent',
      runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
      headlessCapable: true,
      build(input) {
        wrapBuilds.push({ prompt: input.prompt, model: input.model })
        return { command: 'cursor-agent', args: ['--prompt', input.prompt], stdoutPath: input.outPath }
      },
      preflight: async () => ({ ok: true, checks: [] }),
      listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
    }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts'], ['docs/wrap.md', 'packages/not-wrap.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => {
          adapterCalls.push(cli)
          return cli === 'cursor-agent' ? wrapAdapter : okAdapter
        },
        // The headless wrap-up Play must NOT open a cmux pane — it runs as a captured subprocess.
        sessionHost: fakeSessionHost({
          async spawn(opts) {
            paneSpawns.push(opts.command)
            return { id: `surface:${paneSpawns.length}`, driver: 'fake' }
          },
        }),
        runHeadless: async (i) => {
          headlessCalls.push(i)
          return { exitCode: 0, output: validFounderCloseout('PLAY CLOSEOUT') }
        },
      }),
      { ...input, runsRoot, wrapPlay, wrapPlayAssignment },
    )

    expect(adapterCalls).toContain('cursor-agent')
    expect(wrapBuilds).toHaveLength(1)
    expect(wrapBuilds[0]).toMatchObject({ model: 'cheap-wrap' })
    expect(wrapBuilds[0]?.prompt).toContain('# Wrap-up Play')
    expect(wrapBuilds[0]?.prompt).toContain(label('title'))
    expect(wrapBuilds[0]?.prompt).toMatch(/workspace run \d+ on priority demo\. 1 atom\(s\) were delegated; commits so far: sha-1\./)
    expect(wrapBuilds[0]?.prompt).toContain('Oscar seed closeout')
    // Ran headless (captured subprocess) carrying the built prompt — and NO cmux pane was spawned for it.
    expect(headlessCalls).toHaveLength(1)
    expect(headlessCalls[0]?.command).toBe('cursor-agent')
    expect(headlessCalls[0]?.args.join('\n')).toContain('# Wrap-up Play')
    expect(headlessCalls[0]?.args.join('\n')).toContain(label('title'))
    expect(paneSpawns).not.toContain('cursor-agent')
    expect(pickupWrites).toEqual([validFounderCloseout('PLAY CLOSEOUT')])
    expect(result.committedShas).toEqual(['sha-1', 'sha-2'])
    // Scope advisory: the wrap commit includes the out-of-lane file too; it's flagged, not withheld.
    expect(result.committedFiles).toEqual(['packages/atom.ts', 'docs/wrap.md', 'packages/not-wrap.ts'])
    expect(result.outOfScope).toEqual(['packages/not-wrap.ts'])
    expect(result.status).toBe('completed')
    expect(store.listCommitLinks(result.runId).map((c) => c.message)).toEqual(expect.arrayContaining([
      expect.stringMatching(new RegExp(`^demo: atom 0 via CoCoder workspace run \\d+ \\(technical id: ${result.runId}\\)$`)),
      expect.stringMatching(new RegExp(`^run-history: ${result.runId} via CoCoder workspace run \\d+ \\(technical id: ${result.runId}\\)$`)),
    ]))
    const links = store.listCommitLinks(result.runId).filter((c) => !c.message.startsWith('run-history: '))
    expect(links.map((c) => c.files)).toEqual([['packages/atom.ts'], ['docs/wrap.md', 'packages/not-wrap.ts']])
    expect(links.map((c) => c.workItemId)).toEqual([store.listWorkItems(result.runId)[0]?.id, null])
    const wrap = store.listEvents(result.runId).find((e) => e.type === 'wrapup')
    expect((wrap?.data as { play?: string }).play).toBe('wrap-up')
  })

  test('wrap-up Play output is repaired once before pickup delivery', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const outputs = ['PLAY CLOSEOUT\n', validFounderCloseout('REPAIRED PLAY CLOSEOUT')]
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: outputs.shift() ?? '' }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual([validFounderCloseout('REPAIRED PLAY CLOSEOUT')])
    const events = store.listEvents(result.runId)
    const repair = events.find((e) => e.type === 'wrapup-format-repair-attempt')
    expect(repair?.data).toMatchObject({ play: 'wrap-up', issues: expect.arrayContaining([`missing ${label('title')}`]), outPath: expect.stringContaining('wrapup-out.txt') })
    expect(events.find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
    expect(events.find((e) => e.type === 'triage-dispatch')).toBeUndefined()
  })

  test('archive-ready first-directive wrap records archive-candidate disposition with zero build atoms', async () => {
    const store = openRunStore(':memory:')
    const archiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      whatRemains: '- Nothing remains for this priority.',
      nextStep: 'Ticket: `0015` — archive the completed priority record',
      judgment: 'Oscar found no build atoms to delegate and the priority is ready to archive.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([[]]),
        io: fakeIO({ directives: [wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: archiveReadyCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(store.listEvents(result.runId).filter((e) => e.type === 'builder-dispatch')).toHaveLength(0)
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({ disposition: 'archive-candidate', buildAtoms: 0 })
    expect(result.status).toBe('awaiting-founder')
  })

  test('archive-ready wrap with a founder decision records awaiting-founder disposition', async () => {
    const store = openRunStore(':memory:')
    const founderGateCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      decisionNeeded: 'Choose the external repo for the live onboarding proof. Recommendation: use the CoBuilder copy.',
      nextStep: 'Priority: `demo` — founder chooses the live-proof target repo',
      judgment: 'Oscar stopped because the next step is founder-gated and cannot be delegated as a build atom.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: founderGateCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({ disposition: 'awaiting-founder', buildAtoms: 1 })
  })

  test('archive-ready wrap after a builder dispatch records continue disposition', async () => {
    const store = openRunStore(':memory:')
    const archiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      whatRemains: '- Nothing remains for this priority.',
      nextStep: 'Ticket: `0015` — archive the completed priority record',
      judgment: 'Oscar completed a delegated build atom, so the runner cannot treat this as an archive candidate.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: archiveReadyCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(store.listEvents(result.runId).filter((e) => e.type === 'builder-dispatch')).toHaveLength(1)
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({ disposition: 'continue', buildAtoms: 1 })
    expect(result.status).toBe('awaiting-founder')
  })

  test('validated wrap-up with a founder decision leaves the run awaiting-founder', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const founderGateCloseout = renderFounderCloseout({
      runStatus: 'continue',
      decisionNeeded: 'Choose the external repo for the live onboarding proof. Recommendation: use the CoBuilder copy.',
      nextStep: 'Priority: `demo` — founder chooses the live-proof target repo',
      judgment: 'Oscar stopped because the next step is founder-gated and cannot be delegated as a build atom.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: founderGateCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(store.getRun(result.runId)?.status).toBe('awaiting-founder')
    expect(pickupWrites).toEqual([founderGateCloseout])
    expect((store.listEvents(result.runId).find((e) => e.type === 'landing-outcome')?.data as { status?: string }).status).toBe('awaiting-founder')
    expect((store.listEvents(result.runId).find((e) => e.type === 'run-end')?.data as { status?: string }).status).toBe('awaiting-founder')
  })

  test('wrap-up Play output validation is disabled when no outputValidator is declared', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const unvalidatedWrapPlay: Play = {
      id: wrapPlay.id,
      label: wrapPlay.label,
      kind: wrapPlay.kind,
      writeScope: wrapPlay.writeScope,
      body: wrapPlay.body,
    }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: 'PLAY CLOSEOUT\n' }),
      }),
      { ...input, wrapPlay: unvalidatedWrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual(['PLAY CLOSEOUT\n'])
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('malformed wrap-up output falls back honestly and is dispatched to Deb when retry also fails', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({
          directives: [delegate('atom 0'), wrapup('Oscar seed closeout')],
          pickupWrites,
          triage: { disposition: 'cocoder-bug', summary: 'wrap-up Play emitted a malformed founder closeout', proposal: 'tighten the closeout owner' },
        }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: 'PLAY CLOSEOUT\n' }),
      }),
      { ...input, deb, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).not.toContain(block('decisionNeeded', 'None.'))
    expect(pickupWrites[0]).toContain('The orchestrator must repair and re-issue a conforming wrap-up.')
    const events = store.listEvents(result.runId)
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['wrapup-format-repair-attempt', 'wrapup-format-invalid', 'triage-dispatch', 'fault-triaged', 'wrapup', 'run-end']))
    expect(events.find((e) => e.type === 'wrapup-format-invalid')?.data).toMatchObject({ outPath: expect.stringContaining('wrapup-out-retry.txt') })
    expect(events.find((e) => e.type === 'triage-dispatch')?.data).toMatchObject({ fault: 'wrapup-format-invalid', atom: 1 })
    expect(events.find((e) => e.type === 'fault-triaged')?.data).toMatchObject({ fault: 'wrapup-format-invalid', disposition: 'cocoder-bug' })
    expect((events.find((e) => e.type === 'run-end')?.data as { status?: string }).status).toBe('failed')
  })

  test('wrap-up Play label changes are enforced from the Play contract', async () => {
    const renamedDecisionLabel = '**Founder Decision Required**'
    const renamedPlay: Play = {
      ...wrapPlay,
      body: wrapPlay.body.replace(label('decisionNeeded'), renamedDecisionLabel),
    }

    const staleStore = openRunStore(':memory:')
    const stalePickupWrites: string[] = []
    const staleResult = await runRun(
      baseDeps({
        store: staleStore,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites: stalePickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout('PLAY CLOSEOUT') }),
      }),
      { ...input, wrapPlay: renamedPlay, wrapPlayAssignment },
    )

    expect(staleResult.status).toBe('failed')
    expect(stalePickupWrites).toHaveLength(1)
    expect(stalePickupWrites[0]).toContain(`missing ${renamedDecisionLabel}`)
    const staleInvalid = staleStore.listEvents(staleResult.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(staleInvalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([`missing ${renamedDecisionLabel}`]),
    })

    const updatedCloseout = validFounderCloseout('PLAY CLOSEOUT').replace(block('decisionNeeded', 'None.'), `${renamedDecisionLabel}\nNone.`)
    const updatedStore = openRunStore(':memory:')
    const updatedPickupWrites: string[] = []
    const updatedResult = await runRun(
      baseDeps({
        store: updatedStore,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites: updatedPickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: updatedCloseout }),
      }),
      { ...input, wrapPlay: renamedPlay, wrapPlayAssignment },
    )

    expect(updatedPickupWrites).toEqual([updatedCloseout])
    expect(updatedStore.listEvents(updatedResult.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('wrap-up Play rejects ledger-shaped founder briefs even with the right headings', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const ledgerCloseout = renderFounderCloseout({
      runStatus: 'archive ready',
      summary:
        'Atom 0 (8449d5e) aligned read consumers and Atom 1 (c11d90a) proved concurrency; core 370/370, daemon 215/215, UI 126/126, and typecheck are all green, with the exact run ledger and implementation inventory included here even though the founder asked for a decision brief.',
      whatRemains: ['- Founder confirms the visual split.', '- Optional: run a migration command before archive.'].join('\n'),
      nextStep: 'Confirm the UI and/or optionally run the migration command.',
      judgment: 'Oscar stopped because the priority is code-complete.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: ledgerCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites).toHaveLength(1)
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).toContain(issue('whatChanged', 'contains ledger/test-matrix detail'))
    expect(pickupWrites[0]).toContain(issue('whatRemains', 'includes optional work'))
    expect(pickupWrites[0]).toContain(issue('nextStep', 'must not offer optional or multi-choice actions'))
    const invalid = store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(invalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([
        issue('whatChanged', 'contains ledger/test-matrix detail'),
        issue('whatRemains', 'includes optional work instead of required gaps'),
        issue('nextStep', 'must not offer optional or multi-choice actions'),
      ]),
    })
  })

  test('wrap-up Play rejects priority-ledger briefs that point back to a bare priority', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const priorityLedgerCloseout = renderFounderCloseout({
      runStatus: 'continue\nRebuild is roughly 60% done; the hard trust invariant and scaffold seeding still need wiring before onboard-existing can run safely.',
      summary:
        'The existing-repo onboarding rebuild retired the standalone executor and loader discovery surface, and authored `onboard-existing` as an ordinary Oscar-driven priority. ADR-0020 section 7 now records scaffold-seeded onboarding priorities.',
      whatRemains: [
        '- **Trust invariant (A3a):** wire the cocoder-only refuse-boundary',
        '- **Scaffold seeding (A3b):** conditionally seed onboard-existing for existing repos',
        '- **Proof harness (A4):** replace the retired executor proof script',
        '- **Live external-repo onboarding proof:** founder must authorize the billable run',
        '- **Dogfood Drift Audit:** needs its own seeded priority',
      ].join('\n'),
      nextStep: 'Priority: `demo`',
      judgment:
        'Stopped after five green atoms because the executor-to-priority pivot is structurally complete, but A3a is a delicate atom that deserves a fresh session.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: priorityLedgerCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites).toHaveLength(1)
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).toContain(issue('whatChanged', 'is too long for a founder brief'))
    expect(pickupWrites[0]).toContain(issue('whatChanged', 'must be one sentence'))
    expect(pickupWrites[0]).toContain(issue('runStatus', 'must not estimate percentage complete'))
    expect(pickupWrites[0]).toContain(issue('whatRemains', 'has too many bullets'))
    expect(pickupWrites[0]).toContain(issue('whatRemains', 'contains atom/implementation labels'))
    expect(pickupWrites[0]).toContain(issue('nextStep', 'must name the concrete focus after the priority slug'))
    const invalid = store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(invalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([
        issue('whatChanged', 'is too long for a founder brief'),
        issue('whatChanged', 'must be one sentence'),
        issue('runStatus', 'must not estimate percentage complete'),
        issue('whatRemains', 'has too many bullets'),
        issue('whatRemains', 'contains atom/implementation labels'),
        issue('nextStep', 'must name the concrete focus after the priority slug'),
      ]),
    })
  })

  test('wrap-up Play accepts an open ticket as the ready-to-run next item', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const ticketCloseout = validFounderCloseout().replace('Priority: `demo` — continue the remaining priority atoms', 'Ticket: `0015` — repair the listed orchestration bug')

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: ticketCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual([ticketCloseout])
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('wrap-up Play permits founder-facing numerals in What Remains', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const numericGapCloseout = renderFounderCloseout({
      whatRemains: [
        '- Ticket 0015 needs a follow-up launch proof.',
        '- The Oz compact setting still needs the default 3-run smoke.',
      ].join('\n'),
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: numericGapCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual([numericGapCloseout])
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('wrap-up Play blocks a Recommended Next Step priority that is not launchable', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const missingPriorityCloseout = validFounderCloseout().replace('Priority: `demo`', 'Priority: `missing-priority`')

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: missingPriorityCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites).toHaveLength(1)
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).toContain(issue('nextStep', 'priority "missing-priority" is not launchable'))
    const invalid = store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(invalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([issue('nextStep', 'priority "missing-priority" is not launchable')]),
    })
  })

  // NOTE: stale-daemon handling moved OUT of the runner (ADR-0016 incident fix). A stale daemon is now
  // refused at the daemon LAUNCHER before any run is created — see packages/daemon/tests/mutations.test.ts
  // ("refuses to launch on a stale daemon"). The runner no longer knows about staleness (the CLI
  // standalone path always loads fresh, so it can never be stale).

  test('falls back to Oscar pickup without dispatching a Play when no wrap Play is configured', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const adapterCalls: string[] = []

    const result = await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [wrapup('Oscar hand-authored pickup')], pickupWrites }),
        getAdapter: (cli) => {
          adapterCalls.push(cli)
          return okAdapter
        },
      }),
      input,
    )

    expect(result.atoms).toBe(0)
    expect(result.committedShas).toEqual([])
    expect(pickupWrites).toEqual(['Oscar hand-authored pickup'])
    expect(adapterCalls).not.toContain('cursor-agent')
    expect(store.listCommitLinks(result.runId)).toHaveLength(1)
    expect(store.listCommitLinks(result.runId)[0]).toMatchObject({ commitSha: 'sha-0', workItemId: null })
    const wrap = store.listEvents(result.runId).find((e) => e.type === 'wrapup')
    expect(wrap?.data).toEqual({ atoms: 0, forced: false })
  })

  test('visible Oscar wrap is delivered after landing outcome as the final short artifact pointer', async () => {
    const store = openRunStore(':memory:')
    const artifactWrites: Array<{ runDir: string; fileName: string; contents: string }> = []
    const sends: string[] = []

    const result = await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [wrapup('Founder closeout\nwith detail')], artifactWrites }),
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sends.push(text)
          },
        }),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(sends).toEqual(['WRAP-UP READY: read /runs/run_1/wrapup-delivery.md and follow it now.'])
    expect(sends.every((text) => !text.includes('\n'))).toBe(true)
    expect(artifactWrites.map((w) => w.fileName)).toEqual(['landing-outcome-delivery.md', 'wrapup-delivery.md'])
    expect(artifactWrites[0]?.contents).toContain('LANDING OUTCOME for run_1')
    expect(artifactWrites[1]?.contents).toMatch(/WRAP-UP READY for workspace run \d+\./)
    expect(artifactWrites[1]?.contents).toContain('Preserve the closeout headings, order, and final')
    expect(artifactWrites[1]?.contents).toContain('do not summarize, reformat, or paraphrase the closeout brief')
    expect(artifactWrites[1]?.contents).not.toContain('Deliver this founder-facing wrap-up now, in plain English')
    expect(artifactWrites[1]?.contents).toContain('**Landing Outcome**')
    expect(artifactWrites[1]?.contents).toContain('COMMITTED on `trunk`')
    expect(artifactWrites[1]?.contents).toContain('Founder closeout\nwith detail')
    const delivery = store.listEvents(result.runId).find((e) => e.type === 'wrapup-delivery-dispatch')
    expect(delivery?.data).toMatchObject({ ref: 'surface:1', path: '/runs/run_1/wrapup-delivery.md' })
  })

  test('gate-commits Oscar support files at wrap (no holdback to clear — nothing is held)', async () => {
    const store = openRunStore(':memory:')
    const oscarWithSupport = { ...oscar, writeScope: ['cocoder/priorities/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([
          ['packages/atom.ts'],
          ['cocoder/priorities/full-oz-dashboard.md'],
        ]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }),
      }),
      { ...input, oscar: oscarWithSupport },
    )

    expect(result.status).toBe('completed')
    expect(result.committedShas).toEqual(['sha-1', 'sha-2'])
    expect(result.committedFiles).toEqual(['packages/atom.ts', 'cocoder/priorities/full-oz-dashboard.md'])
    expect(result.outOfScope).toEqual([])

    const links = store.listCommitLinks(result.runId).filter((c) => !c.message.startsWith('run-history: '))
    expect(links.map((c) => c.files)).toEqual([['packages/atom.ts'], ['cocoder/priorities/full-oz-dashboard.md']])
    expect(links.map((c) => c.workItemId)).toEqual([store.listWorkItems(result.runId)[0]?.id, null])

    expect(store.listEvents(result.runId).map((e) => e.type)).toContain('oscar-support-commit')
  })

  test('per-atom commit attribution stays clean: each atom commits exactly its own changed set (incl. out-of-lane)', async () => {
    const store = openRunStore(':memory:')
    // Both atoms touch docs/leak.md out of lane; scope is advisory so each atom COMMITS its own changed
    // set — leak.md lands with each atom, flagged, and attribution never bleeds between atoms.
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([
          ['packages/a.ts', 'docs/leak.md'],
          ['packages/b.ts', 'docs/leak.md'],
        ]),
        io: fakeIO({ directives: [delegate('atom 0'), delegate('atom 1'), wrapup('done')] }),
      }),
      input,
    )
    expect(store.listCommitLinks(result.runId).filter((c) => c.workItemId !== null).map((c) => c.files)).toEqual([
      ['packages/a.ts', 'docs/leak.md'],
      ['packages/b.ts', 'docs/leak.md'],
    ])
    expect(result.outOfScope).toEqual(['docs/leak.md']) // flagged once (unioned), committed both atoms
    expect(result.status).toBe('completed')
  })

  test('atom isolation: a rejected atom\'s in-scope changes are quarantined, not committed by a later atom', async () => {
    const store = openRunStore(':memory:')
    const restored: string[][] = []
    let call = 0
    const changedPerCall = [[], ['packages/bad.ts'], ['packages/good.ts']] // [run-start clean], atom0 rejected (quarantined), atom1's work
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      async changedFiles() {
        return changedPerCall[call++] ?? []
      },
      async addAndCommit() {
        return `sha-${call}`
      },
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
      async show() {
        return ''
      },
    }
    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({
          directives: [delegate('thin'), delegate('good'), wrapup('done')],
          verdicts: [{ verdict: 'fail', reason: 'thin' }, { verdict: 'pass', reason: 'good' }],
        }),
      }),
      input,
    )
    expect(restored).toEqual([['packages/bad.ts']]) // the rejected atom's in-scope work was discarded
    expect(store.listCommitLinks(result.runId).filter((c) => c.workItemId !== null).map((c) => c.files)).toEqual([['packages/good.ts']]) // only the passing atom committed
    const quarantine = store.listEvents(result.runId).find((e) => e.type === 'atom-quarantined')!
    expect(quarantine.data).toEqual({
      atom: 0,
      files: ['packages/bad.ts'],
      quarantineDir: '/runs/run_1/quarantine/atom-0',
      recovery: { tracked: 'HEAD', untracked: '/runs/run_1/quarantine/atom-0' },
    })
  })

  test('a rejected atom commits nothing, then Oscar can delegate the next atom', async () => {
    const store = openRunStore(':memory:')
    const committed: string[] = []
    const git: Git = { ...scriptedGit([['packages/a.ts'], ['packages/b.ts']]), async addAndCommit() {
      committed.push('x')
      return `sha-${committed.length}`
    } }
    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({
          directives: [delegate('thin atom'), delegate('good atom'), wrapup('done')],
          verdicts: [{ verdict: 'fail', reason: 'too thin' }, { verdict: 'pass', reason: 'good' }],
        }),
      }),
      input,
    )
    expect(result.committedShas).toHaveLength(1) // only the passing atom is included in the run result
    expect(result.atoms).toBe(2)
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types).toContain('verify-rejected')
    const wis = store.listWorkItems(result.runId)
    expect(wis.map((w) => w.status)).toEqual(['abandoned', 'done'])
  })

  test('loop iteration events are deduped across repeated monitor samples', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-loop-'))
    let runDir = ''
    const sessionHost = fakeSessionHost({
      async readScreen() {
        await writeFile(
          join(runDir, 'loop-ledger-0.jsonl'),
          '{"iteration":1,"result":"red","failed":"criterion still red","changed":"edited x","inScope":true}',
          'utf8',
        )
        return 'working'
      },
    })
    const progressProgressDone: MakeJudge = () => {
      let samples = 0
      return async () => (++samples < 3 ? { state: 'progressing' } : { state: 'done' })
    }
    const io = fakeIO({ directives: [loopDelegate('loop atom', { maxIterations: 5 }), wrapup('done')] })
    const result = await runRun(
      baseDeps({
        store,
        sessionHost,
        makeJudge: progressProgressDone,
        execCriterion: async () => ({ exitCode: 0, output: 'green' }),
        io: {
          ...io,
          async ensureRunDir(dir) {
            runDir = dir
            await mkdir(dir, { recursive: true })
          },
        },
      }),
      { ...input, runsRoot },
    )

    const iterations = store.listEvents(result.runId).filter((e) => e.type === 'loop-iteration')
    expect(iterations).toHaveLength(1)
    expect(iterations[0]?.data).toMatchObject({ atom: 0, iteration: 1, result: 'red', failed: 'criterion still red', changed: 'edited x', inScope: true })
  })

  test('loop final flush captures an entry written just before the done sentinel', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-loop-'))
    let runDir = ''
    const sessionHost = fakeSessionHost({
      async readScreen() {
        await writeFile(
          join(runDir, 'loop-ledger-0.jsonl'),
          '{"iteration":1,"result":"green","failed":"","changed":"tests green","inScope":true}',
          'utf8',
        )
        return 'done'
      },
    })
    const io = fakeIO({ directives: [loopDelegate('loop atom'), wrapup('done')] })
    const result = await runRun(
      baseDeps({
        store,
        sessionHost,
        makeJudge: doneJudge,
        execCriterion: async () => ({ exitCode: 0, output: 'green' }),
        io: {
          ...io,
          async ensureRunDir(dir) {
            runDir = dir
            await mkdir(dir, { recursive: true })
          },
        },
      }),
      { ...input, runsRoot },
    )

    const iterations = store.listEvents(result.runId).filter((e) => e.type === 'loop-iteration')
    expect(iterations).toHaveLength(1)
    expect(iterations[0]?.data).toMatchObject({ atom: 0, iteration: 1, result: 'green', failed: '', changed: 'tests green', inScope: true })
  })

  test('loop green criterion rerun records an event before verify dispatch', async () => {
    const store = openRunStore(':memory:')
    const calls: { command: string; cwd: string }[] = []
    const result = await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [loopDelegate('loop atom', { criterion: 'pnpm test' }), wrapup('done')] }),
        execCriterion: async (command, cwd) => {
          calls.push({ command, cwd })
          return { exitCode: 0, output: 'ok' }
        },
      }),
      input,
    )

    expect(result.committedShas).toHaveLength(1)
    expect(calls).toEqual([{ command: 'pnpm test', cwd: workspaceRoot }])
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types.indexOf('loop-criterion-rerun')).toBeLessThan(types.indexOf('verify-dispatch'))
    const event = store.listEvents(result.runId).find((e) => e.type === 'loop-criterion-rerun')
    expect(event?.data).toMatchObject({ atom: 0, attempt: 1, command: 'pnpm test', exitCode: 0, pass: true, outputTail: 'ok' })
  })

  test('loop red criterion rerun nudges with a re-armed marker, then green rerun verifies', async () => {
    const store = openRunStore(':memory:')
    const sent: string[] = []
    const sentinels: string[] = []
    const doneEachMonitor: MakeJudge = ({ doneSentinel }) => {
      sentinels.push(doneSentinel)
      return async () => ({ state: 'done' })
    }
    let attempts = 0
    const result = await runRun(
      baseDeps({
        store,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        makeJudge: doneEachMonitor,
        io: fakeIO({ directives: [loopDelegate('loop atom', { maxIterations: 3, criterion: 'pnpm test' }), wrapup('done')] }),
        execCriterion: async () => (++attempts === 1 ? { exitCode: 1, output: 'first failure' } : { exitCode: 0, output: 'ok' }),
      }),
      input,
    )

    expect(result.committedShas).toHaveLength(1)
    expect(sentinels).toEqual(['<<<COCODER-ATOM-0-DONE>>>', '<<<COCODER-ATOM-0-R1-DONE>>>'])
    const rerunNudge = sent.find((text) => text.includes('LOOP CRITERION RED'))
    expect(rerunNudge).toContain('atom 0-R1')
    expect(rerunNudge).not.toContain('<<<COCODER-ATOM-0-R1-DONE>>>')
    expect(store.listEvents(result.runId).filter((e) => e.type === 'loop-criterion-rerun').map((e) => (e.data as { pass: boolean }).pass)).toEqual([false, true])
    expect(store.listEvents(result.runId).some((e) => e.type === 'verify-dispatch')).toBe(true)
  })

  test('persistent red criterion reruns cap the loop and commit nothing', async () => {
    const store = openRunStore(':memory:')
    const restored: string[][] = []
    const git: Git = {
      ...scriptedGit([['packages/bad.ts']]),
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
    }
    const doneEachMonitor: MakeJudge = () => async () => ({ state: 'done' })
    const result = await runRun(
      baseDeps({
        store,
        git,
        makeJudge: doneEachMonitor,
        io: fakeIO({ directives: [loopDelegate('loop atom', { maxIterations: 2 }), wrapup('done')] }),
        execCriterion: async () => ({ exitCode: 1, output: 'still red' }),
      }),
      input,
    )

    expect(result.committedShas).toHaveLength(0)
    expect(restored).toEqual([['packages/bad.ts']])
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['abandoned'])
    expect(store.listEvents(result.runId).filter((e) => e.type === 'loop-criterion-rerun')).toHaveLength(2)
    expect(store.listEvents(result.runId).find((e) => e.type === 'loop-capped')?.data).toMatchObject({ atom: 0, cap: 'iterations' })
  })

  test('loop wall-clock budget is not reset across red reruns', async () => {
    const store = openRunStore(':memory:')
    let t = 0
    const result = await runRun(
      baseDeps({
        store,
        makeJudge: doneJudge,
        now: () => t,
        io: fakeIO({ directives: [loopDelegate('loop atom', { maxIterations: 5, wallClockMs: 50 }), wrapup('done')] }),
        execCriterion: async () => {
          t = 60
          return { exitCode: 1, output: 'too slow' }
        },
      }),
      input,
    )

    expect(result.committedShas).toHaveLength(0)
    expect(store.listEvents(result.runId).find((e) => e.type === 'loop-capped')?.data).toMatchObject({ atom: 0, cap: 'wall-clock' })
    expect(store.listEvents(result.runId).filter((e) => e.type === 'loop-criterion-rerun')).toHaveLength(1)
  })

  test('criterion executor failure is treated as a red rerun result', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        makeJudge: doneJudge,
        io: fakeIO({ directives: [loopDelegate('loop atom'), wrapup('done')] }),
        execCriterion: async () => {
          throw new Error('spawn failed')
        },
      }),
      input,
    )

    const rerun = store.listEvents(result.runId).find((e) => e.type === 'loop-criterion-rerun')
    expect(rerun?.data).toMatchObject({ atom: 0, attempt: 1, exitCode: 1, pass: false, outputTail: 'Error: spawn failed' })
  })

  test('non-loop atom never executes a criterion', async () => {
    const store = openRunStore(':memory:')
    let calls = 0
    const result = await runRun(
      baseDeps({
        store,
        execCriterion: async () => {
          calls += 1
          return { exitCode: 1, output: 'should not run' }
        },
      }),
      input,
    )

    expect(result.committedShas).toHaveLength(1)
    expect(calls).toBe(0)
    expect(store.listEvents(result.runId).filter((e) => e.type === 'loop-criterion-rerun')).toHaveLength(0)
  })

  test('loop iteration cap blocks the atom, quarantines in-scope changes, and continues', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-loop-'))
    const restored: string[][] = []
    const sent: string[] = []
    let runDir = ''
    let changedCall = 0
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      async changedFiles() {
        // call 0 = run-start snapshot (clean); call 1 = the capped atom's work (quarantined); rest = good atom.
        const c = changedCall++
        if (c === 0) return []
        if (c === 1) return ['packages/bad.ts']
        return ['packages/good.ts']
      },
      async addAndCommit() {
        return 'sha-good'
      },
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
      async show() {
        return ''
      },
    }
    const sessionHost = fakeSessionHost({
      async readScreen() {
        await writeFile(
          join(runDir, 'loop-ledger-0.jsonl'),
          [
            'not json',
            '{"iteration":1,"result":"red","failed":"criterion still red","changed":"edited bad","inScope":true}',
          ].join('\n'),
          'utf8',
        )
        return 'still working'
      },
      async sendInput(_ref, text) {
        sent.push(text)
      },
    })
    const loopThenDone: MakeJudge = ({ atomIndex }) => async () => (atomIndex === 0 ? { state: 'progressing' } : { state: 'done' })
    const io = fakeIO({ directives: [loopDelegate('loop atom'), delegate('good atom'), wrapup('done')] })
    const result = await runRun(
      baseDeps({
        store,
        git,
        sessionHost,
        makeJudge: loopThenDone,
        io: {
          ...io,
          async ensureRunDir(dir) {
            runDir = dir
            await mkdir(dir, { recursive: true })
          },
        },
      }),
      { ...input, runsRoot },
    )

    expect(result.status).toBe('completed')
    expect(result.atoms).toBe(2)
    expect(result.committedShas).toEqual(['sha-good'])
    expect(restored).toEqual([['packages/bad.ts']])
    expect(store.listWorkItems(result.runId).map((w) => w.status)).toEqual(['abandoned', 'done'])
    const cap = store.listEvents(result.runId).find((e) => e.type === 'loop-capped')
    expect(cap?.data).toMatchObject({
      atom: 0,
      cap: 'iterations',
      ledger: [{ iteration: 1, result: 'red', failed: 'criterion still red', changed: 'edited bad', inScope: true }],
    })
    const iterations = store.listEvents(result.runId).filter((e) => e.type === 'loop-iteration')
    expect(iterations.map((e) => e.data)).toEqual([
      { atom: 0, iteration: 1, result: 'red', failed: 'criterion still red', changed: 'edited bad', inScope: true },
    ])
    expect(sent.some((text) => text.includes('BLOCKED at the loop iterations cap'))).toBe(true)
  })

  test('loop wall-clock cap is recorded distinctly from the atom timeout', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-loop-'))
    let runDir = ''
    const sessionHost = fakeSessionHost({
      async readScreen() {
        if (runDir !== '') await writeFile(join(runDir, 'loop-ledger-0.jsonl'), '', 'utf8')
        await sleep(5)
        return 'still working'
      },
    })
    const loopThenDone: MakeJudge = ({ atomIndex }) => async () => (atomIndex === 0 ? { state: 'progressing' } : { state: 'done' })
    const io = fakeIO({ directives: [loopDelegate('loop atom', { wallClockMs: 1 }), delegate('good atom'), wrapup('done')] })
    const result = await runRun(
      baseDeps({
        store,
        sessionHost,
        makeJudge: loopThenDone,
        io: {
          ...io,
          async ensureRunDir(dir) {
            runDir = dir
            await mkdir(dir, { recursive: true })
          },
        },
      }),
      { ...input, runsRoot },
    )

    expect(result.status).toBe('completed')
    const cap = store.listEvents(result.runId).find((e) => e.type === 'loop-capped')
    expect(cap?.data).toMatchObject({ atom: 0, cap: 'wall-clock', ledger: [] })
    expect(store.listEvents(result.runId).some((e) => e.type === 'builder-failed')).toBe(false)
  })

  test('backstop: too many consecutive rejects force-wraps the run with a recorded reason', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        limits: { maxConsecutiveRejects: 2 },
        io: fakeIO({
          directives: [delegate('a'), delegate('b')],
          verdicts: [{ verdict: 'fail', reason: 'no' }, { verdict: 'fail', reason: 'still no' }],
        }),
      }),
      input,
    )
    expect(result.committedShas).toHaveLength(0)
    expect(result.pickupPath).not.toBeNull()
    const wrap = store.listEvents(result.runId).find((e) => e.type === 'wrapup')
    expect((wrap?.data as { forced: boolean; reason: string }).reason).toBe('max-consecutive-rejects')
  })

  test('the monitor nudges a stuck Bob from his live progress (not a done-file)', async () => {
    const store = openRunStore(':memory:')
    const nudges: string[] = []
    // judge: stuck on the first sample, done on the second → exactly one nudge sent into Bob's pane.
    const stuckThenDone: MakeJudge = () => {
      let i = 0
      return async () => (i++ === 0 ? { state: 'stuck', nudge: 'are you blocked?' } : { state: 'done' })
    }
    await runRun(
      baseDeps({
        store,
        makeJudge: stuckThenDone,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            if (text === 'are you blocked?') nudges.push(text)
          },
        }),
      }),
      input,
    )
    expect(nudges).toEqual(['are you blocked?'])
    expect(store.listEvents(store.listRuns()[0]!.id).some((e) => e.type === 'nudge')).toBe(true)
  })

  test('Deb-backed watchdog nudges an idle Oscar while awaiting a directive only when Deb is present', async () => {
    const slowDirectiveIO = (): RunnerIO => {
      const directives = [delegate('do it'), wrapup('done')]
      let i = 0
      return {
        ...fakeIO({ directives }),
        async awaitDirective() {
          if (i === 0) await sleep(20)
          const d = directives[i++]
          if (!d) throw new Error('test: ran out of scripted directives')
          return d
        },
      }
    }
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 1000 }

    const storeWithDeb = openRunStore(':memory:')
    const result = await runRun(baseDeps({ store: storeWithDeb, io: slowDirectiveIO(), timeouts }), { ...input, deb })
    expect(result.status).toBe('completed')
    const withDebEvents = storeWithDeb.listEvents(result.runId).filter((e) => e.type === 'oscar-nudge')
    expect(withDebEvents).toHaveLength(1)
    expect(withDebEvents[0]?.data).toEqual({
      persona: 'deb',
      stage: 'directive',
      atom: 0,
      text: "You've gone quiet — write the next directive (or your verify verdict), or wrap up.",
      source: 'idle',
    })

    const storeWithoutDeb = openRunStore(':memory:')
    const noDebResult = await runRun(baseDeps({ store: storeWithoutDeb, io: slowDirectiveIO(), timeouts }), input)
    expect(noDebResult.status).toBe('completed')
    expect(storeWithoutDeb.listEvents(noDebResult.runId).some((e) => e.type === 'oscar-nudge')).toBe(false)
  })

  test('Deb triages a builder failure before the run unwinds (tier 2 disposition)', async () => {
    const store = openRunStore(':memory:')
    await expect(
      runRun(
        baseDeps({
          store,
          makeJudge: () => async () => ({ state: 'progressing' }), // never completes
          sessionHost: fakeSessionHost({ async status() {
            return { state: 'exited', code: 1 } // builder (and panes) dead → monitor returns 'dead'
          } }),
          io: fakeIO({ directives: [delegate('do it')], triage: { disposition: 'repo-bug', summary: 'the target persona is misconfigured' } }),
        }),
        { ...input, deb }, // Deb present → triage runs
      ),
    ).rejects.toThrow(/builder dead/)
    const runId = store.listRuns()[0]!.id
    const types = store.listEvents(runId).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['builder-failed', 'triage-dispatch', 'fault-triaged']))
    const triaged = store.listEvents(runId).find((e) => e.type === 'fault-triaged')
    expect((triaged?.data as { disposition: string }).disposition).toBe('repo-bug')
    expect(store.getRun(runId)?.status).toBe('failed') // Deb proposes/logs; she does not rescue the run
  })

  test('Deb triages a directive-timeout (orchestration fault), and is NOT killed before triaging', async () => {
    const store = openRunStore(':memory:')
    const killed: string[] = []
    const failingIO: RunnerIO = { ...fakeIO({ directives: [], triage: { disposition: 'cocoder-bug', summary: 'oscar never delegated', proposal: 'd' } }), async awaitDirective() {
      throw new Error('no valid directive within 1ms')
    } }
    await expect(
      runRun(baseDeps({ store, io: failingIO, sessionHost: fakeSessionHost({ async kill(ref) {
        killed.push(ref.id)
      } }) }), { ...input, deb }),
    ).rejects.toThrow(/no valid directive/)
    const types = store.listEvents(store.listRuns()[0]!.id).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['directive-timeout', 'triage-dispatch', 'fault-triaged']))
  })

  test('Deb triages a verify-failed fault (Oscar verify died)', async () => {
    const store = openRunStore(':memory:')
    const verifyDies: RunnerIO = { ...fakeIO({ directives: [delegate('do it')], triage: { disposition: 'cocoder-bug', summary: 'verify pane died', proposal: 'd' } }), async awaitVerification() {
      throw new Error('orchestrator session exited before a verdict')
    } }
    await expect(runRun(baseDeps({ store, io: verifyDies }), { ...input, deb })).rejects.toThrow(/exited before a verdict/)
    const types = store.listEvents(store.listRuns()[0]!.id).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['verify-failed', 'triage-dispatch', 'fault-triaged']))
  })

  test('without Deb, a builder failure just fails the run (no triage)', async () => {
    const store = openRunStore(':memory:')
    await expect(
      runRun(
        baseDeps({
          store,
          makeJudge: () => async () => ({ state: 'progressing' }),
          sessionHost: fakeSessionHost({ async status() {
            return { state: 'exited', code: 1 }
          } }),
          io: fakeIO({ directives: [delegate('do it')] }),
        }),
        input, // no deb
      ),
    ).rejects.toThrow(/builder dead/)
    const types = store.listEvents(store.listRuns()[0]!.id).map((e) => e.type)
    expect(types).toContain('builder-failed')
    expect(types).not.toContain('triage-dispatch')
  })

  test('portable history commit failure on a run fault does not mask the original fault', async () => {
    const store = openRunStore(':memory:')
    const git: Git = {
      ...scriptedGit([]),
      async addAndCommit() {
        throw new Error('history commit exploded')
      },
    }

    await expect(
      runRun(
        baseDeps({
          store,
          git,
          makeJudge: () => async () => ({ state: 'progressing' }),
          sessionHost: fakeSessionHost({ async status() {
            return { state: 'exited', code: 1 }
          } }),
          io: fakeIO({ directives: [delegate('do it')] }),
        }),
        input,
      ),
    ).rejects.toThrow(/builder dead/)

    const runId = store.listRuns()[0]!.id
    expect(store.getRun(runId)?.status).toBe('failed')
    expect(store.listEvents(runId).find((e) => e.type === 'portable-history-commit-failed')?.data).toMatchObject({ message: 'run-history commit failed: history commit exploded' })
  })

  test('builder pane dying mid-atom fails the run', async () => {
    const store = openRunStore(':memory:')
    await expect(
      runRun(
        baseDeps({
          store,
          // judge never says done; status reports the pane exited → monitor returns 'dead'
          makeJudge: () => async () => ({ state: 'progressing' }),
          sessionHost: fakeSessionHost({ async status() {
            return { state: 'exited', code: 1 }
          } }),
        }),
        input,
      ),
    ).rejects.toThrow(/builder dead/)
    expect(store.getRun(store.listRuns()[0]!.id)?.status).toBe('failed')
  })

  test('resumes from a prior pickup brief (continuation; F8)', async () => {
    const store = openRunStore(':memory:')
    const prompts: string[] = []
    const result = await runRun(
      baseDeps({
        store,
        getAdapter: () => ({ ...okAdapter, build: (i) => {
          prompts.push(i.prompt)
          return { command: 'x', args: [] }
        } }),
      }),
      { ...input, pickup: 'PRIOR WORK: atoms 0-2 done; start at the parser.' },
    )
    expect(result.status).toBe('completed')
    // Oscar's launch prompt carries the resume brief so a fresh session continues the work.
    expect(prompts.some((p) => p.includes('PRIOR WORK: atoms 0-2 done'))).toBe(true)
  })

  test("Oscar's launch prompt enforces the artifact-first rule (directive-timeout root cause)", async () => {
    // Runs 33/34/38/39/40 all faulted the same way: Oscar exited (or idled) without ever writing
    // directive-0.json — the prompt let "write the JSON" read as one option among several. The rule
    // makes the first artifact non-negotiable and gives a no-delegable-work fallback (wrap-up with a
    // pickup naming the missing founder input) instead of a bare exit.
    const store = openRunStore(':memory:')
    const prompts: string[] = []
    await runRun(
      baseDeps({
        store,
        getAdapter: () => ({ ...okAdapter, build: (i) => {
          prompts.push(i.prompt)
          return { command: 'x', args: [] }
        } }),
      }),
      input,
    )
    const oscarPrompt = prompts[0]!
    expect(oscarPrompt).toContain('Artifact-first rule')
    expect(oscarPrompt).toContain('your FIRST action in this run is to write the required\ndirective JSON')
    expect(oscarPrompt).toContain('never just exit')
    expect(oscarPrompt).not.toContain('"kind": "deb-investigate"')
    expect(oscarPrompt).not.toContain('formal run fault')
  })

  test("Oscar's launch prompt allows founder-directed Surface-A edits after wrap", async () => {
    const store = openRunStore(':memory:')
    const prompts: string[] = []
    await runRun(
      baseDeps({
        store,
        getAdapter: () => ({ ...okAdapter, build: (i) => {
          prompts.push(i.prompt)
          return { command: 'x', args: [] }
        } }),
      }),
      input,
    )
    const oscarPrompt = prompts[0]!
    expect(oscarPrompt).toContain('After wrap-up delivery, you are still reachable until explicit teardown')
    expect(oscarPrompt).toContain('When you choose `wrapup`, only write the\n   directive file at this stage')
    expect(oscarPrompt).toContain('do not also deliver a founder closeout in the pane')
    expect(oscarPrompt).toContain('send you a `WRAP-UP READY` artifact to deliver\n   exactly once')
    expect(oscarPrompt).toContain('make founder-directed Surface-A edits')
    expect(oscarPrompt).toContain('Do not say the run is too wrapped, read-only, or needs a new\nrun for those edits')
    expect(oscarPrompt).toContain('exec cocoder oz commit-support')
    expect(oscarPrompt).toContain('not a process/window/daemon lifecycle operation')
    expect(oscarPrompt).toContain('Base personas, base Plays, and shared standards under `packages/personas/base/**`')
    expect(oscarPrompt).toContain('do not refuse it as product code')
    expect(oscarPrompt).toContain('route it through a\nverified run or Deb repair')
    expect(oscarPrompt).not.toContain('tell the\nfounder to run `commit-support')
    expect(oscarPrompt).not.toContain('do not make file-changing edits unless the runner has')
    expect(oscarPrompt).not.toContain('This holds AFTER you wrap up')
  })

  test('Deb observer spawns in the run group without changing the commit flow', async () => {
    const spawns: string[] = []
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({ store, sessionHost: fakeSessionHost({ async spawn(opts) {
        spawns.push(opts.persona)
        return { id: `s:${spawns.length}`, driver: 'fake' }
      } }) }),
      { ...input, deb },
    )
    expect(spawns).toEqual(['oscar', 'bob', 'deb'])
    expect(result.status).toBe('completed')
    expect(store.listSessions(result.runId).map((s) => s.persona)).toEqual(['oscar', 'bob', 'deb'])
  })

  test('first-directive timeout tears down the idle standby Bob and fails the run', async () => {
    const store = openRunStore(':memory:')
    const killed: string[] = []
    const failingIO: RunnerIO = { ...fakeIO({ directives: [] }), async awaitDirective() {
      throw new Error('no valid directive within 1ms')
    } }
    await expect(
      runRun(
        baseDeps({
          store,
          io: failingIO,
          sessionHost: fakeSessionHost({ async kill(ref) {
            killed.push(ref.id)
          } }),
        }),
        input,
      ),
    ).rejects.toThrow(/no valid directive/)
    expect(killed.length).toBeGreaterThan(0) // the standby Bob was torn down
    expect(store.getRun(store.listRuns()[0]!.id)?.status).toBe('failed')
  })



  test('a self-committed rejected atom is surfaced (working-tree quarantine cannot undo it)', async () => {
    const store = openRunStore(':memory:')
    let n = 0
    // clean at launch; HEAD moves between the atom's headBefore snapshot and the post-reject check. Single
    // mode commits to the active checkout, so there is no worktree-path distinction: model the HEAD movement
    // as a call sequence — launch trunk-tip read, then atom headBefore = h0, then the post-reject check sees
    // HEAD moved (h-self), which is what the self-commit surfacing asserts.
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return (['trunk', 'h0', 'h-self'][n++] ?? 'h-self')
      },
      async changedFiles() {
        return []
      },
      async addAndCommit() {
        return 'x'
      },
      async restoreToHead() {},
      async show() {
        return ''
      },
    }
    await runRun(
      baseDeps({ store, git, io: fakeIO({ directives: [delegate('a'), wrapup('done')], verdicts: [{ verdict: 'fail', reason: 'no' }] }) }),
      input,
    )
    expect(store.listEvents(store.listRuns()[0]!.id).some((e) => e.type === 'atom-self-committed-rejected')).toBe(true)
  })

  test('triage is skipped (not falsely recorded) when Deb\'s pane is dead', async () => {
    const store = openRunStore(':memory:')
    const debDead: RunnerIO = { ...fakeIO({ directives: [delegate('do it')] }), async awaitTriage() {
      throw new Error('session exited before a triage verdict')
    } }
    await expect(
      runRun(
        baseDeps({
          store,
          io: debDead,
          makeJudge: () => async () => ({ state: 'progressing' }),
          sessionHost: fakeSessionHost({ async status() {
            return { state: 'exited', code: 1 }
          } }),
        }),
        { ...input, deb },
      ),
    ).rejects.toThrow(/builder dead/)
    const types = store.listEvents(store.listRuns()[0]!.id).map((e) => e.type)
    expect(types).toContain('triage-skipped')
    expect(types).not.toContain('fault-triaged') // never claim a verdict we didn't get
  })

  test('writes a live status feed so Deb can report concrete run state (ADR-0016)', async () => {
    const store = openRunStore(':memory:')
    const statusWrites: DebStatus[] = []
    await runRun(baseDeps({ store, io: fakeIO({ directives: [delegate('do x'), wrapup('done')], statusWrites }) }), { ...input, deb })
    // The feed only exists for a Deb-backed run, and it carries evidence (state + wait condition).
    expect(statusWrites.length).toBeGreaterThan(0)
    expect(statusWrites[0]).toMatchObject({ oscar: 'waiting', bob: 'standby', waitCondition: 'awaiting first directive' })
    expect(statusWrites.some((s) => s.bob === 'running' && s.waitCondition.includes('monitoring builder'))).toBe(true)
    expect(statusWrites.some((s) => s.oscar === 'verifying' && s.verify === 'pending')).toBe(true)
    expect(statusWrites.some((s) => s.watch.active)).toBe(true)
    expect(statusWrites.at(-1)?.oscar).toBe('wrapped')
    expect(statusWrites.at(-1)?.waitCondition).toContain('Oscar remains reachable')
    expect(statusWrites.at(-1)?.waitCondition).toContain('in-scope Surface-A edits')
    expect(statusWrites.at(-1)?.waitCondition).not.toContain('file-changing follow-ups need a new committed run path')
    const events = store.listEvents(store.listRuns()[0]!.id)
    expect(events.some((e) => e.type === 'deb-watch-started')).toBe(true)
    expect(events.some((e) => e.type === 'deb-watch-dispatch')).toBe(true)
    expect(events.some((e) => e.type === 'deb-status' && (e.data as { waitCondition?: string }).waitCondition === 'awaiting first directive')).toBe(true)
    expect(events.some((e) => e.type === 'deb-watch-stopped')).toBe(true)

    const noDebStore = openRunStore(':memory:')
    const noDebStatus: DebStatus[] = []
    await runRun(baseDeps({ store: noDebStore, io: fakeIO({ directives: [delegate('do x'), wrapup('done')], statusWrites: noDebStatus }) }), input)
    expect(noDebStatus).toHaveLength(0) // no status feed without Deb
  })

  test('Deb watch dispatches are non-blocking when Deb is silent', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({
        store,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            if (text.startsWith('DEB WATCH')) return new Promise<void>(() => {})
          },
        }),
      }),
      { ...input, deb },
    )
    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).some((e) => e.type === 'deb-watch-dispatch')).toBe(true)
  })

  test('delivers a Deb-authored nudge to Oscar (Deb advises; the runner delivers — ADR-0016)', async () => {
    const store = openRunStore(':memory:')
    const directives = [delegate('do it'), wrapup('done')]
    let i = 0
    const io: RunnerIO = {
      ...fakeIO({
        directives,
        nudge: { target: 'oscar', message: 'Oscar — ask Bob for a root-cause diagnosis', rationale: 'Bob repeated a failed command', seq: 1 },
      }),
      async awaitDirective() {
        if (i === 0) await sleep(20) // hold the first directive so the watchdog samples and delivers
        const d = directives[i++]
        if (!d) throw new Error('test: ran out of scripted directives')
        return d
      },
    }
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 }
    const result = await runRun(baseDeps({ store, io, timeouts }), { ...input, deb })
    expect(result.status).toBe('completed')
    const debNudge = store.listEvents(result.runId).find((e) => e.type === 'oscar-nudge' && (e.data as { source?: string }).source === 'deb')
    expect(debNudge).toBeTruthy()
    expect(debNudge?.data).toMatchObject({ persona: 'deb', text: 'Oscar — ask Bob for a root-cause diagnosis', source: 'deb', seq: 1 })
  })

  test('full-run Deb watcher delivers a Deb-authored nudge during Bob build', async () => {
    const store = openRunStore(':memory:')
    const debReq: NudgeRequest = { target: 'oscar', message: 'Oscar — clarify the acceptance evidence before verify', rationale: 'Bob is building and the blocker is in orchestration scope', seq: 1 }
    let samples = 0
    const sent: Array<{ ref: string; text: string }> = []
    const io: RunnerIO = {
      ...fakeIO({
        directives: [delegate('slow atom'), wrapup('done')],
        readNudge: async (nudgePath) => {
          if (!nudgePath.endsWith('deb-nudge.json')) return null
          const runId = store.listRuns()[0]?.id
          return runId && store.listEvents(runId).some((e) => e.type === 'builder-dispatch') ? debReq : null
        },
      }),
    }
    const makeSlowBuildJudge: MakeJudge = () => async () => {
      samples += 1
      if (samples < 8) {
        await sleep(2)
        return { state: 'progressing' }
      }
      return { state: 'done' }
    }
    const result = await runRun(
      baseDeps({
        store,
        io,
        makeJudge: makeSlowBuildJudge,
        sessionHost: fakeSessionHost({
          async sendInput(ref, text) {
            sent.push({ ref: ref.id, text })
          },
        }),
        timeouts: { orchestrationMs: 500, buildMs: 500, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, deb },
    )
    expect(result.status).toBe('completed')
    expect(sent).toContainEqual({ ref: 'surface:1', text: debReq.message })
    expect(sent).not.toContainEqual({ ref: 'surface:2', text: debReq.message })
    const debNudge = store.listEvents(result.runId).find((e) => e.type === 'oscar-nudge' && (e.data as { source?: string }).source === 'deb')
    expect(debNudge?.data).toMatchObject({ stage: 'watch', text: debReq.message, rationale: debReq.rationale })
    expect(store.listEvents(result.runId).some((e) => e.type === 'nudge' && String((e.data as { text?: unknown }).text).includes(debReq.message))).toBe(false)
  })

  test('delivers a fresh Oz-authored nudge to Oscar and does not redeliver the same seq', async () => {
    const store = openRunStore(':memory:')
    const directives = [delegate('do it'), wrapup('done')]
    const sent: string[] = []
    let i = 0
    const ozReq: NudgeRequest = { target: 'oscar', message: 'Oscar — ask for a concise status update', rationale: 'Founder asked for a nudge', seq: 1 }
    const io: RunnerIO = {
      ...fakeIO({ directives, nudges: { 'oz-nudge.json': ozReq } }),
      async awaitDirective() {
        if (i === 0) await sleep(25)
        const d = directives[i++]
        if (!d) throw new Error('test: ran out of scripted directives')
        return d
      },
    }
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 }
    const result = await runRun(
      baseDeps({
        store,
        io,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts,
      }),
      input,
    )
    expect(result.status).toBe('completed')
    expect(sent.filter((text) => text === ozReq.message)).toHaveLength(1)
    const ozNudges = store.listEvents(result.runId).filter((e) => e.type === 'oscar-nudge' && (e.data as { source?: string }).source === 'oz')
    expect(ozNudges).toHaveLength(1)
    expect(ozNudges[0]?.data).toMatchObject({ persona: 'oz', text: ozReq.message, source: 'oz', rationale: ozReq.rationale, seq: 1 })
  })

  test('tracks Oz and Deb nudge seqs independently across their runner delivery loops', async () => {
    const store = openRunStore(':memory:')
    const directives = [delegate('do it'), wrapup('done')]
    const sent: string[] = []
    let i = 0
    const ozReq: NudgeRequest = { target: 'oscar', message: 'Oscar — answer Oz first', rationale: 'Oz is tier 3', seq: 1 }
    const debReq: NudgeRequest = { target: 'oscar', message: 'Oscar — then handle Deb', rationale: 'Deb still has a pending diagnosis', seq: 1 }
    const io: RunnerIO = {
      ...fakeIO({ directives, nudges: { 'oz-nudge.json': ozReq, 'deb-nudge.json': debReq } }),
      async awaitDirective() {
        if (i === 0) await sleep(30)
        const d = directives[i++]
        if (!d) throw new Error('test: ran out of scripted directives')
        return d
      },
    }
    const timeouts = { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 }
    const result = await runRun(
      baseDeps({
        store,
        io,
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
        timeouts,
      }),
      { ...input, deb },
    )
    expect(result.status).toBe('completed')
    const delivered = sent.filter((text) => text === ozReq.message || text === debReq.message)
    expect(delivered).toEqual(expect.arrayContaining([ozReq.message, debReq.message]))
    expect(delivered.filter((text) => text === ozReq.message)).toHaveLength(1)
    expect(delivered.filter((text) => text === debReq.message)).toHaveLength(1)
    const nudgeEvents = store.listEvents(result.runId).filter((e) => e.type === 'oscar-nudge')
    expect(nudgeEvents.map((e) => (e.data as { source?: string }).source).filter((source) => source === 'oz' || source === 'deb')).toEqual(expect.arrayContaining(['oz', 'deb']))
    expect(nudgeEvents.find((e) => (e.data as { source?: string }).source === 'deb')?.data).toMatchObject({ text: debReq.message, seq: 1 })
  })

  test('repair mode commits everything Deb touched; out-of-lane product code is flagged, not withheld (scope advisory)', async () => {
    const store = openRunStore(':memory:')
    const debRepair = persona({ id: 'deb', cli: 'claude', writeScope: ['cocoder/**'] })
    const io: RunnerIO = {
      ...fakeIO({
        directives: [],
        triage: { disposition: 'cocoder-bug', summary: 'runner contract bug', mode: 'repair', diagnosis: 'wait condition references an unassigned file', filesChanged: ['cocoder/priorities/x.md'] },
      }),
      async awaitDirective() {
        throw new Error('no valid directive within 1ms') // the fault Deb triages + repairs
      },
    }
    // Deb edited one in-scope CoCoder file and (out of scope) one product file during her repair. The tree
    // is CLEAN at launch (first changedFiles call = the start-of-run guard/snapshot); the edits appear once
    // the repair runs.
    let repairStarted = false
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      async changedFiles() {
        if (!repairStarted) {
          repairStarted = true
          return []
        }
        return ['cocoder/priorities/x.md', 'packages/app/product.ts']
      },
      async addAndCommit() {
        return 'sha-repair'
      },
      async restoreToHead() {},
      async show() {
        return ''
      },
    }
    await expect(runRun(baseDeps({ store, io, git }), { ...input, deb: debRepair })).rejects.toThrow(/no valid directive/)
    const runId = store.listRuns()[0]!.id
    const events = store.listEvents(runId)
    const repair = events.find((e) => e.type === 'deb-repair')
    expect(repair?.data).toMatchObject({ committedSha: 'sha-repair', files: ['cocoder/priorities/x.md', 'packages/app/product.ts'], outOfScope: ['packages/app/product.ts'] })
    // The commit-gate committed BOTH files and flagged the out-of-lane one (scope advisory, never withheld).
    expect((events.find((e) => e.type === 'out-of-scope-committed')?.data as { files?: string[] })?.files).toEqual(['packages/app/product.ts'])
    expect(store.listCommitLinks(runId).filter((c) => !c.message.startsWith('run-history: ')).flatMap((c) => c.files)).toEqual([
      'cocoder/priorities/x.md',
      'packages/app/product.ts',
    ])
    expect(store.getRun(runId)?.status).toBe('failed') // a repair never rescues the run
  })

  test('a recurring fault escalates on the 2nd occurrence: Deb files a ticket, gate-committed (ADR-0016 §recurrence)', async () => {
    const store = openRunStore(':memory:')
    const debScoped = persona({ id: 'deb', cli: 'claude', writeScope: ['cocoder/**'] })
    const MSG = 'no valid directive within 1ms'
    const timeoutIO = (triage: Parameters<typeof fakeIO>[0]['triage']): RunnerIO => ({
      ...fakeIO({ directives: [], triage }),
      async awaitDirective() {
        throw new Error(MSG) // directive-timeout — same message both runs → same fingerprint
      },
    })
    const ticketFile = 'cocoder/tickets/open/0002-recurring-directive-timeout.md'
    const ticketGit = (): Git => {
      // Clean at launch (first changedFiles call = the start-of-run guard/snapshot); the ticket Deb writes
      // in her cocoder/** scope appears once she files it during triage.
      let started = false
      return {
        ...worktreeStubs,
        async headSha() {
          return 'h0'
        },
        async changedFiles() {
          if (!started) {
            started = true
            return []
          }
          return [ticketFile]
        },
        async addAndCommit() {
          return 'sha-ticket'
        },
        async restoreToHead() {},
        async show() {
          return ''
        },
      }
    }

    // 1st occurrence → one-off; records a fault-triaged carrying the fingerprint, but no recurrence yet.
    let r1 = ''
    await expect(
      runRun(
        baseDeps({ store, io: timeoutIO({ disposition: 'one-off', summary: 'first time' }), git: ticketGit(), onRunCreated: (r) => {
          r1 = r.id
        } }),
        { ...input, deb: debScoped },
      ),
    ).rejects.toThrow(/no valid directive/)
    expect(store.listEvents(r1).some((e) => e.type === 'fault-recurrence')).toBe(false)

    // 2nd occurrence (same fault) → Deb escalates with a ticket; the runner gate-commits it.
    let r2 = ''
    await expect(
      runRun(
        baseDeps({
          store,
          io: timeoutIO({ disposition: 'cocoder-bug', summary: 'recurring directive-timeout', escalation: 'ticket', ticketId: '0002' }),
          git: ticketGit(),
          onRunCreated: (r) => {
            r2 = r.id
          },
        }),
        { ...input, deb: debScoped },
      ),
    ).rejects.toThrow(/no valid directive/)
    const evs = store.listEvents(r2)
    expect((evs.find((e) => e.type === 'fault-recurrence')?.data as { occurrence?: number })?.occurrence).toBe(2)
    expect(evs.find((e) => e.type === 'deb-repair')?.data).toMatchObject({ escalation: 'ticket', ticketId: '0002', committedSha: 'sha-ticket', files: [ticketFile] })
    expect(store.listCommitLinks(r2).filter((c) => !c.message.startsWith('run-history: ')).flatMap((c) => c.files)).toEqual([ticketFile])
    expect(store.getRun(r2)?.status).toBe('failed') // escalation tracks it; the run still fails
  })

  test('preflight failure aborts before spawning and marks the run failed', async () => {
    const store = openRunStore(':memory:')
    const failing: Adapter = { ...okAdapter, preflight: async () => ({ ok: false, checks: [{ name: 'authenticated', ok: false, detail: 'not logged in' }] }) }
    await expect(runRun(baseDeps({ store, getAdapter: () => failing }), input)).rejects.toBeInstanceOf(PreflightError)
  })

  test('non-git primary root is refused before reading HEAD while git roots still launch', async () => {
    const refusedStore = openRunStore(':memory:')
    let headReached = false
    let spawnCount = 0
    const nonGit: Git = {
      ...worktreeStubs,
      async isGitRepo() {
        return false
      },
      async headSha() {
        headReached = true
        throw new Error('headSha should not be reached for a non-git primary root')
      },
      async changedFiles() {
        return []
      },
      async addAndCommit() {
        return 'sha'
      },
      async restoreToHead() {},
      async show() {
        return ''
      },
    }

    let thrown: unknown
    try {
      await runRun(
        baseDeps({
          store: refusedStore,
          git: nonGit,
          sessionHost: fakeSessionHost({ async spawn() {
            spawnCount += 1
            return { id: `surface:${spawnCount}`, driver: 'fake' }
          } }),
        }),
        input,
      )
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(DirtyWorkingTreeError)
    expect((thrown as Error).message).toContain('primary root is not a git repository - initialize it first (run `git init`)')
    const run = refusedStore.listRuns()[0]
    expect(run?.status).toBe('failed')
    expect(headReached).toBe(false)
    expect(spawnCount).toBe(0)
    expect(refusedStore.listEvents(run!.id).find((e) => e.type === 'direct-mode-refused')?.data).toEqual({ reason: 'not-a-git-repo' })

    const launchedStore = openRunStore(':memory:')
    const launched = await runRun(baseDeps({ store: launchedStore }), input)
    expect(launched.status).toBe('completed')
  })

  test('onRunCreated fires synchronously with the created run (daemon learns runId for its 202)', async () => {
    const store = openRunStore(':memory:')
    const seen: string[] = []
    const result = await runRun(baseDeps({ store, onRunCreated: (r) => seen.push(r.id) }), input)
    expect(seen).toEqual([result.runId])
  })
})
