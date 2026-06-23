// Live-path component test: inject a MOCK window.oz that returns the daemon-shaped fixtures captured
// from the real daemon, render <App/>, and prove the renderer (a) switches off seed onto adapted live
// data and (b) routes mutations through the main client with 202/409 handled as first-class states.
// This exercises the whole live chain — health switch → loadWsData → adapter → renderer, and the
// launch/attach mutation path — without ever touching a real daemon.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import { App } from '../src/renderer/App.tsx'
import { stopRun } from '../src/renderer/live.ts'
import { DEFAULT_SETTINGS, type ConnectionState, type OzApi, type OzEventHint, type PersonasResponse, type PlaysResponse, type Priority as DPriority, type Ticket as DTicket, type RunDetail, type RunSummary, type Settings, type SettingsPatch } from '../src/main/ipc-contract.ts'
import workspacesFx from '../fixtures/workspaces.json'
import prioritiesFx from '../fixtures/priorities.json'
import ticketsFx from '../fixtures/tickets.json'
import personasFx from '../fixtures/personas.json'
import runsFx from '../fixtures/runs.json'
import runDetailFx from '../fixtures/run-detail.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = (data: any) => ({ ok: true, status: 200, data })
const workspaceDisclosure = (primaryRoot = '/new') => ({
  primaryRoot,
  roots: [{ name: 'New Root', path: primaryRoot, rawPath: primaryRoot, role: 'primary' as const }],
  initializedRepo: false,
  baselineCommitted: false,
  outsideCocoderFiles: [] as string[],
})

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
      headlessCapable: true,
    },
    {
      id: 'codex',
      tested: false,
      testedAt: null,
      install: { ok: false, detail: 'not probed' },
      auth: { ok: false, detail: 'not probed' },
      models: { canEnumerate: false, models: [], detail: 'free-text model entry' },
      configManaged: { mechanism: 'none', flags: [], managesUserConfig: false, detail: 'not checked' },
      headlessCapable: true,
    },
    {
      id: 'cursor-agent',
      tested: true,
      testedAt: 1780153227239,
      install: { ok: true, detail: 'installed' },
      auth: { ok: true, detail: 'authenticated' },
      models: { canEnumerate: false, models: [], detail: 'free-text model entry' },
      configManaged: { mechanism: 'env', flags: ['--model'], managesUserConfig: true, detail: 'ready' },
      headlessCapable: true,
    },
  ],
}

const rowForText = (text: string): HTMLElement => {
  const label = screen.getByText(text)
  const row = label.closest('[draggable="true"]') ?? label.closest('div')?.parentElement?.parentElement?.parentElement
  if (!(row instanceof HTMLElement)) throw new Error(`Could not find row for ${text}`)
  return row
}

const playsFx: PlaysResponse = {
  workspace: (workspacesFx as { workspaces: PlaysResponse['workspace'][] }).workspaces[0],
  plays: [
    { id: 'wrap-up', label: 'Wrap-up', kind: 'headless', writeScope: ['cocoder/**'] },
    { id: 'documentation', label: 'Documentation', kind: 'headless', writeScope: ['docs/**'] },
  ],
}

