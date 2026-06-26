import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'vitest'
import type { Adapter } from '@cocoder/core'
import { latestModelFor } from '../src/latest-model.js'
import { resolveRunTarget } from '../src/run-target.js'

const execFileAsync = promisify(execFile)
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function repoWithPriority(marked: boolean): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'cocoder-run-independent-'))
  dirs.push(repo)
  await mkdir(join(repo, 'cocoder', 'priorities'), { recursive: true })
  await writeFile(
    join(repo, 'cocoder', 'priorities', 'demo.md'),
    [
      '---',
      'id: demo',
      'title: Demo',
      ...(marked ? ['independent-of-runner: true'] : []),
      '---',
      '## Objective',
      'Do the thing.',
      '',
    ].join('\n'),
  )
  return repo
}

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
