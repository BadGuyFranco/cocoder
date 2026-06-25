import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomSentinel, type Adapter, type Git, type HeadlessRunInput, type RunnerIO, type RunStore, type SessionHost } from '@cocoder/core'
import { createOzServer, type OzServer } from '../../src/index.js'
import { validFounderCloseout } from './founder-closeout.js'

const okAdapter: Adapter = {
  id: 'fake',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'fake' },
  headlessCapable: false,
  build: () => ({ command: 'fake-cli', args: [] }),
  preflight: async () => ({ ok: true, checks: [] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'fake' }),
}

export interface DaemonReloadServerOptions {
  readonly home: string
  readonly store: RunStore
  readonly git: Git
  readonly io: RunnerIO
  readonly buildDaemonForReload: (input: { readonly cwd: string; readonly timeoutMs: number }) => Promise<{ readonly exitCode: number; readonly output: string }>
  readonly restartDaemon: () => void
}

export async function makeDaemonReloadServer(opts: DaemonReloadServerOptions): Promise<OzServer> {
  return await createOzServer({
    cocoderHome: opts.home,
    port: 0,
    store: opts.store,
    git: opts.git,
    sessionHost: fakeHost(),
    getAdapter: () => okAdapter,
    io: opts.io,
    runHeadless: headlessBobOk,
    buildDaemonForReload: opts.buildDaemonForReload,
    restartDaemon: opts.restartDaemon,
  })
}

export async function writeInstallFixture(home: string, workspaceIds: readonly string[]): Promise<void> {
  await mkdir(join(home, 'local'), { recursive: true })
  const workspaces = []
  for (const id of workspaceIds) {
    const path = id === 'cocoder' ? home : join(home, `${id}-workspace`)
    await writeWorkspace(path)
    workspaces.push({ id, name: id === 'cocoder' ? 'CoCoder' : 'External', path: id === 'cocoder' ? '${COCODER_HOME}' : path })
  }
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces }))
}

export function fakeGitChangedByCwd(changesByCwd: Readonly<Record<string, readonly (readonly string[])[]>>): Git {
  const calls = new Map<string, number>()
  return {
    async isGitRepo() { return true },
    async initRepo() {},
    async headSha() { return 'sha-boot' },
    async currentBranch() { return 'trunk' },
    async changedFiles(cwd) {
      const sequence = changesByCwd[cwd] ?? [[]]
      const call = calls.get(cwd) ?? 0
      calls.set(cwd, call + 1)
      return [...(sequence[Math.min(call, sequence.length - 1)] ?? [])]
    },
    async addAndCommit() { return 'sha-commit' },
    async restoreToHead() {},
    async show() { return 'diff' },
    async worktreeAdd() {},
    async worktreeRemove() {},
    async listWorktrees() { return [] },
    async resetHard() {},
    async hasUpstream() { return false },
    async push() { return { ok: true, detail: '' } },
    async commitsSince() { return [] },
  }
}

export function atomThenWrapIO(): RunnerIO {
  const callsByRun = new Map<string, number>()
  return {
    ...baseIO(),
    async awaitDirective(path) {
      const runId = runIdFromPath(path)
      const calls = callsByRun.get(runId) ?? 0
      callsByRun.set(runId, calls + 1)
      return calls === 0 ? { kind: 'delegate', task: 'touch runtime' } : { kind: 'wrapup', pickup: 'done' }
    },
  }
}

export function designatedBlockedRunIO(): { readonly runnerIO: RunnerIO; blockRun(runId: string): void; releaseBlockedRun(): void } {
  const callsByRun = new Map<string, number>()
  let designated: string | null = null
  let designate: (() => void) | null = null
  let release: (() => void) | null = null
  const designatedReady = new Promise<void>((resolve) => { designate = resolve })
  const released = new Promise<void>((resolve) => { release = resolve })
  return {
    runnerIO: {
      ...baseIO(),
      async awaitDirective(path) {
        const runId = runIdFromPath(path)
        const calls = callsByRun.get(runId) ?? 0
        callsByRun.set(runId, calls + 1)
        await designatedReady
        if (runId === designated) {
          await released
          return { kind: 'wrapup', pickup: 'external done' }
        }
        return calls === 0 ? { kind: 'delegate', task: 'touch daemon runtime' } : { kind: 'wrapup', pickup: 'daemon done' }
      },
    },
    blockRun(runId) {
      designated = runId
      designate?.()
    },
    releaseBlockedRun() {
      release?.()
    },
  }
}

async function writeWorkspace(path: string): Promise<void> {
  await mkdir(join(path, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(path, 'cocoder', 'personas'), { recursive: true })
  await writeFile(join(path, 'cocoder', 'priorities', 'demo.md'), '---\nid: demo\ntitle: Demo\n---\n\n## Objective\n\nDo the thing.\n')
  await writeFile(join(path, 'cocoder', 'personas', 'assignments.json'), JSON.stringify({ personas: { oscar: { cli: 'fake', model: '' }, bob: { cli: 'fake', model: '', mode: 'headless' } } }))
}

function baseIO(): RunnerIO {
  return {
    async ensureRunDir(runDir) { await mkdir(runDir, { recursive: true }) },
    async awaitDirective() { return { kind: 'wrapup', pickup: 'done' } },
    async awaitVerification() { return { verdict: 'pass', reason: 'verified' } },
    async awaitTriage() { return { disposition: 'one-off', summary: 'n/a', mode: 'propose' } },
    async writeFaultContext() {},
    async writeDisposition(runDir, index) { return `${runDir}/disposition-${index}.md` },
    async writeDebStatus() {},
    async writeDebTerminalSnapshot() {},
    async readNudgeRequest() { return null },
    async writePickup(runDir) { return `${runDir}/pickup.md` },
    async writeRunArtifact(runDir, fileName, contents) {
      await mkdir(runDir, { recursive: true })
      const path = join(runDir, fileName)
      await writeFile(path, contents, 'utf8')
      return path
    },
    async writeRunRecord(runDir) { return `${runDir}/record.md` },
  }
}

function fakeHost(): SessionHost {
  let n = 0
  return {
    async spawn() { return { id: `surface:${++n}`, driver: 'fake' } },
    async readScreen() { return '' },
    async status() { return { state: 'exited', code: 0 } },
    async waitForExit() { return { state: 'exited', code: 0 } },
    async sendInput() {},
    async show() {},
    async kill() {},
    async closeSurface() {},
  }
}

const headlessBobOk = async (input: HeadlessRunInput): Promise<{ readonly exitCode: number; readonly output: string }> => {
  if (input.outPath.includes('bob-turn')) {
    const output = `implemented runtime edit\n${atomSentinel(0)}`
    input.onData?.(output)
    return { exitCode: 0, output }
  }
  return { exitCode: 0, output: validFounderCloseout() }
}

function runIdFromPath(path: string): string {
  const match = /(?:^|[/\\])(run_[^/\\]+)(?:[/\\]|$)/.exec(path)
  if (!match) throw new Error(`could not find run id in path: ${path}`)
  return match[1]
}
