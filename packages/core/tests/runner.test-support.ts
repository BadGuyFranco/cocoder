import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect } from 'vitest'
import {
  type Adapter,
  type DebStatus,
  type DebTerminalSnapshot,
  type Directive,
  type FounderCloseoutContract,
  type Git,
  type MakeJudge,
  type NudgeRequest,
  type Play,
  type PlayAssignment,
  type ResolvedPersona,
  type RunnerDeps,
  type RunnerIO,
  type RunInput,
  type SessionHost,
  type SessionRef,
  openRunStore,
  replaceFounderCloseoutCommitState,
  validatePlayOutput,
} from '../src/index.js'
import { founderStopSignalPath } from '../src/runner/founder-stop.js'

export const persona = (over: Partial<ResolvedPersona> & { id: string; cli: string }): ResolvedPersona => ({
  label: over.id,
  role: 'r',
  writeScope: [],
  body: `${over.id} body`,
  model: '',
  ...over,
})

export const oscar = persona({ id: 'oscar', cli: 'claude', writeScope: [] })
export const bob = persona({ id: 'bob', cli: 'codex', writeScope: ['packages/**'] })
export const deb = persona({ id: 'deb', cli: 'claude', writeScope: [] })
export const priority = { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'do the small thing', objective: 'do the small thing' }
export const workspaceRoot = join(tmpdir(), `cocoder-runner-unit-repo-${process.pid}`)
export const workspace = { id: 'cocoder', path: workspaceRoot, name: 'CoCoder' }

