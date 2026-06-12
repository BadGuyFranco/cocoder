import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OzApi, OzEventHint } from '../electron/ipc-contract.ts'

const exposed: { api?: OzApi } = {}
const listeners = new Map<string, (...args: unknown[]) => void>()
const off = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: OzApi) => {
      exposed.api = api
    },
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      listeners.set(channel, listener)
    },
    off,
  },
}))

describe('preload bridge', () => {
  beforeEach(async () => {
    vi.resetModules()
    exposed.api = undefined
    listeners.clear()
    off.mockClear()
    await import('../electron/preload.ts')
  })

  it('exposes Oz event callbacks with only the sanitized data argument', async () => {
    const { CHANNELS } = await import('../electron/ipc-contract.ts')
    const received: OzEventHint[] = []

    const unsubscribe = exposed.api!.onOzEvent!((event) => received.push(event))
    const hint: OzEventHint = { type: 'run-created', runId: 'run_1', workspaceId: 'cocoder', ts: '2026-06-12T00:00:00.000Z' }
    listeners.get(CHANNELS.ozEvent)!({ sender: 'ipc-event' }, hint)

    expect(received).toEqual([hint])
    unsubscribe()
    expect(off).toHaveBeenCalledWith(CHANNELS.ozEvent, listeners.get(CHANNELS.ozEvent))
  })
})
