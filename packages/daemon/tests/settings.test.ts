import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { DEFAULT_SETTINGS, mergeWriteSettings, readSettings } from '../src/settings.js'

describe('daemon settings', () => {
  test('defaults Oz auto compact to three runs', () => {
    expect(DEFAULT_SETTINGS.ozAutoCompactRuns).toBe(3)
  })

  test('defaults retention to the core disabled config', () => {
    expect(DEFAULT_SETTINGS.retention).toEqual({ enabled: false, keepLastNPerWorkspace: 25 })
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
      retention: { enabled: false, keepLastNPerWorkspace: 25 },
    })
  })

  test('reads retention settings through the core resolver', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-settings-'))
    await mkdir(join(home, 'local'), { recursive: true })
    await writeFile(
      join(home, 'local', 'settings.json'),
      JSON.stringify({ pollIntervalMs: 5000, defaultWorkspaceId: null, ozAutoCompactRuns: 3, retention: { enabled: true, keepLastNPerWorkspace: 10 } }),
    )

    await expect(readSettings(home)).resolves.toEqual({
      pollIntervalMs: 5000,
      defaultWorkspaceId: null,
      ozAutoCompactRuns: 3,
      retention: { enabled: true, keepLastNPerWorkspace: 10 },
    })
  })

  test('falls back to default retention for an invalid retention blob', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-settings-'))
    await mkdir(join(home, 'local'), { recursive: true })
    await writeFile(
      join(home, 'local', 'settings.json'),
      JSON.stringify({ pollIntervalMs: 5000, defaultWorkspaceId: null, ozAutoCompactRuns: 3, retention: { enabled: 'yes', keepLastNPerWorkspace: 0 } }),
    )

    await expect(readSettings(home)).resolves.toEqual({
      pollIntervalMs: 5000,
      defaultWorkspaceId: null,
      ozAutoCompactRuns: 3,
      retention: { enabled: false, keepLastNPerWorkspace: 25 },
    })
  })

  test('patches retention only when the patch includes retention', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-settings-'))

    await expect(mergeWriteSettings(home, { retention: { enabled: true, keepLastNPerWorkspace: 10 } })).resolves.toMatchObject({
      retention: { enabled: true, keepLastNPerWorkspace: 10 },
    })
    await expect(mergeWriteSettings(home, { pollIntervalMs: 5000 })).resolves.toMatchObject({
      pollIntervalMs: 5000,
      retention: { enabled: true, keepLastNPerWorkspace: 10 },
    })
    await expect(mergeWriteSettings(home, { retention: { enabled: false, keepLastNPerWorkspace: 7 } })).resolves.toMatchObject({
      retention: { enabled: false, keepLastNPerWorkspace: 7 },
    })
  })
})