beforeAll(async () => {
  await mkdir(join(workspaceRoot, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(workspaceRoot, 'cocoder', 'tickets', 'open'), { recursive: true })
  await writeFile(join(workspaceRoot, 'cocoder', 'priorities', 'demo.md'), '# Demo\n')
  await writeFile(join(workspaceRoot, 'cocoder', 'tickets', 'open', '0015-demo-ticket.md'), '# Demo ticket\n')
})

afterAll(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const wrapPlayRaw = readFileSync(join(repoRoot, 'packages', 'personas', 'base', 'plays', 'wrap-up.md'), 'utf8')
const wrapPlayBody = wrapPlayRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
export const wrapPlay: Play = {
  id: 'wrap-up',
  label: 'Wrap-up',
  kind: 'headless',
  outputValidator: { ref: 'validators/founder-closeout' },
  writeScope: ['docs/**'],
  body: wrapPlayBody,
}
export const wrapPlayAssignment: PlayAssignment = { cli: 'cursor-agent', model: 'cheap-wrap' }

export type FounderCloseoutRole =
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
export const label = (role: FounderCloseoutRole): string => closeoutContract.labels[role]
export const issue = (role: FounderCloseoutRole, text: string): string => `${label(role)} ${text}`
export const block = (role: FounderCloseoutRole, text: string): string => `${label(role)}\n${text}`
export const renderFounderCloseout = (input: {
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
    commitState: input.commitState ?? 'Committed — 1 commit was recorded by the runner.',
    teardownReadiness: input.teardownReadiness ?? 'Standing by; teardown requires an explicit founder request.',
    judgment: input.judgment ?? 'Oscar stopped at a clean wrap-up point.',
  }
  const body = closeoutContract.orderedRoles
    .map((role) => (role === 'title' ? label(role) : block(role, content[role])))
    .join('\n\n')
  return `${body}\n\n${input.finalLine ?? closeoutContract.finalLine}\n`
}
export const validFounderCloseout = (summary = 'The requested work was completed.'): string => renderFounderCloseout({ summary })

export const validatedCloseoutContract = (): FounderCloseoutContract => {
  const result = validatePlayOutput({ play: wrapPlay, output: validFounderCloseout(), cwd: workspaceRoot })
  if (!result?.founderCloseoutContract) throw new Error('wrap-up Play did not produce a founder closeout contract')
  expect(result.issues).toEqual([])
  return result.founderCloseoutContract
}

export function fakeSessionHost(over: Partial<SessionHost> = {}): SessionHost {
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
export const worktreeStubs = {
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
  async commitsSince() {
    return []
  },
}

// Git that returns a scripted changed-file set per atom and advances HEAD on commit (so per-atom
// self-commit detection and commit attribution can be asserted).
export function scriptedGit(changedPerAtom: string[][]): Git {
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

export function recordingScriptedGit(changedPerAtom: string[][]): { readonly git: Git; readonly commits: string[][] } {
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

export const okAdapter: Adapter = {
  id: 'any',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
  headlessCapable: false,
  build: () => ({ command: 'x', args: [] }),
  preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'ok' }] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
}

// IO that scripts Oscar's directive sequence + per-atom verdicts (default: every atom passes).
export interface VerificationVerdict {
  readonly verdict: 'pass' | 'fail'
  readonly reason: string | null
  readonly ticketClose?: {
    readonly ticketId: string
    readonly resolution: string
  }
}

export const fakeIO = (opts: {
  directives: Directive[]
  verdicts?: VerificationVerdict[]
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
    ticketTitle?: string
    ticketType?: string
    ticketPriority?: string
    ticketBody?: string
  }
  /** Nudge recommendation returned for every readNudgeRequest call, unless nudges/readNudge override it. */
  nudge?: NudgeRequest | null
  /** Path-aware nudge recommendations, keyed by basename such as deb-nudge.json or oz-nudge.json. */
  nudges?: Partial<Record<'deb-nudge.json' | 'oz-nudge.json', NudgeRequest | null>>
  readNudge?: (nudgePath: string) => Promise<NudgeRequest | null>
  /** Status snapshots captured each time the runner refreshes the feed. */
  statusWrites?: DebStatus[]
  terminalSnapshotWrites?: DebTerminalSnapshot[]
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
    async writeDebTerminalSnapshot(_runDir, snapshot) {
      opts.terminalSnapshotWrites?.push(snapshot)
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
export const doneJudge: MakeJudge = () => async () => ({ state: 'done' })

export const delegate = (task: string): Directive => ({ kind: 'delegate', task })
export const askFounderContinue = (question: string): Directive => ({ kind: 'ask-founder-continue', question })
export const writePathDelegate = (task: string, writePaths: readonly string[]): Directive => ({ kind: 'delegate', task, writePaths })
export const loopDelegate = (task: string, over: Partial<NonNullable<Extract<Directive, { kind: 'delegate' }>['loop']>> = {}): Directive => ({
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
export const wrapup = (pickup: string): Directive => ({ kind: 'wrapup', pickup })
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ── WS4 Deb-watcher stall de-flake harness ──────────────────────────────────────────────────────
// The stall family used to manufacture the stall window with `await sleep(20)` in awaitDirective and
// HOPE the watcher's cadence loop (monitorCadenceMs: 1) sampled the idle Oscar screen ≥2 times inside
// that real 20ms window before the directive resolved. That is a pure event-loop-SCHEDULING race (how
// many ~1ms samples land in a real 20ms window under full-parallel load), so it flaked ~1/several
// runs — not an unpinned logical clock. This harness GATES instead of timing: the first directive
// parks until the watcher has visibly ACTED (caller-supplied predicate), and the fake Oscar screen is
// held CONSTANT only while parked — so idleStreak climbs and the stall is detected exactly once — and
// CHANGES otherwise, so no other await window (e.g. the wrap-up directive) can spuriously trip the
// idle detector. The directive releases the instant the watcher acts, making the outcome deterministic
// under any scheduling. Dispatch dedup (recordDebWatchDispatch keys by detail) guarantees the single
// constant-frame window yields exactly one dispatch.
export const gatedStallHarness = (opts: {
  directives: Directive[]
  parkDirectiveIndex?: number
  // Releases the parked directive the moment this returns true — set it to the watcher's
  // observable side effect (a recorded event, or a flag the sendInput hook flips), NEVER a timer.
  watcherActed: () => boolean
  onParkedRead?: (sample: { readonly directiveIndex: number; readonly reads: number }) => void
  statusWrites?: DebStatus[]
  terminalSnapshotWrites?: DebTerminalSnapshot[]
  sendInput?: SessionHost['sendInput']
}): { io: RunnerIO; sessionHost: SessionHost } => {
  let i = 0
  const parkDirectiveIndex = opts.parkDirectiveIndex ?? 0
  let parkedDirectiveIndex: number | null = null
  let frame = 0
  let parkedReads = 0
  const io: RunnerIO = {
    ...fakeIO({ directives: opts.directives, statusWrites: opts.statusWrites, terminalSnapshotWrites: opts.terminalSnapshotWrites }),
    async awaitDirective() {
      if (i === parkDirectiveIndex) {
        parkedDirectiveIndex = i
        while (!opts.watcherActed()) await sleep(1)
        parkedDirectiveIndex = null
      }
      const d = opts.directives[i++]
      if (!d) throw new Error('test: ran out of scripted directives')
      return d
    },
  }
  const sessionHost = fakeSessionHost({
    async readScreen() {
      // Constant ⇒ idleStreak climbs ⇒ stall detected (only while the selected directive is parked);
      // changing ⇒ Oscar looks like he's progressing ⇒ no other window trips the detector.
      if (parkedDirectiveIndex !== null) {
        parkedReads += 1
        opts.onParkedRead?.({ directiveIndex: parkedDirectiveIndex, reads: parkedReads })
        return `oscar parked (awaiting directive ${parkedDirectiveIndex})`
      }
      return `oscar working ${frame++}`
    },
    ...(opts.sendInput ? { sendInput: opts.sendInput } : {}),
  })
  return { io, sessionHost }
}
export const writeFounderStopSignal = async (runDir: string): Promise<void> => {
  await mkdir(runDir, { recursive: true })
  const path = founderStopSignalPath(runDir)
  const tempPath = `${path}.${process.pid}.tmp`
  await writeFile(tempPath, `${JSON.stringify({ kind: 'founder-stop', recordedBy: 'bob', note: 'Founder explicitly said stop.' }, null, 2)}\n`, 'utf8')
  await rename(tempPath, path)
}
export const settledCommitState = (commits = 1, flag = 'Nothing out of lane.'): string =>
  `Committed — ${commits} commit(s) on \`trunk\`; work is on the active branch by construction. ${flag}`
export const settledCloseout = (closeout: string, commits = 1, flag?: string): string =>
  replaceFounderCloseoutCommitState(closeout, validatedCloseoutContract(), settledCommitState(commits, flag))

export const baseDeps = (over: Partial<RunnerDeps>): RunnerDeps => ({
  store: openRunStore(':memory:'),
  sessionHost: fakeSessionHost(),
  git: scriptedGit([['packages/x.ts']]),
  getAdapter: () => okAdapter,
  io: fakeIO({ directives: [delegate('do it'), wrapup('resume here')] }),
  makeJudge: doneJudge,
  timeouts: { pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
  ...over,
})

export interface RecordedCommit {
  readonly files: readonly string[]
  readonly message: string
}

export function recordingWindowGit(changedPerGate: readonly (readonly string[])[], opts: { readonly failOnCommit?: number } = {}): { readonly git: Git; readonly commits: RecordedCommit[] } {
  const commits: RecordedCommit[] = []
  const shas: string[] = []
  let head = 'h0'
  let changedCall = 0
  let commitCall = 0
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
        return [...(changedPerGate[changedCall++] ?? [])]
      },
      async addAndCommit(_cwd, files, message) {
        commitCall += 1
        if (opts.failOnCommit === commitCall) throw new Error(`commit ${commitCall} failed`)
        const sha = `sha-${commitCall}`
        commits.push({ files: [...files], message })
        shas.push(sha)
        head = sha
        return sha
      },
      async restoreToHead() {},
      async show() {
        return ''
      },
      async commitsSince() {
        return [...shas]
      },
    },
  }
}

export const ticketIndex = (ticketId: string, slug: string, title: string, priorityValue: string): string => [
  '# Tickets — Index',
  '',
  '## Open',
  '',
  '| ID | Title | Type | Priority | Owner |',
  '|---|---|---|---|---|',
  `| [${ticketId}](./open/${ticketId}-${slug}.md) | ${title} | task | ${priorityValue} | CoCoder |`,
  '',
  '## Recently Closed',
  '',
  '| ID | Title | Type | Closed | Resolution |',
  '|---|---|---|---|---|',
  '',
].join('\n')

export const emptyTicketIndex = (): string => [
  '# Tickets — Index',
  '',
  '## Open',
  '',
  '| ID | Title | Type | Priority | Owner |',
  '|---|---|---|---|---|',
  '',
  '## Recently Closed',
  '',
  '| ID | Title | Type | Closed | Resolution |',
  '|---|---|---|---|---|',
  '',
].join('\n')

export const ticketMarkdown = (ticketId: string, title: string, priorityValue: string): string => [
  '---',
  `id: ${ticketId}`,
  `title: ${title}`,
  'type: task',
  'status: Open',
  `priority: ${priorityValue}`,
  'owner: CoCoder',
  'created: 2026-06-26',
  '---',
  '',
  `# ${ticketId} — ${title}`,
  '',
  'Ticket body.',
  '',
].join('\n')

export async function makeTicketWorkspace(opts: {
  readonly ticketId?: string
  readonly title?: string
  readonly priorityValue?: string
  readonly open?: boolean
  readonly order?: readonly string[]
} = {}): Promise<{ readonly root: string; readonly ticketId: string; readonly slug: string }> {
  const ticketId = opts.ticketId ?? '0003'
  const title = opts.title ?? 'Existing open'
  const slug = 'existing-open'
  const priorityValue = opts.priorityValue ?? 'demo'
  const root = await mkdtemp(join(tmpdir(), 'cocoder-in-run-close-'))
  await mkdir(join(root, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(root, 'cocoder', 'tickets', 'open'), { recursive: true })
  await mkdir(join(root, 'cocoder', 'tickets', 'closed'), { recursive: true })
  await writeFile(join(root, 'cocoder', 'priorities', 'demo.md'), '---\nid: demo\ntitle: Demo\n---\n## Objective\nDemo objective.\n')
  await writeFile(join(root, 'cocoder', 'tickets', 'INDEX.md'), opts.open === false ? emptyTicketIndex() : ticketIndex(ticketId, slug, title, priorityValue))
  await writeFile(join(root, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(opts.order ?? [ticketId], null, 2)}\n`)
  if (opts.open !== false) {
    await writeFile(join(root, 'cocoder', 'tickets', 'open', `${ticketId}-${slug}.md`), ticketMarkdown(ticketId, title, priorityValue))
  }
  return { root, ticketId, slug }
}

export const runInputFor = (root: string, over: Partial<RunInput> = {}): RunInput => ({
  ...input,
  workspace: { id: 'cocoder', path: root, name: 'CoCoder' },
  engineHome: root,
  runsRoot: join(root, 'local', 'runs'),
  ...over,
})

export async function runTestsPlaySources(root: string, opts: { readonly ref?: string; readonly createScript?: boolean } = {}): Promise<NonNullable<RunInput['playSources']>> {
  const ref = opts.ref ?? 'scripts/checks/run-tests-preflight.mjs'
  const baseDir = await mkdtemp(join(tmpdir(), 'cocoder-run-tests-play-'))
  const deltaDir = await mkdtemp(join(tmpdir(), 'cocoder-run-tests-delta-'))
  const repoPlayDir = await mkdtemp(join(tmpdir(), 'cocoder-run-tests-repo-'))
  await writeFile(
    join(baseDir, 'run-tests.md'),
    [
      '---',
      'id: run-tests',
      'label: Run tests',
      'kind: headless',
      'executionModel: hybrid',
      'triggerClass: persona-requested',
      `deterministicStep: ${ref}`,
      'allowedCallers:',
      '  - oscar',
      '  - bob',
      'writeScope: []',
      '---',
      'Run tests.',
    ].join('\n'),
    'utf8',
  )
  if (opts.createScript !== false) {
    await mkdir(dirname(join(root, ref)), { recursive: true })
    await writeFile(join(root, ref), '#!/usr/bin/env node\n', 'utf8')
  }
  return { baseDir, deltaDir, repoPlayDir }
}

// This suite drives the runner with a FAKE git over the historical opt-in isolation lineage (ADR-0023 §4):
// worktree create/land are stubbed, so the loop/verify/commit machinery is exercised without a real repo.
// The new direct-mode DEFAULT (ADR-0023 §2) is proven against LIVE git in runner-direct.test.ts.
export const input = { workspace, priority, oscar, bob, sharedStandards: 'STANDARDS', engineHome: workspaceRoot, runsRoot: '/runs' }
export const stopFaultEvents = new Set(['directive-timeout', 'builder-failed', 'verify-failed', 'triage-dispatch', 'fault-triaged', 'triage-skipped'])
