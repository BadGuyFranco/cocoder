// Live-path component test: inject a MOCK window.oz that returns the daemon-shaped fixtures captured
// from the real daemon, render <App/>, and prove the renderer (a) switches off seed onto adapted live
// data and (b) routes mutations through the main client with 202/409 handled as first-class states.
// This exercises the whole live chain — health switch → loadWsData → adapter → renderer, and the
// launch/attach mutation path — without ever touching a real daemon.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { App } from '../app/App.tsx'
import { stopRun } from '../app/live.ts'
import type { OzApi, OzEventHint, RunSummary } from '../electron/ipc-contract.ts'
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
    {
      id: 'cursor-agent',
      tested: true,
      testedAt: 1780153227239,
      install: { ok: true, detail: 'installed' },
      auth: { ok: true, detail: 'authenticated' },
      models: { canEnumerate: false, models: [], detail: 'free-text model entry' },
      configManaged: { mechanism: 'env', flags: ['--model'], managesUserConfig: true, detail: 'ready' },
    },
  ],
}

interface PostCall { path: string; body?: unknown }
interface PutCall { workspaceId: string; assignments: unknown }
interface CreateCall { workspaceId: string; priority: { title: string; goal?: string } }
interface ReorderCall { workspaceId: string; order: readonly string[] }
interface WorkspaceUpdateCall { workspaceId: string; folders: unknown }
interface WorkspaceCreateCall { workspaceId: string; folders: unknown }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockOz(opts: {
  posts?: PostCall[]
  puts?: PutCall[]
  creates?: CreateCall[]
  reorders?: ReorderCall[]
  workspaceUpdates?: WorkspaceUpdateCall[]
  workspaceCreates?: WorkspaceCreateCall[]
  postResult?: any
  putResult?: any
  createResult?: any
  workspaceUpdateResult?: any
  workspaceCreateResult?: any
  runs?: { runs: RunSummary[] }
  onOzEvent?: (cb: (event: OzEventHint) => void) => () => void
} = {}) {
  return {
    health: async () => ({ state: 'connected', sha: 'deadbeef' }),
    onOzEvent: opts.onOzEvent,
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
    daemonDelete: async () => ok({}),
    personasAssignmentsSave: async (workspaceId: string, assignments: unknown) => {
      opts.puts?.push({ workspaceId, assignments })
      return opts.putResult ?? ok(assignments)
    },
    prioritiesCreate: async (workspaceId: string, priority: { title: string; goal?: string }) => {
      opts.creates?.push({ workspaceId, priority })
      return opts.createResult ?? { ok: true, status: 201, data: { id: 'created-priority', title: priority.title, scopeNarrowing: null, goal: priority.goal ?? '' } }
    },
    chatSend: async () => ({ role: 'oz', text: '', at: 0 }),
    prioritiesReorder: async (workspaceId: string, order: readonly string[]) => {
      opts.reorders?.push({ workspaceId, order })
      return order
    },
    prioritiesOrder: async () => [],
    workspacesUpdate: async (workspaceId: string, folders: unknown) => {
      opts.workspaceUpdates?.push({ workspaceId, folders })
      return opts.workspaceUpdateResult ?? ok((workspacesFx as any).workspaces[0])
    },
    workspacesCreate: async (workspaceId: string, folders: unknown) => {
      opts.workspaceCreates?.push({ workspaceId, folders })
      return opts.workspaceCreateResult ?? ok({ workspace: { id: workspaceId, name: workspaceId, path: '/new', roots: folders }, legacyHidden: [] })
    },
    workspacesDelete: async () => ok(true),
  }
}

const setOz = (m: unknown) => { (window as unknown as { oz: unknown }).oz = m }
const clickFirstText = async (text: string): Promise<void> => {
  const matches = await screen.findAllByText(text)
  fireEvent.click(matches[0])
}