interface PostCall { path: string; body?: unknown }
interface PutCall { workspaceId: string; assignments: unknown }
interface CreateCall { workspaceId: string; priority: { title: string; goal?: string } }
interface TicketCreateCall { workspaceId: string; ticket: { title: string; type?: string; priority?: string; description?: string } }
interface ReorderCall { workspaceId: string; order: readonly string[] }
interface WorkspaceUpdateCall { workspaceId: string; folders: unknown }
interface WorkspaceCreateCall { workspaceId: string; folders: unknown }
interface ChatCall { workspaceId: string; text: string }
interface ValidateRootCall { path: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockOz(opts: {
  getPaths?: string[]
  healthState?: ConnectionState
  posts?: PostCall[]
  puts?: PutCall[]
  creates?: CreateCall[]
  ticketCreates?: TicketCreateCall[]
  reorders?: ReorderCall[]
  ticketReorders?: ReorderCall[]
  workspaceUpdates?: WorkspaceUpdateCall[]
  workspaceCreates?: WorkspaceCreateCall[]
  validateRootCalls?: ValidateRootCall[]
  chatSends?: ChatCall[]
  postResult?: any
  putResult?: any
  createResult?: any
  ticketCreateResult?: any
  workspaceUpdateResult?: any
  workspaceCreateResult?: any
  workspacePickResult?: any
  workspaceValidateResult?: any
  chatReply?: (workspaceId: string, text: string) => { role: 'oz'; text: string; at: number }
  priorities?: { priorities: DPriority[] }
  personasResult?: { ok: false; status: number; error: string }
  personasResponse?: PersonasResponse
  playsResponse?: PlaysResponse
  runs?: { runs: RunSummary[] }
  runDetails?: Record<string, RunDetail>
  pollIntervalMs?: number
  settings?: Settings
  settingsSets?: SettingsPatch[]
  onOzEvent?: (cb: (event: OzEventHint) => void) => () => void
} = {}) {
  return {
    health: async () => ({ state: opts.healthState ?? 'connected', sha: 'deadbeef' }),
    onOzEvent: opts.onOzEvent,
    settingsGet: async () => opts.settings ?? { ...DEFAULT_SETTINGS, pollIntervalMs: opts.pollIntervalMs ?? 2500 },
    settingsSet: async (p: SettingsPatch) => {
      opts.settingsSets?.push(p)
      opts.settings = { ...(opts.settings ?? DEFAULT_SETTINGS), ...p, preferences: { ...(opts.settings ?? DEFAULT_SETTINGS).preferences, ...(p.preferences ?? {}) } }
      return opts.settings
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    daemonGet: async (path: string): Promise<any> => {
      opts.getPaths?.push(path)
      if (path === '/clis') return ok(clisFx)
      if (path === '/workspaces') return ok(workspacesFx)
      if (/\/priorities$/.test(path)) return ok(opts.priorities ?? prioritiesFx)
      if (/\/tickets$/.test(path)) return ok(ticketsFx)
      if (/\/personas$/.test(path)) return opts.personasResult ?? ok(opts.personasResponse ?? personasFx)
      if (/\/plays$/.test(path)) return ok(opts.playsResponse ?? playsFx)
      if (path.startsWith('/runs?')) return ok(opts.runs ?? runsFx)
      const runDetailMatch = path.match(/^\/runs\/([^/]+)$/)
      if (runDetailMatch) return ok(opts.runDetails?.[runDetailMatch[1]] ?? runDetailFx)
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
    ticketsCreate: async (_workspaceId: string, ticket: { title: string; type?: string; priority?: string; description?: string }) => (
      opts.ticketCreates?.push({ workspaceId: _workspaceId, ticket }),
      opts.ticketCreateResult ?? { ok: true, status: 201, data: { id: '0001', title: ticket.title, type: ticket.type ?? 'task', status: 'Open', priority: ticket.priority ?? 'none', owner: 'founder-session', created: '2026-06-17', state: 'open', body: ticket.description ?? '' } as DTicket }
    ),
    chatSend: async (workspaceId: string, text: string) => {
      opts.chatSends?.push({ workspaceId, text })
      return opts.chatReply ? opts.chatReply(workspaceId, text) : { role: 'oz' as const, text: '', at: 0 }
    },
    prioritiesReorder: async (workspaceId: string, order: readonly string[]) => {
      opts.reorders?.push({ workspaceId, order })
      return order
    },
    ticketsReorder: async (workspaceId: string, order: readonly string[]) => {
      opts.ticketReorders?.push({ workspaceId, order })
      return order
    },
    prioritiesOrder: async () => [],
    workspacesUpdate: async (workspaceId: string, folders: unknown) => {
      opts.workspaceUpdates?.push({ workspaceId, folders })
      return opts.workspaceUpdateResult ?? ok((workspacesFx as any).workspaces[0])
    },
    workspacesCreate: async (workspaceId: string, folders: unknown) => {
      opts.workspaceCreates?.push({ workspaceId, folders })
      return opts.workspaceCreateResult ?? ok({ workspace: { id: workspaceId, name: workspaceId, path: '/new', roots: folders }, legacyHidden: [], disclosure: workspaceDisclosure() })
    },
    workspacesDelete: async () => ok(true),
    workspaceDirectoryPick: async () => opts.workspacePickResult ?? ok({ path: '/picked-root' }),
    workspacePrimaryRootValidate: async (path: string) => {
      opts.validateRootCalls?.push({ path })
      return opts.workspaceValidateResult ?? ok({ path })
    },
  }
}

const setOz = (m: unknown) => { (window as unknown as { oz: unknown }).oz = m }
const clickFirstText = async (text: string): Promise<void> => {
  const matches = await screen.findAllByText(text)
  fireEvent.click(matches[0])
}
const openRunFromPriority = async (priority: string, runId: string): Promise<void> => {
  await clickFirstText(priority)
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(runId, 'i') }))
}

