// Live-path component test: inject a MOCK window.oz that returns the daemon-shaped fixtures captured
// from the real daemon, render <App/>, and prove the renderer (a) switches off seed onto adapted live
// data and (b) routes mutations through the main client with 202/409 handled as first-class states.
// This exercises the whole live chain — health switch → loadWsData → adapter → renderer, and the
// launch/attach mutation path — without ever touching a real daemon.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { App } from '../app/App.tsx'
import type { RunSummary } from '../electron/ipc-contract.ts'
import workspacesFx from '../fixtures/workspaces.json'
import prioritiesFx from '../fixtures/priorities.json'
import personasFx from '../fixtures/personas.json'
import runsFx from '../fixtures/runs.json'
import runDetailFx from '../fixtures/run-detail.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = (data: any) => ({ ok: true, status: 200, data })

const clisFx = {
  clis: [
    {
      id: 'claude',
      tested: true,
      testedAt: 1780153227239,
      install: { ok: true, detail: 'installed' },
      auth: { ok: true, detail: 'authenticated' },
      models: { canEnumerate: true, models: ['opus'], detail: 'listed models' },
      configManaged: { mechanism: 'env', flags: ['--model'], managesUserConfig: true, detail: 'ready' },
    },
    {
      id: 'codex',
      tested: false,
      testedAt: null,
      install: { ok: false, detail: 'not probed' },
      auth: { ok: false, detail: 'not probed' },
      models: { canEnumerate: false, models: [], detail: 'free-text model entry' },
      configManaged: { mechanism: 'none', flags: [], managesUserConfig: false, detail: 'not checked' },
    },
  ],
}