describe('Oz renderer — live daemon path', () => {
  afterEach(() => { cleanup(); delete (window as unknown as { oz?: unknown }).oz })

  it('stopRun posts to the daemon stop endpoint', async () => {
    const posts: PostCall[] = []
    const oz = mockOz({ posts })

    await stopRun(oz as OzApi, 'run_45')

    expect(posts).toEqual([{ path: '/runs/run_45/stop', body: undefined }])
  })

  it('switches off seed onto live data: shows "Live" and a real daemon priority title', async () => {
    setOz(mockOz())
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const realTitle = (prioritiesFx as any).priorities.find((p: any) => p.id !== 'adhoc-session').title as string
    await waitFor(() => expect(screen.getAllByText(realTitle).length).toBeGreaterThan(0))
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

    await clickFirstText('Living base personas + repo extensions')
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
    await clickFirstText('Living base personas + repo extensions')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop run' })).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Mark landed' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard run' })).toBeNull()
  })

  it('Stop run posts to /runs/:id/stop and shows cooperative success text', async () => {
    const posts: PostCall[] = []
    const running = {
      runs: [
        { ...(runsFx as { runs: RunSummary[] }).runs.find((r) => r.id === 'run_17')!, status: 'running' },
        ...(runsFx as { runs: RunSummary[] }).runs.filter((r) => r.id !== 'run_17'),
      ],
    }
    setOz(mockOz({ posts, runs: running }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    await clickFirstText('Living base personas + repo extensions')
    fireEvent.click(await screen.findByRole('button', { name: 'Stop run' }))

    await waitFor(() => expect(posts.find((p) => p.path === '/runs/run_17/stop')).toBeDefined())
    expect(screen.getByText('Stop requested — the run winds down at its next checkpoint.')).toBeDefined()
  })

  it('debounces Oz event hints into workspace and open-run refetches', async () => {
    let handler: ((event: OzEventHint) => void) | null = null
    const oz = mockOz({
      onOzEvent: (cb) => {
        handler = cb
        return () => {
          handler = null
        }
      },
    })
    const originalGet = oz.daemonGet
    const paths: string[] = []
    oz.daemonGet = async (path: string) => {
      paths.push(path)
      return originalGet(path)
    }
    setOz(oz)
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    await clickFirstText('Living base personas + repo extensions')
    await waitFor(() => expect(screen.getByText('Transcript')).toBeDefined())
    await waitFor(() => expect(handler).toBeTypeOf('function'))
    paths.length = 0

    handler!({ type: 'run-created', workspaceId: 'cocoder', runId: 'run_17', ts: '2026-06-12T00:00:00.000Z' })
    handler!({ type: 'run-settled', workspaceId: 'cocoder', runId: 'run_17', ts: '2026-06-12T00:00:00.100Z' })

    await waitFor(() => expect(paths.filter((path) => path === '/runs?workspace=cocoder')).toHaveLength(1), { timeout: 1500 })
    expect(paths.filter((path) => path === '/runs/run_17')).toHaveLength(1)
  })

  it('Mark landed posts the landed disposition to /runs/:id/resolve', async () => {
    const posts: PostCall[] = []
    setOz(mockOz({ posts }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    await clickFirstText('Living base personas + repo extensions')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark landed' }))

    await waitFor(() => expect(posts.find((p) => p.path === '/runs/run_17/resolve')).toBeDefined())
    expect(posts.find((p) => p.path === '/runs/run_17/resolve')!.body).toEqual({ disposition: 'landed' })
  })

  it('resolve daemon errors surface the daemon error text', async () => {
    setOz(mockOz({ postResult: { ok: false, status: 409, error: 'run branch is not an ancestor of trunk' } }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    await clickFirstText('Living base personas + repo extensions')
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

  it('saves a sub-agent Play assignment through the typed personas bridge with the full map', async () => {
    const puts: PutCall[] = []
    setOz(mockOz({ puts }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Personas'))
    const playId = await screen.findByLabelText('Bob play id')
    fireEvent.change(playId, { target: { value: 'documentation' } })
    const add = playId.parentElement?.querySelector('button')
    expect(add).toBeDefined()
    fireEvent.click(add!)

    await waitFor(() => expect(puts.length).toBe(1))
    expect(puts[0].workspaceId).toBe('cocoder')
    const assignments = puts[0].assignments as Record<string, { cli: string; model: string; enabled?: boolean; plays?: Record<string, { cli: string; model: string }> }>
    expect(Object.keys(assignments).sort()).toEqual(['bob', 'deb', 'oscar'])
    expect(assignments.deb.enabled).toBe(true)
    expect(assignments.bob.plays).toEqual({ documentation: { cli: 'claude', model: '' } })
    expect(assignments.oscar.plays).toEqual({ 'wrap-up': { cli: 'cursor-agent', model: '' } })
  })

  it('persists Oscar run-mode through the assignments bridge and surfaces daemon errors', async () => {
    const puts: PutCall[] = []
    setOz(mockOz({ puts, putResult: { ok: false, status: 500, error: 'mode save failed' } }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Personas'))
    fireEvent.click(await screen.findByRole('button', { name: 'Oscar headless run mode' }))

    await waitFor(() => expect(puts.length).toBe(1))
    const assignments = puts[0].assignments as Record<string, { mode?: 'visible' | 'headless' }>
    expect(assignments.oscar.mode).toBe('headless')
    await waitFor(() => expect(screen.getByText('mode save failed')).toBeDefined())
  })

  it('keeps Bob run-mode as a local preview without saving assignments', async () => {
    const puts: PutCall[] = []
    setOz(mockOz({ puts }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Personas'))
    fireEvent.click(await screen.findByRole('button', { name: 'Bob headless run mode' }))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(puts).toHaveLength(0)
  })

  it('Dashboard Add priority uses the typed create bridge and persists top placement', async () => {
    const creates: CreateCall[] = []
    const reorders: ReorderCall[] = []
    setOz(mockOz({ creates, reorders }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByTitle('Add priority'))
    fireEvent.change(await screen.findByPlaceholderText('e.g. Add priority creation UI'), { target: { value: 'Create endpoint UI' } })
    fireEvent.change(screen.getByPlaceholderText('What should be true when this is done?'), { target: { value: 'Priority is daemon-backed.' } })
    fireEvent.click(screen.getByText('Place at top'))
    fireEvent.click(screen.getByText('Create priority'))

    await waitFor(() => expect(creates.length).toBe(1))
    expect(creates[0]).toEqual({
      workspaceId: 'cocoder',
      priority: { title: 'Create endpoint UI', goal: 'Priority is daemon-backed.' },
    })
    await waitFor(() => expect(reorders.length).toBe(1))
    expect(reorders[0].workspaceId).toBe('cocoder')
    expect(reorders[0].order[0]).toBe('created-priority')
  })

  it('Dashboard priority create failures surface daemon text without adding a local fake row', async () => {
    const creates: CreateCall[] = []
    const reorders: ReorderCall[] = []
    setOz(mockOz({ creates, reorders, createResult: { ok: false, status: 409, error: 'priority slug already exists' } }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByTitle('Add priority'))
    fireEvent.change(await screen.findByPlaceholderText('e.g. Add priority creation UI'), { target: { value: 'Rejected Priority' } })
    fireEvent.click(screen.getByText('Create priority'))

    await waitFor(() => expect(screen.getByText('priority slug already exists')).toBeDefined())
    expect(creates.length).toBe(1)
    expect(reorders.length).toBe(0)
    fireEvent.click(screen.getByTitle('Close (Esc)'))
    expect(screen.queryByText('Rejected Priority')).toBeNull()
  })

  it('Craft persona files its priority through the typed create bridge in live mode', async () => {
    const creates: CreateCall[] = []
    setOz(mockOz({ creates }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Personas'))
    fireEvent.click(await screen.findByText('Craft a new persona'))
    fireEvent.change(await screen.findByPlaceholderText('e.g. Translator, Designer, Auditor'), { target: { value: 'Auditor' } })
    fireEvent.change(screen.getByPlaceholderText('One line — what they do'), { target: { value: 'Reviews risky diffs' } })
    fireEvent.click(screen.getByText('File as priority'))

    await waitFor(() => expect(creates.length).toBe(1))
    expect(creates[0]).toEqual({
      workspaceId: 'cocoder',
      priority: { title: 'Persona: Auditor', goal: 'Reviews risky diffs' },
    })
  })

  it('Workspaces save sends raw path strings and the full folders array', async () => {
    const workspaceUpdates: WorkspaceUpdateCall[] = []
    setOz(mockOz({ workspaceUpdates }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Workspaces'))
    fireEvent.change(await screen.findByDisplayValue('${COCODER_HOME}'), { target: { value: '${COCODER_HOME}/edited' } })
    fireEvent.click(screen.getByText('Save roots'))

    await waitFor(() => expect(workspaceUpdates.length).toBe(1))
    expect(workspaceUpdates[0].workspaceId).toBe('cocoder')
    expect(workspaceUpdates[0].folders).toEqual([
      { name: 'CoCoder', path: '${COCODER_HOME}/edited', role: 'primary' },
      { name: 'Reference', path: './reference', role: 'readonly', description: 'Docs root' },
    ])
  })

  it('Workspaces save failures surface daemon text without fake-saving locally', async () => {
    const workspaceUpdates: WorkspaceUpdateCall[] = []
    setOz(mockOz({ workspaceUpdates, workspaceUpdateResult: { ok: false, status: 409, error: 'workspace must be migrated first' } }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Workspaces'))
    fireEvent.click(await screen.findByText('Save roots'))

    await waitFor(() => expect(screen.getByText('workspace must be migrated first')).toBeDefined())
    expect(workspaceUpdates.length).toBe(1)
  })

  it('Workspaces create surfaces legacyHidden from the daemon', async () => {
    const workspaceCreates: WorkspaceCreateCall[] = []
    setOz(mockOz({
      workspaceCreates,
      workspaceCreateResult: ok({
        workspace: {
          id: 'new-workspace',
          name: 'new-workspace',
          path: '/new',
          roots: [{ name: 'New Root', path: '/new', rawPath: '/new', role: 'primary' }],
        },
        legacyHidden: ['legacy-only'],
      }),
    }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Workspaces'))
    fireEvent.click(await screen.findByText('New workspace'))
    fireEvent.change(await screen.findByPlaceholderText('e.g. AcmeCRM, Vault, Internal Tools'), { target: { value: 'New Workspace' } })
    fireEvent.change(screen.getByPlaceholderText('cocoder-cli'), { target: { value: 'New Root' } })
    fireEvent.change(screen.getByPlaceholderText('~/dev/cocoder-cli'), { target: { value: '/new' } })
    fireEvent.click(screen.getByText('Create & open'))

    await waitFor(() => expect(workspaceCreates.length).toBe(1))
    expect(workspaceCreates[0]).toEqual({
      workspaceId: 'new-workspace',
      folders: [
        { name: 'New Root', path: '/new', role: 'primary' },
        { name: 'CoCoder', path: '${COCODER_HOME}', role: 'readonly' },
      ],
    })
    await waitFor(() => expect(screen.getByText('Legacy workspaces no longer served: legacy-only')).toBeDefined())
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
