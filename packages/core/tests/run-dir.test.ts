import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { localRunDir, migrateLegacyFlatRunDirs, resolveLocalRunDir } from '../src/runner/run-dir.js'

describe('local run-dir layout', () => {
  test('localRunDir writes under the workspace namespace', () => {
    expect(localRunDir('/runs', { workspaceId: 'cocoder', id: 'run_123' })).toBe('/runs/cocoder/run_123')
  })

  test('resolveLocalRunDir prefers nested dirs, falls back to legacy flat dirs, and returns null for misses', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-run-dir-'))
    await mkdir(join(runsRoot, 'workspace-b', 'run_nested'), { recursive: true })
    await mkdir(join(runsRoot, 'run_legacy'), { recursive: true })

    expect(resolveLocalRunDir(runsRoot, 'run_nested')).toBe(join(runsRoot, 'workspace-b', 'run_nested'))
    expect(resolveLocalRunDir(runsRoot, 'run_legacy')).toBe(join(runsRoot, 'run_legacy'))
    expect(resolveLocalRunDir(runsRoot, 'run_missing')).toBeNull()
  })

  test('migrateLegacyFlatRunDirs moves known inactive flat dirs and preserves contents', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-run-dir-'))
    await mkdir(join(runsRoot, 'run_known', 'logs'), { recursive: true })
    await writeFile(join(runsRoot, 'run_known', 'logs', 'out.txt'), 'kept')

    const report = migrateLegacyFlatRunDirs(
      runsRoot,
      (runId) => (runId === 'run_known' ? 'cocoder' : null),
      () => false,
    )

    const target = join(runsRoot, 'cocoder', 'run_known')
    expect(report).toEqual({
      moved: [{ runId: 'run_known', from: join(runsRoot, 'run_known'), to: target }],
      skippedActive: [],
      skippedUnknownWorkspace: [],
      skippedTargetExists: [],
    })
    await expect(readFile(join(runsRoot, 'run_known', 'logs', 'out.txt'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(target, 'logs', 'out.txt'), 'utf8')).resolves.toBe('kept')
  })

  test('migrateLegacyFlatRunDirs skips active known flat dirs', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-run-dir-'))
    await mkdir(join(runsRoot, 'run_active'), { recursive: true })
    await writeFile(join(runsRoot, 'run_active', 'state.json'), '{"status":"running"}')

    const report = migrateLegacyFlatRunDirs(
      runsRoot,
      (runId) => (runId === 'run_active' ? 'cocoder' : null),
      () => true,
    )

    expect(report).toEqual({
      moved: [],
      skippedActive: ['run_active'],
      skippedUnknownWorkspace: [],
      skippedTargetExists: [],
    })
    await expect(readFile(join(runsRoot, 'run_active', 'state.json'), 'utf8')).resolves.toBe('{"status":"running"}')
  })

  test('migrateLegacyFlatRunDirs leaves unknown workspace namespace dirs untouched', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-run-dir-'))
    await mkdir(join(runsRoot, 'cocoder', 'run_nested'), { recursive: true })
    await writeFile(join(runsRoot, 'cocoder', 'run_nested', 'state.json'), '{"nested":true}')

    const report = migrateLegacyFlatRunDirs(
      runsRoot,
      (runId) => (runId === 'run_known' ? 'cocoder' : null),
      () => false,
    )

    expect(report).toEqual({
      moved: [],
      skippedActive: [],
      skippedUnknownWorkspace: ['cocoder'],
      skippedTargetExists: [],
    })
    await expect(readFile(join(runsRoot, 'cocoder', 'run_nested', 'state.json'), 'utf8')).resolves.toBe(
      '{"nested":true}',
    )
  })

  test('migrateLegacyFlatRunDirs skips when nested target already exists without clobbering either dir', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-run-dir-'))
    await mkdir(join(runsRoot, 'run_collision'), { recursive: true })
    await mkdir(join(runsRoot, 'cocoder', 'run_collision'), { recursive: true })
    await writeFile(join(runsRoot, 'run_collision', 'state.json'), '{"flat":true}')
    await writeFile(join(runsRoot, 'cocoder', 'run_collision', 'state.json'), '{"nested":true}')

    const report = migrateLegacyFlatRunDirs(
      runsRoot,
      (runId) => (runId === 'run_collision' ? 'cocoder' : null),
      () => false,
    )

    expect(report).toEqual({
      moved: [],
      skippedActive: [],
      skippedUnknownWorkspace: ['cocoder'],
      skippedTargetExists: ['run_collision'],
    })
    await expect(readFile(join(runsRoot, 'run_collision', 'state.json'), 'utf8')).resolves.toBe('{"flat":true}')
    await expect(readFile(join(runsRoot, 'cocoder', 'run_collision', 'state.json'), 'utf8')).resolves.toBe(
      '{"nested":true}',
    )
  })

  test('migrateLegacyFlatRunDirs is idempotent after moving flat dirs', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-run-dir-'))
    await mkdir(join(runsRoot, 'run_once'), { recursive: true })
    await writeFile(join(runsRoot, 'run_once', 'state.json'), '{"moved":true}')

    const resolveWorkspaceId = (runId: string): string | null => (runId === 'run_once' ? 'cocoder' : null)

    const firstReport = migrateLegacyFlatRunDirs(runsRoot, resolveWorkspaceId, () => false)
    const secondReport = migrateLegacyFlatRunDirs(runsRoot, resolveWorkspaceId, () => false)

    expect(firstReport.moved).toEqual([
      { runId: 'run_once', from: join(runsRoot, 'run_once'), to: join(runsRoot, 'cocoder', 'run_once') },
    ])
    expect(secondReport).toEqual({
      moved: [],
      skippedActive: [],
      skippedUnknownWorkspace: ['cocoder'],
      skippedTargetExists: [],
    })
    await expect(readFile(join(runsRoot, 'cocoder', 'run_once', 'state.json'), 'utf8')).resolves.toBe('{"moved":true}')
  })
})