const expandPersona = async (name: string): Promise<void> => {
  const toggle = await screen.findByRole('button', { name: `Toggle ${name} persona details` })
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function runSummary(id: string, status: RunSummary['status'], priorityId = 'base-and-extension-personas'): RunSummary {
  return {
    id,
    workspaceId: 'cocoder',
    priorityId,
    status,
    createdAt: 1780112098510,
    endedAt: status === 'running' ? null : 1780115351387,
  }
}

function detailFor(summary: RunSummary, latestEvent = 'Real latest event for the row.'): RunDetail {
  return {
    run: summary,
    sessions: [
      { id: `${summary.id}-oscar`, runId: summary.id, persona: 'oscar', sessionRef: 'surface:2', startedAt: summary.createdAt + 1, exitCode: null, deepLinkable: false },
      { id: `${summary.id}-bob`, runId: summary.id, persona: 'bob', sessionRef: 'surface:3', startedAt: summary.createdAt + 2, exitCode: null, deepLinkable: false },
    ],
    workItems: [],
    commitLinks: [],
    events: [
      { id: `${summary.id}-start`, runId: summary.id, type: 'run-start', data: { priority: summary.priorityId }, at: summary.createdAt },
      { id: `${summary.id}-delegation`, runId: summary.id, type: 'delegation', data: { task: latestEvent }, at: summary.createdAt + 5 },
    ],
    files: { oscarOut: null, oscarErr: null, bobOut: null, bobErr: null, pickup: null, record: null },
    diffs: [],
  }
}

function personasResponse(assignments: PersonasResponse['assignments']): PersonasResponse {
  return {
    workspace: (workspacesFx as { workspaces: PersonasResponse['workspace'][] }).workspaces[0],
    personas: (personasFx as PersonasResponse).personas,
    assignments,
  }
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

  it('defaults panelRatio to 0.45 and restores the dragged ratio through settings save/load', async () => {
    const settingsSets: SettingsPatch[] = []
    const opts = { settings: DEFAULT_SETTINGS, settingsSets }
    setOz(mockOz(opts))
    const first = render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    const grid = first.container.querySelector('.oz-content > div[style*="grid-template-columns"]') as HTMLElement
    expect(grid.style.gridTemplateColumns).toBe('45% 6px 1fr')
    Object.defineProperty(grid, 'clientWidth', { configurable: true, value: 1200 })

    const handle = first.container.querySelector('.oz-resize-handle') as HTMLElement
    fireEvent.mouseDown(handle, { clientX: 600 })
    fireEvent.mouseMove(document, { clientX: 660 })
    fireEvent.mouseUp(document, { clientX: 660 })

    await waitFor(() => expect(settingsSets.at(-1)?.preferences?.panelRatio).toBeCloseTo(0.5, 4))
    cleanup()

    setOz(mockOz(opts))
    const second = render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    const restored = second.container.querySelector('.oz-content > div[style*="grid-template-columns"]') as HTMLElement
    expect(restored.style.gridTemplateColumns).toBe('50% 6px 1fr')
  })

  it('shows first-run setup for a live empty workspace with no persona assignments', async () => {
    setOz(mockOz({
      priorities: { priorities: [] },
      runs: { runs: [] },
      personasResponse: personasResponse({}),
    }))
    render(<App />)

    await waitFor(() => expect(screen.getByText(/FIRST-RUN SETUP/)).toBeDefined())

    expect(screen.queryByText('Nothing queued')).toBeNull()
  })

  it('shows the empty configured queue instead of first-run when persona assignments exist', async () => {
    setOz(mockOz({
      priorities: { priorities: [] },
      runs: { runs: [] },
      personasResponse: personasResponse({ oscar: { cli: 'claude', model: '' } }),
    }))
    render(<App />)

    await waitFor(() => expect(screen.getByText('Nothing queued')).toBeDefined())

    expect(screen.queryByText(/FIRST-RUN SETUP/)).toBeNull()
    expect(screen.getAllByRole('button', { name: /Add priority/i }).length).toBeGreaterThan(0)
  })

  it('treats a failed personas fetch as configured so a network blip does not show first-run', async () => {
    setOz(mockOz({
      priorities: { priorities: [] },
      runs: { runs: [] },
      personasResult: { ok: false, status: 500, error: 'personas unavailable' },
    }))
    render(<App />)

    await waitFor(() => expect(screen.getByText('Nothing queued')).toBeDefined())

    expect(screen.queryByText(/FIRST-RUN SETUP/)).toBeNull()
  })

  it('enriches active priority rows from run detail without selecting the run', async () => {
    const activeRun = runSummary('run_inline', 'running')
    const detail = detailFor(activeRun, 'Renderer fetched the real latest event.')
    setOz(mockOz({ runs: { runs: [activeRun] }, runDetails: { run_inline: detail } }))
    render(<App />)

    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    expect(screen.queryByText('Transcript')).toBeNull()
    await waitFor(() => expect(screen.getByText('oscar')).toBeDefined())
    expect(screen.getByText('bob')).toBeDefined()
    expect(screen.getByText('Delegated: Renderer fetched the real latest event.')).toBeDefined()
    expect(screen.queryByText(/50%/)).toBeNull()
  })

  it('caps active-row enrichment at six detail fetches per cycle', async () => {
    const getPaths: string[] = []
    const activeRuns = Array.from({ length: 8 }, (_, i) => runSummary(`run_hot_${i}`, 'running'))
    const runDetails = Object.fromEntries(activeRuns.map((run) => [run.id, detailFor(run)]))
    setOz(mockOz({ getPaths, runs: { runs: activeRuns }, runDetails }))
    render(<App />)

    await waitFor(() => expect(getPaths.filter((path) => /^\/runs\/[^/]+$/.test(path))).toHaveLength(6))

    const detailPaths = getPaths.filter((path) => /^\/runs\/[^/]+$/.test(path))
    expect(detailPaths).toEqual(['/runs/run_hot_0', '/runs/run_hot_1', '/runs/run_hot_2', '/runs/run_hot_3', '/runs/run_hot_4', '/runs/run_hot_5'])
  })

  it('keeps enriched active-row data across workspace summary refreshes', async () => {
    let handler: ((event: OzEventHint) => void) | null = null
    const getPaths: string[] = []
    const activeRun = runSummary('run_refresh', 'running')
    setOz(mockOz({
      getPaths,
      runs: { runs: [activeRun] },
      runDetails: { run_refresh: detailFor(activeRun, 'Still the real detail after refresh.') },
      onOzEvent: (cb) => {
        handler = cb
        return () => {
          handler = null
        }
      },
    }))
    render(<App />)

    await waitFor(() => expect(screen.getByText('Delegated: Still the real detail after refresh.')).toBeDefined())
    expect(screen.getByText('oscar')).toBeDefined()
    await waitFor(() => expect(handler).toBeTypeOf('function'))
    const detailFetchesBeforeRefresh = getPaths.filter((path) => path === '/runs/run_refresh').length

    handler!({ type: 'run-settled', workspaceId: 'cocoder', runId: 'run_refresh', ts: '2026-06-12T00:00:00.000Z' })

    await waitFor(() => expect(getPaths.filter((path) => path === '/runs?workspace=cocoder').length).toBeGreaterThan(1), { timeout: 1500 })
    expect(screen.getByText('Delegated: Still the real detail after refresh.')).toBeDefined()
    expect(screen.getByText('oscar')).toBeDefined()
    expect(getPaths.filter((path) => path === '/runs/run_refresh').length).toBeGreaterThanOrEqual(detailFetchesBeforeRefresh)
  })

  it('Launch posts to /runs with the workspace + priority (202 → "Launching")', async () => {
    const posts: PostCall[] = []
    setOz(mockOz({ posts }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    const launch = await waitFor(() => within(rowForText('Living base personas + repo extensions')).getByText('Launch'))
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
    fireEvent.click(within(rowForText('Ad-hoc')).getByText('Launch'))
    const box = screen.getByLabelText('Message Oz') as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe('adhoc '))
    await waitFor(() => expect(document.activeElement).toBe(box))
    expect(posts.find((p) => p.path === '/runs')).toBeUndefined()
  })

  it('Oz chat target picker defaults to the active workspace and can send to Global Oz', async () => {
    const chatSends: ChatCall[] = []
    setOz(mockOz({
      chatSends,
      chatReply: (workspaceId) => ({
        role: 'oz',
        text: workspaceId ? `Workspace reply for ${workspaceId}` : 'Pick a workspace first, then use launch <priorityId>, adhoc <task>, show <runId>, stop <runId>, teardown <runId>, or status.',
        at: chatSends.length + 1,
      }),
    }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    const target = screen.getByLabelText('Oz chat target') as HTMLSelectElement
    expect(screen.getByRole('option', { name: 'Global Oz · no workspace' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'CoCoder (dogfood)' })).toBeDefined()
    expect(target.value).toBe('cocoder')

    const box = screen.getByLabelText('Message Oz') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'status please' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(chatSends).toHaveLength(1))
    expect(chatSends[0]).toEqual({ workspaceId: 'cocoder', text: 'status please' })

    fireEvent.change(target, { target: { value: '' } })
    await waitFor(() => expect(screen.getAllByText('Global Oz').length).toBeGreaterThan(0))
    fireEvent.change(box, { target: { value: 'launch demo' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(chatSends).toHaveLength(2))
    expect(chatSends[1]).toEqual({ workspaceId: '', text: 'launch demo' })
    await waitFor(() => expect(screen.getByText(/Pick a workspace first/)).toBeDefined())
  })

  it('a 409 from /runs surfaces an honest "already in flight" banner (not an error)', async () => {
    setOz(mockOz({ postResult: { ok: false, status: 409, error: 'in flight' } }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    fireEvent.click(within(rowForText('Living base personas + repo extensions')).getByText('Launch'))
    await waitFor(() => expect(screen.getByText(/already in flight/i)).toBeDefined())
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

    await openRunFromPriority('Living base personas + repo extensions', 'run_17')
    fireEvent.click(await screen.findByRole('button', { name: 'Stop run' }))

    await waitFor(() => expect(posts.find((p) => p.path === '/runs/run_17/stop')).toBeDefined())
    expect(screen.getByText('Stop requested — the run winds down at its next checkpoint.')).toBeDefined()
  })

  it('debounces Oz event hints into workspace and open-run refetches', async () => {
    let handler: ((event: OzEventHint) => void) | null = null
    const running = {
      runs: [
        { ...(runsFx as { runs: RunSummary[] }).runs.find((r) => r.id === 'run_17')!, status: 'running' },
        ...(runsFx as { runs: RunSummary[] }).runs.filter((r) => r.id !== 'run_17'),
      ],
    }
    const oz = mockOz({
      runs: running,
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

    await openRunFromPriority('Living base personas + repo extensions', 'run_17')
    await waitFor(() => expect(screen.getByText('Transcript')).toBeDefined())
    await waitFor(() => expect(handler).toBeTypeOf('function'))
    paths.length = 0

    handler!({ type: 'run-created', workspaceId: 'cocoder', runId: 'run_17', ts: '2026-06-12T00:00:00.000Z' })
    handler!({ type: 'run-settled', workspaceId: 'cocoder', runId: 'run_17', ts: '2026-06-12T00:00:00.100Z' })

    await waitFor(() => expect(paths.filter((path) => path === '/runs?workspace=cocoder')).toHaveLength(1), { timeout: 1500 })
    expect(paths.filter((path) => path === '/runs/run_17')).toHaveLength(1)
  })

  it('loads CLIs from the live seam and does not show a pending endpoint banner', async () => {
    setOz(mockOz())
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    fireEvent.click(screen.getByText('CLIs'))
    await waitFor(() => expect(screen.getAllByText('Not tested').length).toBeGreaterThan(0))
    expect(screen.queryByText(/Pending daemon endpoint/)).toBeNull()
  })

  it('saves a Plays assignment through the typed personas bridge with the full map', async () => {
    const puts: PutCall[] = []
    setOz(mockOz({ puts }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Personas'))
    await expandPersona('Bob')
    const playId = await screen.findByLabelText('Bob Play')
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
    await expandPersona('Oscar')
    fireEvent.click(await screen.findByRole('button', { name: 'Oscar headless run mode' }))

    await waitFor(() => expect(puts.length).toBe(1))
    const assignments = puts[0].assignments as Record<string, { mode?: 'visible' | 'headless' }>
    expect(assignments.oscar.mode).toBe('headless')
    await waitFor(() => expect(screen.getByText('mode save failed')).toBeDefined())
  })

  it('persists Bob run-mode through the assignments bridge', async () => {
    const puts: PutCall[] = []
    setOz(mockOz({ puts }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Personas'))
    await expandPersona('Bob')
    fireEvent.click(await screen.findByRole('button', { name: 'Bob headless run mode' }))

    await waitFor(() => expect(puts.length).toBe(1))
    const assignments = puts[0].assignments as Record<string, { mode?: 'visible' | 'headless' }>
    expect(assignments.bob.mode).toBe('headless')
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

  it('Dashboard Add ticket opens the live ticket modal, creates through the typed bridge, and refreshes tickets', async () => {
    const getPaths: string[] = []
    const ticketCreates: TicketCreateCall[] = []
    setOz(mockOz({ getPaths, ticketCreates }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /Tickets \d+/i }))
    fireEvent.click(screen.getByTitle('Add ticket'))

    const heading = await screen.findByText('New ticket')
    const modalRoot = heading.closest('body > div') as HTMLElement
    const modal = within(modalRoot)
    const submit = modal.getByText('Create ticket') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(modal.getByPlaceholderText('e.g. Dashboard count is stale'), { target: { value: 'Fix ticket modal' } })
    fireEvent.change(modal.getByRole('combobox'), { target: { value: 'bug' } })
    fireEvent.change(modal.getByPlaceholderText('Why does this ticket exist?'), { target: { value: 'File tickets without chat prefill.' } })
    fireEvent.click(submit)

    await waitFor(() => expect(ticketCreates.length).toBe(1))
    expect(ticketCreates[0]).toEqual({
      workspaceId: 'cocoder',
      ticket: { title: 'Fix ticket modal', type: 'bug', description: 'File tickets without chat prefill.' },
    })
    await waitFor(() => expect(getPaths.filter((path) => /\/tickets$/.test(path)).length).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(screen.queryByText('New ticket')).toBeNull())
  })

  it('Dashboard ticket drag reorder persists the open ticket order through the typed bridge', async () => {
    const ticketReorders: ReorderCall[] = []
    setOz(mockOz({ ticketReorders }))
    const { container } = render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /Tickets \d+/i }))
    const firstTitle = 'Public docs/ tree is v1-stale (commands, PRIORITIES.md, cocoder/local, routes)'
    const secondTitle = 'Guard against design-ref rebuilds reverting committed packages/ui/app fixes'
    const first = screen.getByText(firstTitle).closest('[draggable="true"]') as HTMLElement | null
    const second = screen.getByText(secondTitle).closest('[draggable="true"]') as HTMLElement | null
    if (!first || !second) throw new Error('ticket cards must be draggable')

    fireEvent.dragStart(first)
    fireEvent.dragOver(second)
    fireEvent.drop(second)
    fireEvent.dragEnd(first)
    fireEvent.click(first)

    await waitFor(() => expect(ticketReorders.length).toBe(1))
    expect(ticketReorders[0]).toEqual({ workspaceId: 'cocoder', order: ['0012', '0003'] })
    const text = container.textContent ?? ''
    expect(text.indexOf(secondTitle)).toBeLessThan(text.indexOf(firstTitle))
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
        disclosure: {
          primaryRoot: '/new',
          roots: [
            { name: 'New Root', path: '/new', rawPath: '/new', role: 'primary' },
            { name: 'CoCoder', path: '/cocoder', rawPath: '${COCODER_HOME}', role: 'readonly' },
          ],
          initializedRepo: true,
          baselineCommitted: true,
          outsideCocoderFiles: ['.gitignore'],
        },
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
    await waitFor(() => expect(screen.getByText(/Workspace created\./)).toBeDefined())
    expect(screen.getByText(/Primary root: \/new\./)).toBeDefined()
    expect(screen.getByText(/primary: \/new; readonly: \$\{COCODER_HOME\}/)).toBeDefined()
    expect(screen.getByText(/Git initialized: yes\./)).toBeDefined()
    expect(screen.getByText(/Baseline commit: yes\./)).toBeDefined()
    expect(screen.getByText(/Outside cocoder\/: \.gitignore\./)).toBeDefined()
    expect(screen.getByText(/Legacy workspaces no longer served: legacy-only\./)).toBeDefined()
  })

  it('shows and launches a seeded onboarding priority after recreating the same workspace id', async () => {
    const getPaths: string[] = []
    const posts: PostCall[] = []
    const workspaceCreates: WorkspaceCreateCall[] = []
    const initialPriorities: { priorities: DPriority[] } = {
      priorities: [{ id: 'adhoc-session', title: 'Ad-hoc', scopeNarrowing: null, goal: 'Run one-off work.' }],
    }
    const onboardPriority: DPriority & { readonly auditWriteBoundary: readonly string[] } = {
      id: 'onboard-existing',
      title: 'Onboard existing repo',
      scopeNarrowing: null,
      goal: 'Audit and seed the workspace governance.',
      auditWriteBoundary: ['cocoder/**'],
    }
    const opts = {
      getPaths,
      posts,
      workspaceCreates,
      priorities: initialPriorities,
      runs: { runs: [] },
      personasResponse: personasResponse({ oscar: { cli: 'claude', model: '' } }),
    }
    const oz = mockOz(opts)
    oz.workspacesCreate = async (workspaceId: string, folders: unknown) => {
      workspaceCreates.push({ workspaceId, folders })
      opts.priorities = { priorities: [initialPriorities.priorities[0], onboardPriority] }
      return ok({
        workspace: {
          id: workspaceId,
          name: workspaceId,
          path: '/recreated',
          roots: [{ name: 'CoCoder', path: '/recreated', rawPath: '/recreated', role: 'primary' }],
        },
        legacyHidden: [],
        disclosure: workspaceDisclosure('/recreated'),
      })
    }
    setOz(oz)
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())
    await waitFor(() => expect(screen.getByText('Nothing queued')).toBeDefined())

    fireEvent.click(screen.getByText('Workspaces'))
    fireEvent.click(await screen.findByText('New workspace'))
    fireEvent.change(await screen.findByPlaceholderText('e.g. AcmeCRM, Vault, Internal Tools'), { target: { value: 'CoCoder' } })
    fireEvent.change(screen.getByPlaceholderText('cocoder-cli'), { target: { value: 'CoCoder' } })
    fireEvent.change(screen.getByPlaceholderText('~/dev/cocoder-cli'), { target: { value: '/recreated' } })
    fireEvent.click(screen.getByText('Create & open'))

    await waitFor(() => expect(workspaceCreates).toHaveLength(1))
    await waitFor(() => expect(screen.getByText('Onboard existing repo')).toBeDefined())

    fireEvent.click(within(rowForText('Onboard existing repo')).getByText('Launch'))

    await waitFor(() => expect(posts.find((p) => p.path === '/runs')).toBeDefined())
    expect(posts.find((p) => p.path === '/runs')?.body).toMatchObject({
      workspaceId: 'cocoder',
      priorityId: 'onboard-existing',
    })
    expect(getPaths.filter((path) => path === '/workspaces/cocoder/priorities').length).toBeGreaterThan(1)
  })

  it('New workspace folder button fills the primary root from the native picker seam', async () => {
    const workspaceCreates: WorkspaceCreateCall[] = []
    const validateRootCalls: ValidateRootCall[] = []
    setOz(mockOz({ workspaceCreates, validateRootCalls, workspacePickResult: ok({ path: '/picked/root' }) }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Workspaces'))
    fireEvent.click(await screen.findByText('New workspace'))
    fireEvent.change(await screen.findByPlaceholderText('e.g. AcmeCRM, Vault, Internal Tools'), { target: { value: 'Picked Workspace' } })
    fireEvent.change(screen.getByPlaceholderText('cocoder-cli'), { target: { value: 'Picked Root' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick primary root folder' }))

    await waitFor(() => expect(screen.getByDisplayValue('/picked/root')).toBeDefined())
    fireEvent.click(screen.getByText('Create & open'))

    await waitFor(() => expect(workspaceCreates.length).toBe(1))
    expect(validateRootCalls).toEqual([{ path: '/picked/root' }])
    expect(workspaceCreates[0]).toEqual({
      workspaceId: 'picked-workspace',
      folders: [
        { name: 'Picked Root', path: '/picked/root', role: 'primary' },
        { name: 'CoCoder', path: '${COCODER_HOME}', role: 'readonly' },
      ],
    })
  })

  it('New workspace shows picker validation errors inline', async () => {
    const workspaceCreates: WorkspaceCreateCall[] = []
    setOz(mockOz({ workspaceCreates, workspacePickResult: { ok: false, status: 400, error: 'primary root must not be inside the CoCoder install root' } }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Workspaces'))
    fireEvent.click(await screen.findByText('New workspace'))
    fireEvent.click(screen.getByRole('button', { name: 'Pick primary root folder' }))

    await waitFor(() => expect(screen.getByText('primary root must not be inside the CoCoder install root')).toBeDefined())
    expect(workspaceCreates).toEqual([])
  })

  it('New workspace validates a typed primary root before create', async () => {
    const workspaceCreates: WorkspaceCreateCall[] = []
    setOz(mockOz({ workspaceCreates, workspaceValidateResult: { ok: false, status: 400, error: 'primary root does not exist or is not a directory: /missing' } }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Live')).toBeDefined())

    fireEvent.click(screen.getByText('Workspaces'))
    fireEvent.click(await screen.findByText('New workspace'))
    fireEvent.change(await screen.findByPlaceholderText('e.g. AcmeCRM, Vault, Internal Tools'), { target: { value: 'Bad Workspace' } })
    fireEvent.change(screen.getByPlaceholderText('cocoder-cli'), { target: { value: 'Bad Root' } })
    fireEvent.change(screen.getByPlaceholderText('~/dev/cocoder-cli'), { target: { value: '/missing' } })
    fireEvent.click(screen.getByText('Create & open'))

    await waitFor(() => expect(screen.getByText('primary root does not exist or is not a directory: /missing')).toBeDefined())
    expect(workspaceCreates).toEqual([])
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

  it('does not fetch run detail when the bridge reports fixtures mode', async () => {
    const getPaths: string[] = []
    setOz(mockOz({ getPaths, healthState: 'fixtures' }))
    render(<App />)

    await act(async () => {
      await sleep(20)
    })

    expect(getPaths.filter((path) => /^\/runs\/[^/]+$/.test(path))).toHaveLength(0)
    cleanup()
  })
})
