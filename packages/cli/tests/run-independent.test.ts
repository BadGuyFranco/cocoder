import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Adapter, RunnerDeps, RunInput, RunResult } from '@cocoder/core'
import { latestModelFor } from '../src/latest-model.js'
import { main } from '../src/run.js'
import { resolveRunTarget } from '../src/run-target.js'

const execFileAsync = promisify(execFile)
const dirs: string[] = []

afterEach(async () => {
  process.exitCode = undefined
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function repoWithPriority(marked: boolean, destructive = false): Promise<string> {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'cocoder-run-independent-')))
  dirs.push(repo)
  await mkdir(join(repo, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(repo, 'local'), { recursive: true })
  await writeFile(
    join(repo, 'cocoder', 'priorities', 'demo.md'),
    [
      '---',
      'id: demo',
      'title: Demo',
      ...(marked ? ['independent-of-runner: true'] : []),
      ...(destructive ? ['destructive: true'] : []),
      '---',
      '## Objective',
      'Do the thing.',
      '',
    ].join('\n'),
  )
  return repo
}

async function writeAssignments(repo: string): Promise<void> {
  await mkdir(join(repo, 'cocoder', 'personas'), { recursive: true })
  await writeFile(
    join(repo, 'cocoder', 'personas', 'assignments.json'),
    `${JSON.stringify({
      personas: {
        oscar: { cli: 'claude', model: 'stale-pinned-model' },
        bob: { cli: 'codex', model: '' },
      },
    }, null, 2)}\n`,
  )
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

function modelAdapter(models: readonly string[]): Adapter {
  return {
    id: 'test-cli',
    runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test' },
    headlessCapable: true,
    build: () => ({ command: 'test-cli', args: [] }),
    preflight: async () => ({ ok: true, checks: [] }),
    listModels: async () => ({ canEnumerate: true, models, detail: 'test models' }),
  }
}

function completedRun(input: RunInput): RunResult {
  return {
    runId: 'run_test',
    status: 'completed',
    ticketCloseDecision: 'none',
    committedSha: null,
    committedShas: [],
    committedFiles: [],
    outOfScope: [],
    selfCommitted: false,
    atoms: 0,
    pickupPath: null,
    recordPath: join(input.runsRoot, 'record.md'),
  }
}

async function runCliIndependent(repo: string, seen: Array<{ readonly deps: RunnerDeps; readonly input: RunInput }>, args: readonly string[] = []): Promise<{ readonly probeCalls: number }> {
  const previousArgv = process.argv
  const previousCwd = process.cwd()
  let probeCalls = 0
  try {
    process.chdir(repo)
    process.argv = [process.execPath, 'cocoder', 'run-independent', 'demo', ...args]
    await main({
      probeDaemonImpl: async () => {
        probeCalls += 1
        return { alive: false, port: 7878 }
      },
      runStandaloneOptions: {
        runRunImpl: async (deps, input) => {
          seen.push({ deps, input })
          return completedRun(input)
        },
      },
    })
    return { probeCalls }
  } finally {
    process.argv = previousArgv
    process.chdir(previousCwd)
  }
}

describe('cocoder run-independent', () => {
  test('latestModelFor returns the adapter list first entry', async () => {
    await expect(latestModelFor(modelAdapter(['opus', 'sonnet', 'haiku']))).resolves.toBe('opus')
  })

  test('latestModelFor refuses an adapter with no latest model', async () => {
    await expect(latestModelFor(modelAdapter([]))).rejects.toThrow('did not report a latest model')
  })

  test('destructive run-independent resolves to scratch state and copies the live store', async () => {
    const repo = await repoWithPriority(true)
    const local = join(repo, 'local')
    await mkdir(local, { recursive: true })
    await writeFile(join(local, 'cocoder.db'), 'db')
    await writeFile(join(local, 'cocoder.db-wal'), 'wal')
    await writeFile(join(local, 'cocoder.db-shm'), 'shm')

    const target = await resolveRunTarget({
      root: repo,
      priority: { destructive: true },
      requireIndependentOfRunner: true,
    })
    if (target.scratchRoot) dirs.push(target.scratchRoot)

    expect(target.isolated).toBe(true)
    expect(target.dbPath).not.toBe(join(repo, 'local', 'cocoder.db'))
    expect(target.runsRoot).not.toBe(join(repo, 'local', 'runs'))
    expect(target.scratchRoot).not.toBeNull()
    expect(await readFile(target.dbPath, 'utf8')).toBe('db')
    expect(await readFile(`${target.dbPath}-wal`, 'utf8')).toBe('wal')
    expect(await readFile(`${target.dbPath}-shm`, 'utf8')).toBe('shm')
    expect(target.copiedStoreFiles).toEqual([
      join(repo, 'local', 'cocoder.db'),
      join(repo, 'local', 'cocoder.db-wal'),
      join(repo, 'local', 'cocoder.db-shm'),
    ])
  })

  test('non-destructive run-independent and normal run use live state paths', async () => {
    const repo = await repoWithPriority(true)
    const liveDbPath = join(repo, 'local', 'cocoder.db')
    const liveRunsRoot = join(repo, 'local', 'runs')

    await expect(resolveRunTarget({
      root: repo,
      priority: { destructive: false },
      requireIndependentOfRunner: true,
    })).resolves.toMatchObject({ dbPath: liveDbPath, runsRoot: liveRunsRoot, isolated: false, scratchRoot: null })

    await expect(resolveRunTarget({
      root: repo,
      priority: { destructive: true },
      requireIndependentOfRunner: false,
    })).resolves.toMatchObject({ dbPath: liveDbPath, runsRoot: liveRunsRoot, isolated: false, scratchRoot: null })
  })

  test('destructive scratch run-independent skips the live-store daemon guard and threads latest model plus scratch state', async () => {
    const repo = await repoWithPriority(true, true)
    await writeAssignments(repo)
    const seen: Array<{ readonly deps: RunnerDeps; readonly input: RunInput }> = []

    const result = await runCliIndependent(repo, seen)

    expect(result.probeCalls).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.input.oscar).toMatchObject({ cli: 'claude', model: 'opus' })
    expect(seen[0]!.input.bob).toMatchObject({ cli: 'codex', model: '' })
    expect(seen[0]!.input.priority).toMatchObject({ id: 'demo', independentOfRunner: true, destructive: true })
    expect(seen[0]!.input.runsRoot).not.toBe(join(repo, 'local', 'runs'))
    expect(dirname(seen[0]!.input.runsRoot)).toContain('cocoder-independent-destructive-')
    expect(await exists(join(dirname(seen[0]!.input.runsRoot), 'cocoder.db'))).toBe(true)
    expect(await exists(join(repo, 'local', 'cocoder.db'))).toBe(false)
    expect(process.exitCode).toBe(0)
  })

  test('daemon-down run-independent keeps non-destructive state live and resolves Oscar latest', async () => {
    const repo = await repoWithPriority(true)
    await writeAssignments(repo)
    const seen: Array<{ readonly deps: RunnerDeps; readonly input: RunInput }> = []

    const result = await runCliIndependent(repo, seen)

    expect(result.probeCalls).toBe(1)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.input.oscar.model).toBe('opus')
    expect(seen[0]!.input.priority).toMatchObject({ id: 'demo', independentOfRunner: true, destructive: false })
    expect(seen[0]!.input.runsRoot).toBe(join(repo, 'local', 'runs'))
    expect(await exists(join(repo, 'local', 'cocoder.db'))).toBe(true)
    expect(process.exitCode).toBe(0)
  })

  test('refuses non-destructive run-independent when a daemon owns the live store before opening the DB', async () => {
    const repo = await repoWithPriority(true)
    const previousArgv = process.argv
    const previousCwd = process.cwd()
    const errors: string[] = []
    const exit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit:${String(code)}`)
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation((message?: unknown): void => {
      errors.push(String(message))
    })

    try {
      process.chdir(repo)
      process.argv = [process.execPath, 'cocoder', 'run-independent', 'demo']
      await expect(main({
        probeDaemonImpl: async () => ({ alive: true, port: 7878 }),
        runStandaloneOptions: {
          runRunImpl: async () => {
            throw new Error('runRun must not start when the daemon is live')
          },
        },
      })).rejects.toThrow('process.exit:1')
    } finally {
      process.argv = previousArgv
      process.chdir(previousCwd)
      exit.mockRestore()
      consoleError.mockRestore()
    }

    const message = errors.join('\n')
    expect(message).toContain('live store')
    expect(message).toContain('local/cocoder.db')
    expect(message).toContain("single-writer lock")
    expect(message).toContain('Stop the daemon')
    expect(message).toContain('--force')
    expect(await exists(join(repo, 'local', 'cocoder.db'))).toBe(false)
  })

  test('--force logs a warning and proceeds past a live daemon guard', async () => {
    const repo = await repoWithPriority(true)
    await writeAssignments(repo)
    const seen: Array<{ readonly deps: RunnerDeps; readonly input: RunInput }> = []
    const errors: string[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation((message?: unknown): void => {
      errors.push(String(message))
    })
    const previousArgv = process.argv
    const previousCwd = process.cwd()

    try {
      process.chdir(repo)
      process.argv = [process.execPath, 'cocoder', 'run-independent', 'demo', '--force']
      await main({
        probeDaemonImpl: async () => ({ alive: true, port: 7878 }),
        runStandaloneOptions: {
          runRunImpl: async (deps, input) => {
            seen.push({ deps, input })
            return completedRun(input)
          },
        },
      })
    } finally {
      process.argv = previousArgv
      process.chdir(previousCwd)
      consoleError.mockRestore()
    }

    expect(seen).toHaveLength(1)
    expect(errors.join('\n')).toContain('WARNING')
    expect(errors.join('\n')).toContain('single-writer lock')
    expect(process.exitCode).toBe(0)
  })

  test('refuses a priority that is not explicitly marked independent-of-runner', async () => {
    const repo = await repoWithPriority(false)
    const cli = fileURLToPath(new URL('../bin/cocoder.mjs', import.meta.url))

    const run = execFileAsync(process.execPath, [cli, 'run-independent', 'demo'], { cwd: repo }).catch((err: unknown) => err)

    await expect(run).resolves.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('not marked independent-of-runner: true'),
    })
  })
})
