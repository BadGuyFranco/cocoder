import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  makeRunnerIO,
  openRunStore,
  type Adapter,
  type HeadlessRunInput,
  type SessionHost,
  type SessionRef,
} from '@cocoder/core'
import { runStandalone } from '../src/run.js'

const exec = promisify(execFile)
const dirs: string[] = []

const g = (cwd: string, args: readonly string[]): Promise<string> => exec('git', ['-C', cwd, ...args]).then((result) => result.stdout.trim())
const exists = (path: string): boolean => existsSync(path)

afterEach(async () => {
  process.exitCode = undefined
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const adapter: Adapter = {
  id: 'scripted',
  runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'scripted test adapter' },
  headlessCapable: true,
  build: (input) => ({ command: 'scripted-agent', args: [input.persona ?? '', input.prompt ?? ''], stdoutPath: input.outPath }),
  preflight: async () => ({ ok: true, checks: [{ name: 'scripted', ok: true, detail: 'ready' }] }),
  listModels: async () => ({ canEnumerate: true, models: ['scripted-latest'], detail: 'scripted models' }),
}

const sessionHost: SessionHost = {
  async spawn(): Promise<SessionRef> {
    throw new Error('run-independent integration test uses headless personas; no pane should spawn')
  },
  async readScreen() {
    return ''
  },
  async status() {
    return { state: 'running' }
  },
  async waitForExit() {
    return { state: 'exited', code: 0 }
  },
  async sendInput() {},
  async show() {},
  async kill() {},
  async closeSurface() {},
}

const founderCloseout = (): string => `**Founder Completion Brief**

**Atom Complete**
Yes

**Run Status**
continue

**What Changed**
The runnerless path completed through the real runner.

**Judgment:**
Oscar stopped after the scripted proof atom completed and verified. The packages/runnerless-real.ts commit landed outside its nominal lane, which is expected and correct for this runnerless integration fixture.

**What Remains**
- Continue the remaining priority hardening.

**Founder Decision Needed**
None.

**Commit State**
Committed — 1 commit was recorded by the runner.

**Recommended Next Step**
Priority: \`demo\` \u2014 continue the remaining priority atoms

**Teardown Readiness**
Standing by; teardown requires an explicit founder request.

I'm standing by...
`

async function createRepo(input: { readonly destructive: boolean; readonly seedLiveStore: boolean }): Promise<string> {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'cocoder-run-independent-real-')))
  dirs.push(repo)
  await g(repo, ['init', '-q', '-b', 'main'])
  await g(repo, ['config', 'user.email', 'test@example.com'])
  await g(repo, ['config', 'user.name', 'Test User'])
  await mkdir(join(repo, 'cocoder', 'personas'), { recursive: true })
  await mkdir(join(repo, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(repo, 'local'), { recursive: true })
  await mkdir(join(repo, 'packages'), { recursive: true })
  await writeFile(join(repo, '.gitignore'), '/local/\n')
  await writeFile(
    join(repo, 'cocoder', 'personas', 'assignments.json'),
    `${JSON.stringify({
      personas: {
        oscar: { cli: 'scripted', model: 'stale-model', mode: 'headless' },
        bob: { cli: 'scripted', model: '', mode: 'headless' },
        deb: { cli: 'scripted', model: '', enabled: false },
      },
    }, null, 2)}\n`,
  )
  await writeFile(
    join(repo, 'cocoder', 'priorities', 'demo.md'),
    [
      '---',
      'id: demo',
      'title: Demo',
      'independent-of-runner: true',
      ...(input.destructive ? ['destructive: true'] : []),
      '---',
      '## Objective',
      'Prove the runnerless path through the real runner.',
      '',
    ].join('\n'),
  )
  if (input.seedLiveStore) openRunStore(join(repo, 'local', 'cocoder.db')).close()
  await g(repo, ['add', '-A'])
  await g(repo, ['commit', '-q', '-m', 'fixture'])
  return repo
}

function artifactPath(prompt: string, name: 'directive' | 'verify'): string {
  const match = prompt.match(new RegExp('([^\\s`\'"]+' + name + '-\\d+\\.json)'))
  if (!match?.[1]) throw new Error(`scripted prompt did not include a ${name} artifact path`)
  return match[1]
}

function doneSentinel(prompt: string): string {
  const match = prompt.match(/<<<COCODER-ATOM-\d+-DONE>>>/)
  if (!match?.[0]) throw new Error('builder prompt did not include a done sentinel')
  return match[0]
}