interface PostCall { path: string; body?: unknown }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockOz(opts: { posts?: PostCall[]; postResult?: any; runs?: { runs: RunSummary[] } } = {}) {
  return {
    health: async () => ({ state: 'connected', sha: 'deadbeef' }),
    settingsGet: async () => ({ pollIntervalMs: 2500, defaultWorkspaceId: null }),
    settingsSet: async (p: unknown) => p,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    daemonGet: async (path: string): Promise<any> => {
      if (path === '/clis') return ok(clisFx)
      if (path === '/workspaces') return ok(workspacesFx)
      if (/\/priorities$/.test(path)) return ok(prioritiesFx)
      if (/\/personas$/.test(path)) return ok(personasFx)
      if (path.startsWith('/runs?')) return ok(opts.runs ?? runsFx)
      if (/^\/runs\/[^/]+$/.test(path)) return ok(runDetailFx)
      return { ok: false, status: 404, error: `no mock for ${path}` }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    daemonPost: async (path: string, body?: unknown): Promise<any> => {
      opts.posts?.push({ path, body })
      return typeof opts.postResult === 'function' ? opts.postResult(path, body) : (opts.postResult ?? { ok: true, status: 202, data: { runId: 'run_new' } })
    },
    daemonPut: async () => ok({}),
    chatSend: async () => ({ role: 'oz', text: '', at: 0 }),
    prioritiesReorder: async (_ws: string, order: readonly string[]) => order,
    prioritiesOrder: async () => [],
  }
}

const setOz = (m: unknown) => { (window as unknown as { oz: unknown }).oz = m }

describe('Oz renderer — live daemon path', () => {
  afterEach(() => { cleanup(); delete (window as unknown as { oz?: unknown }).oz })

  it('switches off seed onto live data: shows "Live" and a real daemon priority title', async () => {
    setOz(mockOz())
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const realTitle = (prioritiesFx as any).priorities.find((p: any) => p.id !== 'adhoc-session').title as string
    await waitFor(() => expect(screen.getByText(realTitle)).toBeDefined())
    expect(screen.getByText('Ad-hoc')).toBeDefined()
  })

  it('Launch posts to /runs with the workspace + priority (202 → "Launching")', async () => {
    const posts: PostCall[] = []
    setOz(mockOz({ posts }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    const launch = await waitFor(() => screen.getAllByText('Launch')[0])
    fireEvent.click(launch)
    await waitFor(() => expect(posts.length).toBeGreaterThan(0))
    const call = posts.find((p) => p.path === '/runs')!
    expect(call).toBeDefined()
    const body = call.body as { workspaceId: string; priorityId: string }
    expect(body.workspaceId).toBe('cocoder')
    expect(typeof body.priorityId).toBe('string')
    expect(body.priorityId).not.toBe('adhoc-session')
    await waitFor(() => expect(screen.getByText(/Launching/i)).toBeDefined())
  })

  it('the Ad-hoc row prompts for a task instead of launching immediately', async () => {
    const posts: PostCall[] = []
    setOz(mockOz({ posts }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    fireEvent.click(screen.getByText('Launch run'))
    const box = screen.getByLabelText('Message Oz') as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe('adhoc '))
    await waitFor(() => expect(document.activeElement).toBe(box))
    expect(posts.find((p) => p.path === '/runs')).toBeUndefined()
  })

  it('a 409 from /runs surfaces an honest "already in flight" banner (not an error)', async () => {
    setOz(mockOz({ postResult: { ok: false, status: 409, error: 'in flight' } }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    fireEvent.click(screen.getAllByText('Launch')[0])
    await waitFor(() => expect(screen.getByText(/already in flight/i)).toBeDefined())
  })

  it('a parked run drawer shows Resolve actions while a running run drawer does not', async () => {
    setOz(mockOz())
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(await screen.findByText('Living base personas + repo extensions'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark landed' })).toBeDefined())
    expect(screen.getByRole('button', { name: 'Discard run' })).toBeDefined()
    cleanup()

    const running = {
      runs: [
        { ...(runsFx as { runs: RunSummary[] }).runs.find((r) => r.id === 'run_17')!, status: 'running' },
        ...(runsFx as { runs: RunSummary[] }).runs.filter((r) => r.id !== 'run_17'),
      ],
    }
    setOz(mockOz({ runs: running }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    fireEvent.click(await screen.findByText('Living base personas + repo extensions'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop run' })).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Mark landed' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard run' })).toBeNull()
  })

  it('Mark landed posts the landed disposition to /runs/:id/resolve', async () => {
    const posts: PostCall[] = []
    setOz(mockOz({ posts }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(await screen.findByText('Living base personas + repo extensions'))
    fireEvent.click(await screen.findByRole('button', { name: 'Mark landed' }))

    await waitFor(() => expect(posts.find((p) => p.path === '/runs/run_17/resolve')).toBeDefined())
    expect(posts.find((p) => p.path === '/runs/run_17/resolve')!.body).toEqual({ disposition: 'landed' })
  })

  it('resolve daemon errors surface the daemon error text', async () => {
    setOz(mockOz({ postResult: { ok: false, status: 409, error: 'run branch is not an ancestor of trunk' } }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(await screen.findByText('Living base personas + repo extensions'))
    fireEvent.click(await screen.findByRole('button', { name: 'Mark landed' }))

    await waitFor(() => expect(screen.getByText('run branch is not an ancestor of trunk')).toBeDefined())
  })

  it('loads CLIs from the live seam and does not show a pending endpoint banner', async () => {
    setOz(mockOz())
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    fireEvent.click(screen.getByText('CLIs'))
    await waitFor(() => expect(screen.getAllByText('Not tested').length).toBeGreaterThan(0))
    expect(screen.queryByText(/Pending daemon endpoint/)).toBeNull()
  })
})

describe('Oz renderer — seed/fixtures mode shows no pending markers', () => {
  it('does not render the pending-endpoint banner when there is no live daemon', () => {
    delete (window as unknown as { oz?: unknown }).oz
    render(<App />)
    fireEvent.click(screen.getByText('CLIs'))
    expect(screen.queryByText(/Pending daemon endpoint/)).toBeNull()
    cleanup()
  })
})
