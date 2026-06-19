import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OzApi, OzEventHint } from '../electron/ipc-contract.ts'

const mocks = vi.hoisted(() => ({
  exposed: {} as { api?: OzApi },
  listeners: new Map<string, (...args: unknown[]) => void>(),
  invoke: vi.fn(),
  off: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: OzApi) => {
      mocks.exposed.api = api
    },
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      mocks.listeners.set(channel, listener)
    },
    off: mocks.off,
  },
}))

describe('preload bridge', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.exposed.api = undefined
    mocks.listeners.clear()
    mocks.invoke.mockClear()
    mocks.off.mockClear()
    await import('../electron/preload.ts')
  })

  it('exposes Oz event callbacks with only the sanitized data argument', async () => {
    const { CHANNELS } = await import('../electron/ipc-contract.ts')
    const received: OzEventHint[] = []

    const unsubscribe = mocks.exposed.api!.onOzEvent!((event) => received.push(event))
    const hint: OzEventHint = { type: 'run-created', runId: 'run_1', workspaceId: 'cocoder', ts: '2026-06-12T00:00:00.000Z' }
    mocks.listeners.get(CHANNELS.ozEvent)!({ sender: 'ipc-event' }, hint)

    expect(received).toEqual([hint])
    unsubscribe()
    expect(mocks.off).toHaveBeenCalledWith(CHANNELS.ozEvent, mocks.listeners.get(CHANNELS.ozEvent))
  })

  it('routes workspace picker and validation through typed IPC channels', async () => {
    const { CHANNELS } = await import('../electron/ipc-contract.ts')

    await mocks.exposed.api!.workspaceDirectoryPick()
    await mocks.exposed.api!.workspacePrimaryRootValidate('/repo')

    expect(mocks.invoke).toHaveBeenCalledWith(CHANNELS.workspaceDirectoryPick)
    expect(mocks.invoke).toHaveBeenCalledWith(CHANNELS.workspacePrimaryRootValidate, '/repo')
  })
})
