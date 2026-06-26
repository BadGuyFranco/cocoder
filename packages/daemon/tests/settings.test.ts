import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { DEFAULT_SETTINGS, mergeWriteSettings, readSettings } from '../src/settings.js'

describe('daemon settings', () => {
  test('defaults Oz auto compact to three runs', () => {
    expect(DEFAULT_SETTINGS.ozAutoCompactRuns).toBe(3)
  })

  test('clamps Oz auto compact patches to the supported range', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-settings-'))

    await expect(mergeWriteSettings(home, { ozAutoCompactRuns: 1 })).resolves.toMatchObject({ ozAutoCompactRuns: 2 })
    await expect(mergeWriteSettings(home, { ozAutoCompactRuns: 11 })).resolves.toMatchObject({ ozAutoCompactRuns: 10 })
    await expect(mergeWriteSettings(home, { ozAutoCompactRuns: 5 })).resolves.toMatchObject({ ozAutoCompactRuns: 5 })
  })

  test('sanitizes stored Oz auto compact values when settings are read', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-settings-'))
    await mkdir(join(home, 'local'), { recursive: true })
    await writeFile(join(home, 'local', 'settings.json'), JSON.stringify({ pollIntervalMs: 5000, defaultWorkspaceId: null, ozAutoCompactRuns: 99 }))

    await expect(readSettings(home)).resolves.toEqual({
      pollIntervalMs: 5000,
      defaultWorkspaceId: null,
      ozAutoCompactRuns: 10,
      retention: { enabled: false, keepPerWorkspace: 25, sweepIntervalMs: 3_600_000 },
    })
  })

  test('retention defaults to inert N=25 / 1h when absent', () => {
    expect(DEFAULT_SETTINGS.retention).toEqual({ enabled: false, keepPerWorkspace: 25, sweepIntervalMs: 3_600_000 })
  })

  test('sanitizes stored retention config: clamps N to >=1, interval to the floor, coerces enabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-settings-'))
    await mkdir(join(home, 'local'), { recursive: true })
    // keepPerWorkspace 0 → 1 (never prune-everything); sweepIntervalMs 1000 → 60_000 floor; enabled non-bool → false.
    await writeFile(
      join(home, 'local', 'settings.json'),
      JSON.stringify({ retention: { enabled: 'yes', keepPerWorkspace: 0, sweepIntervalMs: 1000 } }),
    )
    await expect(readSettings(home)).resolves.toMatchObject({
      retention: { enabled: false, keepPerWorkspace: 1, sweepIntervalMs: 60_000 },
    })

    // A valid explicit config round-trips; a negative interval falls back to the default.
    await writeFile(
      join(home, 'local', 'settings.json'),
      JSON.stringify({ retention: { enabled: true, keepPerWorkspace: 40, sweepIntervalMs: -5 } }),
    )
    await expect(readSettings(home)).resolves.toMatchObject({
      retention: { enabled: true, keepPerWorkspace: 40, sweepIntervalMs: 3_600_000 },
    })
  })

  test('retention is PATCH-able through mergeWriteSettings (settings route can toggle the flag)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-settings-'))
    await expect(mergeWriteSettings(home, { retention: { enabled: true, keepPerWorkspace: 10, sweepIntervalMs: 120_000 } })).resolves.toMatchObject({
      retention: { enabled: true, keepPerWorkspace: 10, sweepIntervalMs: 120_000 },
    })
  })
})