async function runScriptedHeadless(input: HeadlessRunInput): Promise<{ readonly exitCode: number; readonly output: string }> {
  const persona = String(input.args[0] ?? '')
  const prompt = String(input.args[1] ?? '')
  if (persona === 'oscar' && prompt.includes('verify-0.json')) {
    await writeFile(artifactPath(prompt, 'verify'), JSON.stringify({ verdict: 'pass', reason: 'scripted proof passed' }, null, 2), 'utf8')
    return { exitCode: 0, output: 'verify 0 written' }
  }
  if (persona === 'oscar' && prompt.includes('directive-1.json')) {
    await writeFile(artifactPath(prompt, 'directive'), JSON.stringify({ kind: 'wrapup', pickup: 'scripted wrap-up' }, null, 2), 'utf8')
    return { exitCode: 0, output: 'directive 1 written' }
  }
  if (persona === 'oscar' && prompt.includes('directive-0.json')) {
    await writeFile(artifactPath(prompt, 'directive'), JSON.stringify({ kind: 'delegate', task: 'write the runnerless proof file' }, null, 2), 'utf8')
    return { exitCode: 0, output: 'directive 0 written' }
  }
  if (persona === 'bob') {
    await mkdir(join(input.cwd, 'packages'), { recursive: true })
    await writeFile(join(input.cwd, 'packages', 'runnerless-real.ts'), 'export const runnerlessReal = true\n', 'utf8')
    const output = `${doneSentinel(prompt)}\n`
    input.onData?.(output)
    return { exitCode: 0, output }
  }
  await mkdir(join(input.cwd, 'docs'), { recursive: true })
  await writeFile(join(input.cwd, 'docs', 'runnerless-real.md'), 'Real runnerless run completed.\n', 'utf8')
  return { exitCode: 0, output: founderCloseout() }
}

async function runIndependentReal(repo: string): Promise<{ readonly stdout: string; readonly runId: string; readonly recordPath: string }> {
  const previousCwd = process.cwd()
  let stdoutText = ''
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array): boolean => {
    stdoutText += chunk.toString()
    return true
  }) as typeof process.stdout.write)
  try {
    process.chdir(repo)
    await runStandalone('demo', undefined, undefined, undefined, {
      requireIndependentOfRunner: true,
      probeDaemonImpl: async () => ({ alive: false, port: 7878 }),
      runnerDeps: {
        getAdapter: () => adapter,
        io: makeRunnerIO(),
        makeJudge: () => async () => ({ state: 'done' }),
        runHeadless: runScriptedHeadless,
        sessionHost,
        timeouts: { orchestrationMs: 2_000, wrapupMs: 2_000, buildMs: 2_000, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      },
    })
  } finally {
    process.chdir(previousCwd)
    stdout.mockRestore()
  }
  const runId = stdoutText.match(/Run (run_\d+): completed/)?.[1]
  const recordPath = stdoutText.match(/record: (.+\/record\.md)/)?.[1]
  if (!runId || !recordPath) throw new Error(`runStandalone did not report a completed run and record path:\n${stdoutText}`)
  return { stdout: stdoutText, runId, recordPath }
}

function assertRealRunArtifacts(input: { readonly dbPath: string; readonly runId: string; readonly recordPath: string }): void {
  const runDir = dirname(input.recordPath)
  expect(exists(input.recordPath)).toBe(true)
  expect(exists(join(runDir, 'directive-0.json'))).toBe(true)
  expect(exists(join(runDir, 'verify-0.json'))).toBe(true)
  expect(exists(join(runDir, 'directive-1.json'))).toBe(true)
  expect(readFileSync(join(runDir, 'directive-0.json'), 'utf8')).toContain('write the runnerless proof file')
  expect(readFileSync(join(runDir, 'verify-0.json'), 'utf8')).toContain('scripted proof passed')
  expect(exists(input.dbPath)).toBe(true)

  const store = openRunStore(input.dbPath)
  try {
    expect(store.getRun(input.runId)?.status).toBe('completed')
    expect(store.listEvents(input.runId).map((event) => event.type)).toEqual(expect.arrayContaining([
      'builder-dispatch',
      'builder-done',
      'verify-pass',
      'wrapup',
      'run-end',
    ]))
  } finally {
    store.close()
  }
}

describe('run-independent through the real runRun', () => {
  test('non-destructive runnerless run uses the live store and real directive/verify handoff', async () => {
    const repo = await createRepo({ destructive: false, seedLiveStore: false })

    const result = await runIndependentReal(repo)

    expect(result.stdout).toContain('Run ')
    expect(await readFile(join(repo, 'packages', 'runnerless-real.ts'), 'utf8')).toContain('runnerlessReal')
    expect(result.recordPath).toBe(join(repo, 'local', 'runs', 'cocoder', result.runId, 'record.md'))
    assertRealRunArtifacts({ dbPath: join(repo, 'local', 'cocoder.db'), runId: result.runId, recordPath: result.recordPath })
    expect(process.exitCode).toBe(0)
  })

  test('destructive runnerless run uses an isolated scratch store copied from the live store', async () => {
    const repo = await createRepo({ destructive: true, seedLiveStore: true })
    const liveDbPath = join(repo, 'local', 'cocoder.db')
    const liveBefore = statSync(liveDbPath)

    const result = await runIndependentReal(repo)

    const scratchRoot = dirname(dirname(dirname(dirname(result.recordPath))))
    dirs.push(scratchRoot)
    const scratchDbPath = join(scratchRoot, 'cocoder.db')
    expect(result.recordPath).toContain('cocoder-independent-destructive-')
    expect(result.recordPath).toBe(join(scratchRoot, 'runs', 'cocoder', result.runId, 'record.md'))
    expect(await readFile(join(repo, 'packages', 'runnerless-real.ts'), 'utf8')).toContain('runnerlessReal')
    expect(exists(scratchDbPath)).toBe(true)
    expect(statSync(liveDbPath).size).toBe(liveBefore.size)
    expect(statSync(liveDbPath).mtimeMs).toBe(liveBefore.mtimeMs)
    assertRealRunArtifacts({ dbPath: scratchDbPath, runId: result.runId, recordPath: result.recordPath })
    expect(process.exitCode).toBe(0)
  })
})
