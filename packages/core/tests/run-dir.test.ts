import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { localRunDir, resolveLocalRunDir } from '../src/runner/run-dir.js'

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
})
