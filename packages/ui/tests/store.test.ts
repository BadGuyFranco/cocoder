// @vitest-environment node
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../electron/ipc-contract.ts'
import { getSettings, getWindowBounds, initStore, setSettings, setWindowBounds } from '../electron/store.ts'

describe('main-process JSON store', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oz-store-'))
    initStore(dir)
  })

  it('round-trips window bounds through oz-store.json', async () => {
    expect(getWindowBounds()).toBeNull()

    setWindowBounds({ x: 42, y: 84, width: 1440, height: 900 })
    initStore(dir)

    expect(getWindowBounds()).toEqual({ x: 42, y: 84, width: 1440, height: 900 })
    await expect(readFile(join(dir, 'oz-store.json'), 'utf8')).resolves.toContain('"windowBounds"')
  })

  it('round-trips renderer preferences with panelRatio default and nested merges', () => {
    expect(getSettings().preferences.panelRatio).toBe(0.45)

    setSettings({ preferences: { ...DEFAULT_SETTINGS.preferences, theme: 'light', panelRatio: 0.61 } })
    setSettings({ preferences: { sound: true } })
    initStore(dir)

    expect(getSettings().preferences).toEqual({ theme: 'light', sound: true, sendOnEnter: true, panelRatio: 0.61 })
  })
})
