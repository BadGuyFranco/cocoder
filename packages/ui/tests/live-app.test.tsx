// Live-path component test: inject a MOCK window.oz that returns the daemon-shaped fixtures captured
// from the real daemon, render <App/>, and prove the renderer switches off seed onto adapted live data
// (the connection indicator flips to "Live" and real daemon priority titles render). This exercises the
// whole live chain — health switch → loadWsData → adapter → renderer — without touching a real daemon.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { App } from '../app/App.tsx'
import workspacesFx from '../fixtures/workspaces.json'
import prioritiesFx from '../fixtures/priorities.json'
import personasFx from '../fixtures/personas.json'
import runsFx from '../fixtures/runs.json'
import runDetailFx from '../fixtures/run-detail.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = (data: any) => ({ ok: true, status: 200, data })

function mockOz() {
  return {
    health: async () => ({ state: 'connected', sha: 'deadbeef' }),
    settingsGet: async () => ({ pollIntervalMs: 2500, defaultWorkspaceId: null }),
    settingsSet: async (p: unknown) => p,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    daemonGet: async (path: string): Promise<any> => {
      if (path === '/workspaces') return ok(workspacesFx)
      if (/\/priorities$/.test(path)) return ok(prioritiesFx)
      if (/\/personas$/.test(path)) return ok(personasFx)
      if (path.startsWith('/runs?')) return ok(runsFx)
      if (/^\/runs\/[^/]+$/.test(path)) return ok(runDetailFx)
      return { ok: false, status: 404, error: `no mock for ${path}` }
    },
    daemonPost: async () => ok({}),
    daemonPut: async () => ok({}),
    chatSend: async () => ({ role: 'oz', text: '', at: 0 }),
    prioritiesReorder: async (_ws: string, order: readonly string[]) => order,
    prioritiesOrder: async () => [],
  }
}

describe('Oz renderer — live daemon path', () => {
  beforeEach(() => { (window as unknown as { oz: unknown }).oz = mockOz() })
  afterEach(() => { cleanup(); delete (window as unknown as { oz?: unknown }).oz })

  it('switches off seed onto live data: shows "Live" and a real daemon priority title', async () => {
    render(<App />)
    // The connection indicator flips to Live once health resolves.
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    // A non-ad-hoc daemon priority title renders in the queue (adapted title→name).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const realTitle = (prioritiesFx as any).priorities.find((p: any) => p.id !== 'adhoc-session').title as string
    await waitFor(() => expect(screen.getByText(realTitle)).toBeDefined())
    // The Ad-hoc pinned row is still present (its runs route off-priority).
    expect(screen.getByText('Ad-hoc')).toBeDefined()
  })
})
