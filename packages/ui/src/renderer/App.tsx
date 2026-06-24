// Oz renderer root — rebuilt against the V1 claude.ai/design prototype (packages/ui/design-ref/).
// Composes the Fusion shell (Sidebar + TopBar workspace tabs) and routes to the Dashboard plus the
// workspace/config screens with the creation modals. This slice renders
// the design-faithful view-model from the ported seed (fixture parity, fully interactive); the daemon
// adapter is wired in the next slice (the existing electron/ plumbing is untouched).
import { useEffect, useMemo, useRef, useState } from 'react'
import { ozApi, loadWorkspaces, loadClis, loadWsData, loadRawRunDetail, loadRunDetail, sendOzMessage, launchRun, launchTicketRun, attachRun, teardownRun, stopRun, confirmArchiveRun, testCli, createPriority, createTicket, createWorkspace, deleteWorkspace, updateWorkspace, loadOrder, persistOrder, persistTicketOrder, saveAssignments, restartDaemon, type ConnectionState } from './live.ts'
import { ADHOC_PRIORITY_ID, MODE_HONORED_PERSONAS, applyOrder, isActiveRun, mergeRunsWithEnrichment, orderPersonas, personasToAssignments } from './adapter.ts'
import { Sidebar, type Route } from './ui/Sidebar.tsx'
import { TopBar } from './ui/TopBar.tsx'
import { Dashboard } from './sections/dashboard/Dashboard.tsx'
import { WorkspacesScreen } from './sections/Workspaces.tsx'
import { CLIsScreen } from './sections/CLIs.tsx'
import { PersonasScreen } from './sections/Personas.tsx'
import { PlaysScreen } from './sections/Plays.tsx'
import { SettingsScreen } from './sections/Settings.tsx'
import { NewWorkspaceModal, CraftPersonaModal, NewPriorityModal, NewTicketModal } from './sections/modals.tsx'
import { LaunchProgressModal, launchFailure, launchIsUp, type LaunchProgressState } from './sections/LaunchProgressModal.tsx'
import { seed, DEFAULT_SETTINGS, DEFAULT_PANEL_RATIO, type ChatMessage, type Cli, type Dependency, type Persona, type Play, type Priority, type Ticket, type Run, type Settings, type SubAgent, type Workspace } from './model.ts'
import type { OzEventHint, PersonaAssignment, WorkspaceCreateDisclosure } from '../main/ipc-contract.ts'

const USER = seed.workspaces.length ? { initials: 'AF', name: 'Anthony Franco', role: 'founder' } : { initials: 'AF', name: 'Anthony Franco', role: 'founder' }
const ROUTE_TITLE: Record<Route, string> = { dashboard: 'Dashboard', workspaces: 'Workspaces', clis: 'CLIs', personas: 'Personas', plays: 'Plays', settings: 'Settings' }
const ACTIVE_DETAIL_FETCH_LIMIT = 6
const GLOBAL_CHAT_KEY = ''
const LAUNCH_PROGRESS_POLL_MS = 600
const CLOSED_LAUNCH_PROGRESS: LaunchProgressState = { open: false, title: '', runId: null, detail: null, error: null }

function workspaceCreateMessage(disclosure: WorkspaceCreateDisclosure, legacyHidden: readonly string[]): string {
  const roots = disclosure.roots.map((root) => `${root.role}: ${root.rawPath ?? root.path}`).join('; ')
  const outside = disclosure.outsideCocoderFiles.length ? disclosure.outsideCocoderFiles.join(', ') : 'none'
  const legacy = legacyHidden.length ? ` Legacy workspaces no longer served: ${legacyHidden.join(', ')}.` : ''
  return [
    'Workspace created.',
    `Primary root: ${disclosure.primaryRoot}.`,
    `Roots: ${roots}.`,
    `Git initialized: ${disclosure.initializedRepo ? 'yes' : 'no'}.`,
    `Baseline commit: ${disclosure.baselineCommitted ? 'yes' : 'no'}.`,
    `Outside cocoder/: ${outside}.`,
  ].join(' ') + legacy
}

const seedSettings = (): Settings => {
  // The prototype settings nest extra keys; map onto our typed shape, falling back to defaults.
  const s = (seed as unknown as { settings?: Partial<Settings> }).settings
  return {
    pollIntervalMs: s?.pollIntervalMs ?? DEFAULT_SETTINGS.pollIntervalMs,
    defaultWorkspaceId: s?.defaultWorkspaceId ?? DEFAULT_SETTINGS.defaultWorkspaceId,
    ozAutoCompactRuns: s?.ozAutoCompactRuns ?? DEFAULT_SETTINGS.ozAutoCompactRuns,
    preferences: { ...DEFAULT_SETTINGS.preferences, ...(s?.preferences ?? {}) },
    watching: { ...DEFAULT_SETTINGS.watching, ...(s?.watching ?? {}) },
    advanced: { ...DEFAULT_SETTINGS.advanced, ...(s?.advanced ?? {}) },
  }
}

const mergeSettings = (base: Settings, patch: Partial<Settings>): Settings => ({
  pollIntervalMs: patch.pollIntervalMs ?? base.pollIntervalMs,
  defaultWorkspaceId: patch.defaultWorkspaceId ?? base.defaultWorkspaceId,
  ozAutoCompactRuns: patch.ozAutoCompactRuns ?? base.ozAutoCompactRuns,
  preferences: { ...base.preferences, ...(patch.preferences ?? {}) },
  watching: { ...base.watching, ...(patch.watching ?? {}) },
  advanced: { ...base.advanced, ...(patch.advanced ?? {}) },
})

const greeting = (wsName: string): ChatMessage => ({ id: 'm0', role: 'oz', time: 'now', body: `Watching **${wsName}**. Ask me to launch a priority, reorder the queue, kick off an ad-hoc run, or just ask for status. Everything on this dashboard is something you can also ask me here.` })

function ozReply(text: string): ChatMessage {
  const t = text.trim().toLowerCase()
  let body: string
  if (t.includes('status')) body = 'Nothing is blocked right now beyond what\'s shown. Top of the queue is next up — say **launch the next priority** and I\'ll dispatch the team.'
  else if (t.startsWith('launch') || t.includes('launch ')) body = 'On it — dispatching the team. Watch the run summary expand on the priority row, or open it for the live transcript.'
  else if (t.includes('reorder') || t.includes('promote')) body = 'Reordered. Top of the queue is next up. (Drag the rows too — both stay in sync.)'
  else body = `Got it: “${text}”. In the wired build this drives the orchestrator (POST /oz/messages); for now I\'m the design-faithful stand-in.`
  return { id: `m${Date.now()}`, role: 'oz', time: 'now', body }
}

// Honest empty state when a live launch can't reach the daemon — no seed demo masquerading as real data.
function ConnectionPanel({ conn, onRetry }: { conn: ConnectionState; onRetry: () => void }) {
  const offline = conn === 'offline'
  return (
    <div className="oz-empty" style={{ margin: 'auto', maxWidth: 460, padding: '48px 24px', textAlign: 'center' }}>
      <div className="oz-empty-icon" style={{ width: 52, height: 52 }} aria-hidden>{offline ? '⚠' : '…'}</div>
      <div className="oz-empty-title">{offline ? 'Daemon offline' : 'Connecting to the daemon…'}</div>
      <div className="oz-empty-body">
        {offline
          ? 'The CoCoder daemon at 127.0.0.1:7878 isn’t answering. Start it (scripts/oz.sh start) and retry.'
          : 'Reaching the CoCoder daemon at 127.0.0.1:7878.'}
      </div>
      {offline && <button className="oz-btn oz-btn-secondary oz-btn-sm" onClick={onRetry} style={{ marginTop: 14 }}>Retry</button>}
    </div>
  )
}

export function App() {
  const [route, setRoute] = useState<Route>('dashboard')
  const [workspaces, setWorkspaces] = useState<Workspace[]>(seed.workspaces)
  const [activeId, setActiveId] = useState(workspaces[0]?.id ?? '')
  const [loadedIds, setLoadedIds] = useState<string[]>(workspaces[0] ? [workspaces[0].id] : [])
  const [chatTarget, setChatTarget] = useState<string | null>(workspaces[0]?.id ?? null)

  const seedPriorities = (seed as unknown as { priorities?: Record<string, Priority[]> }).priorities ?? {}
  const seedTickets = (seed as unknown as { tickets?: Record<string, Ticket[]> }).tickets ?? {}
  const seedChat = (seed as unknown as { ozChat?: Record<string, ChatMessage[]> }).ozChat ?? {}
  const [prioritiesByWs, setPrioritiesByWs] = useState<Record<string, Priority[]>>(() => Object.fromEntries(workspaces.map((w) => [w.id, [...(seedPriorities[w.id] ?? [])]])))
  const [ticketsByWs, setTicketsByWs] = useState<Record<string, Ticket[]>>(() => Object.fromEntries(workspaces.map((w) => [w.id, [...(seedTickets[w.id] ?? [])]])))
  const [runsByWs, setRunsByWs] = useState<Record<string, Run[]>>(seed.runsByWs)
  const [configuredByWs, setConfiguredByWs] = useState<Record<string, boolean>>({})
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [msgsByWs, setMsgsByWs] = useState<Record<string, ChatMessage[]>>(() => Object.fromEntries(workspaces.map((w) => [w.id, [...(seedChat[w.id] ?? [])]])))
  const [ozTyping, setOzTyping] = useState(false)
  const [chatPrefill, setChatPrefill] = useState<string | null>(null)

  // global-ish config (the prototype treats these as workspace-independent)
  const [personas, setPersonas] = useState<Persona[]>(() => orderPersonas(seed.personas))
  const [plays, setPlays] = useState<Play[]>(seed.plays)
  const [personaAssignments, setPersonaAssignments] = useState<Record<string, PersonaAssignment>>({})
  const [clis, setClis] = useState<Cli[]>(seed.clis)
  const [dependencies, setDependencies] = useState(seed.dependencies)
  const [settings, setSettings] = useState<Settings>(seedSettings)
  const theme = settings.preferences.theme
  const [newWsOpen, setNewWsOpen] = useState(false)
  const [craftOpen, setCraftOpen] = useState(false)
  const [newPriorityOpen, setNewPriorityOpen] = useState(false)
  const [newTicketOpen, setNewTicketOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [launchProgress, setLaunchProgress] = useState<LaunchProgressState>(CLOSED_LAUNCH_PROGRESS)

  // ── Live daemon wiring ── source is decided by window.oz.health(): 'fixtures' (or no bridge, e.g.
  // jsdom tests) keeps the ported seed; 'connected' loads real data through the adapter; otherwise we
  // show an honest offline state. clis/dependencies/ozChat/settings stay seed-backed (pending endpoints).
  const [conn, setConn] = useState<ConnectionState>('connecting')
  const [live, setLive] = useState(false)
  const [pollMs, setPollMs] = useState(2500)
  const [reloadNonce, setReloadNonce] = useState(0) // bumped by Retry to re-attempt the connection
  const namesRef = useRef<Record<string, Record<string, string>>>({}) // wsId → (priorityId → title)
  const runsByWsRef = useRef<Record<string, Run[]>>(runsByWs)
  const activeIdRef = useRef(activeId)
  const selectedRunIdRef = useRef(selectedRunId)
  const runStatusRef = useRef<Record<string, Run['status']>>({})

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { setChatTarget(activeId || null) }, [activeId])
  useEffect(() => {
    if (chatTarget && !loadedIds.includes(chatTarget)) setChatTarget(activeId || null)
  }, [activeId, chatTarget, loadedIds])
  useEffect(() => { selectedRunIdRef.current = selectedRunId }, [selectedRunId])
  useEffect(() => { runsByWsRef.current = runsByWs }, [runsByWs])

  // Decide the data source once on mount and, when connected, replace workspaces/priorities/runs/personas
  // with live data. Seed state stays as the initial value so fixtures/tests render immediately.
  useEffect(() => {
    const oz = ozApi()
    if (!oz) { setConn('fixtures'); return }
    let cancelled = false
    const goOffline = (state: ConnectionState) => {
      // A bridge exists but the daemon isn't answering: never present seed demo data as if it were live.
      setLive(false); setConn(state); setWorkspaces([]); setRunsByWs({}); setPrioritiesByWs({}); setTicketsByWs({}); setConfiguredByWs({})
    }
    void (async () => {
      setConn('connecting')
      try {
        const s = await oz.settingsGet()
        if (!cancelled) {
          setPollMs(s.pollIntervalMs)
          setSettings((cur) => mergeSettings(cur, s as Partial<Settings>))
        }
      } catch { /* keep seed-backed renderer settings */ }
      let health
      try { health = await oz.health() } catch { if (!cancelled) goOffline('offline'); return }
      if (cancelled) return
      if (health.state === 'fixtures') { setConn('fixtures'); return }
      if (health.state !== 'connected') { goOffline(health.state); return }
      setConn('connected')
      const cs = await loadClis(oz)
      if (!cancelled && cs.length) setClis(cs)
      const wss = await loadWorkspaces(oz)
      if (cancelled) return
      if (!wss.length) { goOffline('offline'); return }
      setWorkspaces(wss)
      const first = wss[0]
      setActiveId(first.id); setLoadedIds([first.id])
      const data = await loadWsData(oz, first.id)
      const order = await loadOrder(oz, first.id)
      if (cancelled) return
      namesRef.current[first.id] = data.names
      setConfiguredByWs((cur) => ({ ...cur, [first.id]: data.configured }))
      setPrioritiesByWs((cur) => ({ ...cur, [first.id]: applyOrder(data.priorities, order) }))
      setTicketsByWs((cur) => ({ ...cur, [first.id]: data.tickets }))
      setRunsByWs((cur) => ({ ...cur, [first.id]: data.runs }))
      void enrichActiveRunDetails(first.id, data.runs)
      setPlays(data.plays)
      if (data.personas.length) {
        setPersonas(orderPersonas(data.personas))
        setPersonaAssignments(data.assignments)
      }
      setLive(true)
    })()
    return () => { cancelled = true }
  }, [reloadNonce])

  // Active-row enrichment is intentionally bounded: each live cycle fetches detail for at most six
  // active (running/blocked) runs; they follow pollMs.
  useEffect(() => {
    if (!live) return
    let stop = false
    const tick = () => {
      const wsId = activeIdRef.current
      if (!wsId || document.hidden) return
      void enrichActiveRunDetails(wsId, undefined, () => stop)
    }
    const id = setInterval(tick, pollMs)
    return () => { stop = true; clearInterval(id) }
  }, [live, pollMs])

  // Poll the open run's detail (~pollMs) for the live transcript/evidence; pause when the window is
  // hidden, and fetch once immediately on open. Only runs in live mode.
  useEffect(() => {
    if (!live || !selectedRunId) return
    const oz = ozApi()
    if (!oz) return
    const ws = activeId
    let stop = false
    const tick = async () => {
      if (document.hidden) return
      await refreshRunDetail(selectedRunId, ws, () => stop)
    }
    void tick()
    const id = setInterval(() => void tick(), pollMs)
    return () => { stop = true; clearInterval(id) }
  }, [live, selectedRunId, activeId, pollMs])

  useEffect(() => {
    if (!live || !launchProgress.open || !launchProgress.runId || launchProgress.error) return
    const oz = ozApi()
    if (!oz) return
    let stopped = false
    const tick = async () => {
      const detail = await loadRawRunDetail(oz, launchProgress.runId!)
      if (stopped || !detail) return
      const failure = launchFailure(detail)
      if (failure) {
        setLaunchProgress((cur) => (cur.open && cur.runId === detail.run.id ? { ...cur, detail, error: failure } : cur))
        return
      }
      if (launchIsUp(detail)) {
        setLaunchProgress((cur) => (cur.open && cur.runId === detail.run.id ? CLOSED_LAUNCH_PROGRESS : cur))
        return
      }
      setLaunchProgress((cur) => (cur.open && cur.runId === detail.run.id ? { ...cur, detail } : cur))
    }
    void tick()
    const id = window.setInterval(() => void tick(), LAUNCH_PROGRESS_POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [live, launchProgress.open, launchProgress.runId, launchProgress.error])

  useEffect(() => {
    if (!live) return
    const oz = ozApi()
    if (!oz?.onOzEvent) return
    const workspacesToRefresh = new Set<string>()
    const runsToRefresh = new Map<string, string>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      const workspaceIds = [...workspacesToRefresh]
      const runIds = [...runsToRefresh]
      workspacesToRefresh.clear()
      runsToRefresh.clear()
      for (const wsId of workspaceIds) void refreshWorkspace(wsId)
      for (const [runId, wsId] of runIds) void refreshRunDetail(runId, wsId)
    }
    const onEvent = (event: OzEventHint) => {
      const wsId = event.workspaceId ?? activeIdRef.current
      if (wsId) workspacesToRefresh.add(wsId)
      if (event.runId && event.runId === selectedRunIdRef.current) runsToRefresh.set(event.runId, wsId)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 250)
    }
    const unsubscribe = oz.onOzEvent(onEvent)
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [live])

  // Lazy-load a workspace's data the first time it becomes active (switching tabs in live mode).
  useEffect(() => {
    if (!live || !activeId || namesRef.current[activeId]) return
    const oz = ozApi()
    if (!oz) return
    let cancelled = false
    void (async () => {
      const data = await loadWsData(oz, activeId)
      const order = await loadOrder(oz, activeId)
      if (cancelled) return
      namesRef.current[activeId] = data.names
      setConfiguredByWs((cur) => ({ ...cur, [activeId]: data.configured }))
      setPrioritiesByWs((cur) => ({ ...cur, [activeId]: applyOrder(data.priorities, order) }))
      setTicketsByWs((cur) => ({ ...cur, [activeId]: data.tickets }))
      setRunsByWs((cur) => ({ ...cur, [activeId]: data.runs }))
      void enrichActiveRunDetails(activeId, data.runs, () => cancelled)
      setPlays(data.plays)
      if (data.personas.length) {
        setPersonas(orderPersonas(data.personas))
        setPersonaAssignments(data.assignments)
      }
    })()
    return () => { cancelled = true }
  }, [live, activeId])

  const workspace = workspaces.find((w) => w.id === activeId) ?? workspaces[0]
  const priorities = prioritiesByWs[activeId] ?? []
  const tickets = ticketsByWs[activeId] ?? []
  const runs = useMemo(() => runsByWs[activeId] ?? [], [runsByWs, activeId])
  const chatKey = chatTarget ?? GLOBAL_CHAT_KEY
  const chatWorkspace = chatTarget ? workspaces.find((w) => w.id === chatTarget) ?? null : null
  const chatTargetName = chatTarget ? chatWorkspace?.name ?? chatTarget : 'Global Oz'
  const chatRuns = chatTarget ? runsByWs[chatTarget] ?? [] : []
  const loadedWorkspaces = loadedIds.map((id) => workspaces.find((w) => w.id === id)).filter(Boolean) as Workspace[]
  const messages = (msgsByWs[chatKey] && msgsByWs[chatKey].length ? msgsByWs[chatKey] : [greeting(chatTargetName)])

  function selectWs(id: string) { setActiveId(id); setSelectedRunId(null) }
  function loadWs(id: string) { setLoadedIds((ids) => (ids.includes(id) ? ids : [...ids, id])); selectWs(id) }
  function closeWs(id: string) { setLoadedIds((ids) => ids.filter((x) => x !== id)); if (activeId === id) { const next = loadedIds.find((x) => x !== id); if (next) selectWs(next) } }

  function pushMsg(targetKey: string, m: ChatMessage) { setMsgsByWs((cur) => ({ ...cur, [targetKey]: [...(cur[targetKey] ?? []), m] })) }
  function saveSettings(next: Settings): void {
    setSettings(next)
    const oz = ozApi()
    if (oz) void oz.settingsSet({ ozAutoCompactRuns: next.ozAutoCompactRuns, preferences: next.preferences }).then((saved) => setSettings((cur) => mergeSettings(cur, saved as Partial<Settings>))).catch(() => undefined)
  }
  function setTheme(fn: (t: 'dark' | 'light') => 'dark' | 'light'): void {
    const nextTheme = fn(settings.preferences.theme)
    saveSettings({ ...settings, preferences: { ...settings.preferences, theme: nextTheme } })
  }
  function setPanelRatio(panelRatio: number): void {
    saveSettings({ ...settings, preferences: { ...settings.preferences, panelRatio } })
  }
  function onSend(text: string) {
    const targetKey = chatTarget ?? GLOBAL_CHAT_KEY
    pushMsg(targetKey, { id: `u${Date.now()}`, role: 'user', time: 'now', body: text })
    setOzTyping(true)
    if (!live) {
      setTimeout(() => { setOzTyping(false); pushMsg(targetKey, ozReply(text)) }, 650)
      return
    }
    const oz = ozApi()
    if (!oz) {
      setOzTyping(false)
      notify('err', 'Oz chat failed: daemon bridge unavailable.')
      return
    }
    void (async () => {
      try {
        pushMsg(targetKey, await sendOzMessage(oz, targetKey, text))
        if (chatTarget) await refreshWorkspace(chatTarget)
      } catch {
        notify('err', 'Oz chat failed.')
      } finally {
        setOzTyping(false)
      }
    })()
  }
  function reorder(from: number, to: number) {
    const list = [...(prioritiesByWs[activeId] ?? [])]
    const [moved] = list.splice(from, 1)
    list.splice(to, 0, moved)
    setPrioritiesByWs((cur) => ({ ...cur, [activeId]: list }))
    // Persist the order through the daemon-backed main-process seam, with local cache fallback.
    if (live) { const oz = ozApi(); if (oz) void persistOrder(oz, activeId, list.map((p) => p.id)) }
  }
  function reorderTickets(from: number, to: number) {
    const list = ticketsByWs[activeId] ?? []
    const open = list.filter((ticket) => ticket.state === 'open')
    const closed = list.filter((ticket) => ticket.state === 'closed')
    const [moved] = open.splice(from, 1)
    if (!moved) return
    open.splice(to, 0, moved)
    setTicketsByWs((cur) => ({ ...cur, [activeId]: [...open, ...closed] }))
    if (live) { const oz = ozApi(); if (oz) void persistTicketOrder(oz, activeId, open.map((ticket) => ticket.id)) }
  }
  function addPriority(name: string, summary: string, placeAtTop: boolean) {
    const p: Priority = { id: `p${Date.now()}`, name, summary, status: 'ready', labels: ['persona-build'] }
    setPrioritiesByWs((cur) => ({ ...cur, [activeId]: placeAtTop ? [p, ...(cur[activeId] ?? [])] : [...(cur[activeId] ?? []), p] }))
  }

  // ── Live mutations ── all routed through the auth-correct main client (window.oz). In fixtures/seed/
  // test mode (`!live`) the actions keep the design's chat-stub behavior so the demo stays interactive.
  const [actionMsg, setActionMsg] = useState<{ kind: 'ok' | 'info' | 'err'; text: string } | null>(null)
  const notify = (kind: 'ok' | 'info' | 'err', text: string) => { setActionMsg({ kind, text }); window.setTimeout(() => setActionMsg(null), 6000) }
  const openLaunchProgress = (title: string): void => setLaunchProgress({ open: true, title, runId: null, detail: null, error: null })
  const closeLaunchProgress = (): void => setLaunchProgress(CLOSED_LAUNCH_PROGRESS)
  const setLaunchProgressError = (text: string): void => setLaunchProgress((cur) => ({ ...cur, open: true, error: text }))
  function launchedRunId(data: unknown): string | null {
    return typeof data === 'object' && data !== null && typeof (data as { runId?: unknown }).runId === 'string' ? (data as { runId: string }).runId : null
  }
  async function refreshActiveWs() {
    await refreshWorkspace(activeId)
  }
  async function refreshWorkspace(wsId: string) {
    const oz = ozApi()
    if (!oz) return
    const data = await loadWsData(oz, wsId)
    const order = await loadOrder(oz, wsId)
    namesRef.current[wsId] = data.names
    const mergedRuns = mergeRunsWithEnrichment(data.runs, runsByWsRef.current[wsId] ?? [])
    setConfiguredByWs((cur) => ({ ...cur, [wsId]: data.configured }))
    setPrioritiesByWs((cur) => ({ ...cur, [wsId]: applyOrder(data.priorities, order) }))
    setTicketsByWs((cur) => ({ ...cur, [wsId]: data.tickets }))
    setRunsByWs((cur) => ({ ...cur, [wsId]: mergedRuns }))
    void enrichActiveRunDetails(wsId, mergedRuns)
  }
  async function refreshRunDetail(runId: string, wsId: string, shouldSkip: () => boolean = () => false): Promise<boolean> {
    const oz = ozApi()
    if (!oz || shouldSkip()) return false
    const enriched = await loadRunDetail(oz, runId, namesRef.current[wsId] ?? {})
    if (!enriched || shouldSkip()) return false
    setRunsByWs((cur) => ({ ...cur, [wsId]: (cur[wsId] ?? []).map((r) => (r.id === enriched.id ? enriched : r)) }))
    return true
  }
  function runKey(wsId: string, runId: string): string {
    return `${wsId}:${runId}`
  }
  function syncRunStatusTracking(wsId: string, runsForWs: readonly Run[]): void {
    const prefix = `${wsId}:`
    const seen = new Set<string>()
    for (const run of runsForWs) {
      const key = runKey(wsId, run.id)
      seen.add(key)
      runStatusRef.current[key] = run.status
    }
    for (const key of Object.keys(runStatusRef.current)) {
      if (!key.startsWith(prefix) || seen.has(key)) continue
      delete runStatusRef.current[key]
    }
  }
  async function enrichActiveRunDetails(wsId: string, sourceRuns?: readonly Run[], shouldSkip: () => boolean = () => false): Promise<void> {
    if (shouldSkip() || document.hidden || !namesRef.current[wsId]) return
    const runsForWs = sourceRuns ?? runsByWsRef.current[wsId] ?? []
    syncRunStatusTracking(wsId, runsForWs)
    const selected = selectedRunIdRef.current
    const liveRuns = runsForWs.filter((run) => run.id !== selected && (run.status === 'running' || run.status === 'blocked'))
    const candidates = liveRuns.slice(0, ACTIVE_DETAIL_FETCH_LIMIT)
    for (const run of candidates) {
      if (shouldSkip() || document.hidden) return
      await refreshRunDetail(run.id, wsId, shouldSkip)
    }
  }
  async function refreshWorkspaces(): Promise<Workspace[]> {
    const oz = ozApi()
    if (!oz) return workspaces
    const next = await loadWorkspaces(oz)
    if (next.length) setWorkspaces(next)
    return next
  }
  const workspaceSlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-')
  async function handleSaveWorkspace(ws: Workspace): Promise<void> {
    if (!live) { setWorkspaces((all) => all.map((w) => (w.id === ws.id ? ws : w))); return }
    const oz = ozApi()
    if (!oz) { notify('err', 'Workspace save failed: daemon bridge unavailable.'); return }
    const res = await updateWorkspace(oz, ws)
    if (!res.ok) { notify('err', res.error); return }
    await refreshWorkspaces()
    notify('ok', 'Workspace saved.')
  }
  async function handleDeleteWorkspace(id: string): Promise<void> {
    if (!live) {
      setWorkspaces((all) => all.filter((w) => w.id !== id))
      return
    }
    const oz = ozApi()
    if (!oz) { notify('err', 'Workspace delete failed: daemon bridge unavailable.'); return }
    const res = await deleteWorkspace(oz, id)
    if (!res.ok) { notify('err', res.error); return }
    const next = await refreshWorkspaces()
    if (activeId === id) {
      const first = next.find((w) => w.id !== id) ?? next[0]
      if (first) selectWs(first.id)
    }
    notify('ok', 'Workspace deleted.')
  }
  async function handlePickWorkspaceRoot(): Promise<{ readonly path: string | null; readonly error?: string }> {
    const oz = ozApi()
    if (!oz) return { path: `~/dev/new-root` }
    const res = await oz.workspaceDirectoryPick()
    if (!res.ok) return { path: null, error: res.error }
    return { path: res.data.path }
  }
  async function handleValidateWorkspaceRoot(path: string): Promise<string | null> {
    if (!live) return null
    const oz = ozApi()
    if (!oz) return 'Workspace create failed: daemon bridge unavailable.'
    const res = await oz.workspacePrimaryRootValidate(path)
    return res.ok ? null : res.error
  }
  async function handleCreateWorkspace(input: { name: string; description: string; root: { name: string; path: string } }): Promise<boolean> {
    if (!live) {
      const id = `ws-${Date.now()}`
      const ws: Workspace = { id, name: input.name, description: input.description, icon: 'ph-thin ph-cube', created: 'just now', roots: [{ id: `r${Date.now()}`, name: input.root.name, path: input.root.path, role: 'primary' }] }
      setWorkspaces((all) => [...all, ws]); setPrioritiesByWs((cur) => ({ ...cur, [id]: [] })); loadWs(id); setRoute('dashboard')
      return true
    }
    const oz = ozApi()
    if (!oz) { notify('err', 'Workspace create failed: daemon bridge unavailable.'); return false }
    const id = workspaceSlug(input.name)
    const folders = [
      { name: input.root.name, path: input.root.path, role: 'primary' as const, ...(input.description ? { description: input.description } : {}) },
      ...(input.root.path === '${COCODER_HOME}' ? [] : [{ name: 'CoCoder', path: '${COCODER_HOME}', role: 'readonly' as const }]),
    ]
    const res = await createWorkspace(oz, id, folders)
    if (!res.ok) { notify('err', res.error); return false }
    await refreshWorkspaces()
    await refreshWorkspace(res.data.workspace.id)
    loadWs(res.data.workspace.id)
    setRoute('dashboard')
    notify(res.data.legacyHidden.length ? 'info' : 'ok', workspaceCreateMessage(res.data.disclosure, res.data.legacyHidden))
    return true
  }
  async function handleCreatePriority(p: { title: string; goal?: string; placeAtTop: boolean }): Promise<boolean> {
    const goal = p.goal?.trim() ? p.goal.trim() : undefined
    if (!live) {
      addPriority(p.title, goal ?? '', p.placeAtTop)
      setRoute('dashboard')
      return true
    }
    const oz = ozApi()
    if (!oz) {
      notify('err', 'Priority create failed: daemon bridge unavailable.')
      return false
    }
    const res = await createPriority(oz, activeId, goal ? { title: p.title, goal } : { title: p.title })
    if (!res.ok) {
      notify('err', res.error)
      return false
    }
    await refreshActiveWs()
    if (p.placeAtTop) {
      const order = [res.data.id, ...priorities.filter((priority) => priority.id !== res.data.id).map((priority) => priority.id)]
      await persistOrder(oz, activeId, order)
      await refreshActiveWs()
    }
    setRoute('dashboard')
    return true
  }
  async function handleCreateTicket(t: { title: string; type: string; priority?: string; description?: string }): Promise<boolean> {
    if (!live) return false
    const oz = ozApi()
    if (!oz) {
      notify('err', 'Ticket create failed: daemon bridge unavailable.')
      return false
    }
    const priority = t.priority?.trim()
    const description = t.description?.trim()
    const res = await createTicket(oz, activeId, {
      title: t.title,
      type: t.type,
      ...(priority ? { priority } : {}),
      ...(description ? { description } : {}),
    })
    if (!res.ok) {
      notify('err', res.error)
      return false
    }
    notify('ok', 'Ticket created.')
    await refreshActiveWs()
    return true
  }
  // POST /runs launches a REAL run — only ever reached from a live user click, never in tests/CI.
  async function doLaunch(priorityId: string, label: string, resumeFromRunId?: string, strictPreRunDirt?: boolean, allowPreRunIntegrityErrors?: boolean) {
    const oz = ozApi()
    openLaunchProgress(`${label}…`)
    if (!oz) {
      setLaunchProgressError('Launch failed: daemon bridge unavailable.')
      return
    }
    const res = await launchRun(oz, activeId, priorityId, resumeFromRunId, strictPreRunDirt, allowPreRunIntegrityErrors)
    if (res.ok) {
      const runId = launchedRunId(res.data)
      if (!runId) {
        setLaunchProgressError('Launch started, but Oz did not return a run id.')
        return
      }
      setLaunchProgress((cur) => ({ ...cur, runId }))
      notify('ok', `${label}…`)
      await refreshActiveWs()
    } else if (res.status === 409) {
      const message = 'A run is already in flight for this workspace.'
      setLaunchProgressError(message)
      notify('info', message)
    } else {
      const message = res.error || `Launch failed (${res.status}).`
      setLaunchProgressError(message)
      notify('err', message)
    }
  }
  function handleLaunch(p: Priority, strictPreRunDirt?: boolean, allowPreRunIntegrityErrors?: boolean) {
    if (!live) { onSend(`Launch the priority “${p.name}”.`); return }
    void doLaunch(p.id, `Launching “${p.name}”`, undefined, strictPreRunDirt, allowPreRunIntegrityErrors)
  }
  async function doLaunchTicket(ticketId: string, label: string) {
    const oz = ozApi()
    openLaunchProgress(`${label}…`)
    if (!oz) {
      setLaunchProgressError('Launch failed: daemon bridge unavailable.')
      return
    }
    const res = await launchTicketRun(oz, activeId, ticketId)
    if (res.ok) {
      const runId = launchedRunId(res.data)
      if (!runId) {
        setLaunchProgressError('Launch started, but Oz did not return a run id.')
        return
      }
      setLaunchProgress((cur) => ({ ...cur, runId }))
      notify('ok', `${label}…`)
      await refreshActiveWs()
    } else if (res.status === 409) {
      const message = 'A run is already in flight for this workspace.'
      setLaunchProgressError(message)
      notify('info', message)
    } else {
      const message = res.error || `Launch failed (${res.status}).`
      setLaunchProgressError(message)
      notify('err', message)
    }
  }
  function handleLaunchTicket(ticket: Ticket) {
    if (!live) { onSend(`Launch a fix run for ticket ${ticket.id}.`); return }
    void doLaunchTicket(ticket.id, `Launching fix for ${ticket.id}`)
  }
  function handleAdhoc() {
    if (!live) { onSend('Run an ad-hoc task: '); return }
    setChatPrefill('adhoc ')
  }
  function handleRunAction(action: string, id: string) {
    if (!live) { onSend(`${action} ${id}`); return }
    const oz = ozApi()
    if (!oz) return
    void (async () => {
      if (action === 'attach') {
        const res = await attachRun(oz, id)
        if (res.ok) notify('ok', 'Focused the run’s cmux pane.')
        else if (res.status === 409) notify('info', 'That run isn’t live — nothing to attach.')
        else notify('err', res.error || `Attach failed (${res.status}).`)
      } else if (action === 'retry') {
        const run = (runsByWs[activeId] ?? []).find((r) => r.id === id)
        await doLaunch(run?.priorityId ?? ADHOC_PRIORITY_ID, 'Resuming from this run', id)
      } else if (action === 'teardown') {
        const res = await teardownRun(oz, id)
        if (res.ok) { notify('ok', 'Closed the run’s panes.'); await refreshActiveWs() }
        else notify('err', res.error || `Teardown failed (${res.status}).`)
      } else if (action === 'stop') {
        const res = await stopRun(oz, id)
        if (res.ok) { notify('ok', 'Stop requested — the run winds down at its next checkpoint.'); await refreshActiveWs() }
        else notify('err', res.error || `Stop failed (${res.status}).`)
      } else if (action === 'archive') {
        const res = await confirmArchiveRun(oz, id)
        if (res.ok) { notify('ok', 'Archive confirmed through the archive-priority Play.'); await refreshActiveWs() }
        else notify('err', res.error || `Archive failed (${res.status}).`)
      } else {
        notify('info', 'The Oz chat command interface is a pending endpoint.')
      }
    })()
  }
  async function handleRestartOz(): Promise<void> {
    if (!live) { notify('info', 'Restart applies to the live daemon only.'); return }
    const oz = ozApi()
    if (!oz) { notify('err', 'Restart failed: daemon bridge unavailable.'); return }
    if (!window.confirm('Restart Oz? This restarts the daemon and resets the chat session. It refuses while a run is in flight.')) return
    const res = await restartDaemon(oz)
    if (res.ok) {
      notify('info', 'Oz is restarting — reconnecting…')
      setLive(false); setConn('connecting')
      // The daemon detaches and respawns; give it a moment, then re-run the connection bootstrap.
      window.setTimeout(() => setReloadNonce((n) => n + 1), 2500)
    } else if (res.status === 409) {
      notify('info', res.error) // "refusing to restart: a run is in flight…" — surfaced verbatim
    } else {
      notify('err', res.error || `Restart failed (${res.status}).`)
    }
  }
  async function handleCliTest(id: string): Promise<void> {
    if (!live) {
      setClis((cs) => cs.map((c) => (c.id === id ? { ...c, tested: true, lastTested: 'just now' } : c)))
      return
    }
    const oz = ozApi()
    if (!oz) { notify('err', 'CLI test failed: daemon bridge unavailable.'); return }
    const cli = await testCli(oz, id)
    if (cli) setClis((cs) => cs.map((c) => (c.id === id ? cli : c)))
    else notify('err', 'CLI test failed.')
  }

  // persona editing
  async function persistPersonas(next: Persona[]): Promise<boolean> {
    if (!live) {
      setPersonas(next)
      return true
    }
    const oz = ozApi()
    if (!oz) {
      notify('err', 'Persona assignment save failed: daemon bridge unavailable.')
      return false
    }
    const assignments = personasToAssignments(next, personaAssignments)
    const res = await saveAssignments(oz, activeId, assignments)
    if (!res.ok) {
      notify('err', res.error || `Persona assignment save failed (${res.status}).`)
      return false
    }
    setPersonas(next)
    setPersonaAssignments(res.data as Record<string, PersonaAssignment>)
    notify('ok', 'Persona assignments saved.')
    return true
  }
  function setPersona(id: string, next: Persona) {
    const prev = personas.find((p) => p.id === id)
    const runModeChanged = prev?.runMode !== next.runMode && MODE_HONORED_PERSONAS.has(id)
    if (prev && prev.cli === next.cli && prev.model === next.model && prev.subAgents === next.subAgents && !runModeChanged) {
      setPersonas(personas.map((p) => (p.id === id ? next : p)))
      return
    }
    void persistPersonas(personas.map((p) => (p.id === id ? next : p)))
  }
  function addSub(pid: string, playId: string) {
    const id = playId.trim()
    if (!id) { notify('err', 'Play id is required.'); return }
    const persona = personas.find((p) => p.id === pid)
    if (!persona) { notify('err', 'Persona not found.'); return }
    if (persona.subAgents.some((s) => s.id === id)) { notify('err', `Play "${id}" is already assigned to ${persona.name}.`); return }
    const play = plays.find((entry) => entry.id === id)
    if (!play) { notify('err', 'Select an available Play from the catalog.'); return }
    const next = personas.map((p) => (p.id === pid ? { ...p, subAgents: [...p.subAgents, { id, name: play.label, cli: clis[0]?.id ?? 'claude', model: 'Default' }] } : p))
    void persistPersonas(next)
  }
  function removeSub(pid: string, sid: string) {
    void persistPersonas(personas.map((p) => (p.id === pid ? { ...p, subAgents: p.subAgents.filter((s: SubAgent) => s.id !== sid) } : p)))
  }
  function updateSub(pid: string, sid: string, sa: SubAgent) {
    void persistPersonas(personas.map((p) => (p.id === pid ? { ...p, subAgents: p.subAgents.map((s: SubAgent) => (s.id === sid ? sa : s)) } : p)))
  }

  return (
    <div className="oz-app" style={{ gridTemplateColumns: `${navCollapsed ? 64 : 220}px 1fr` }}>
      <Sidebar route={route} setRoute={setRoute} runs={runs} user={USER} collapsed={navCollapsed} onToggleCollapsed={() => setNavCollapsed((c) => !c)} />
      <div className="oz-main">
        <TopBar title={ROUTE_TITLE[route]} route={route} theme={theme} setTheme={setTheme} conn={conn} onRestartOz={() => void handleRestartOz()} />
        <div className="oz-content">
          {actionMsg && (
            <div role="status" style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 80, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 'var(--cb-radius-md)', fontSize: 12, color: 'var(--cb-text)', background: 'var(--cb-surface-raised)', border: `1px solid ${actionMsg.kind === 'err' ? 'var(--cb-highlight)' : actionMsg.kind === 'ok' ? 'var(--cb-success)' : 'var(--cb-border-strong)'}`, boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: actionMsg.kind === 'err' ? 'var(--cb-highlight)' : actionMsg.kind === 'ok' ? 'var(--cb-success)' : 'var(--cb-accent)' }} />
              {actionMsg.text}
            </div>
          )}
          {(conn === 'offline' || (conn === 'connecting' && !workspace)) ? (
            <ConnectionPanel conn={conn} onRetry={() => setReloadNonce((n) => n + 1)} />
          ) : (<>
          {route === 'dashboard' && workspace && (
            <Dashboard
              workspace={workspace} priorities={priorities} tickets={tickets} runs={runs} ozMessages={messages}
              workspaceConfigured={live ? configuredByWs[activeId] : undefined}
              selectedRunId={selectedRunId} setSelectedRunId={setSelectedRunId}
              onReorder={reorder} onReorderTickets={reorderTickets} onLaunch={handleLaunch} onAdhoc={handleAdhoc}
              onAddPriority={() => { if (live) setNewPriorityOpen(true); else onSend('Draft a new priority.') }}
              onAddTicket={() => { if (live) setNewTicketOpen(true); else onSend('Draft a new ticket.') }}
              onLaunchTicket={handleLaunchTicket}
              onSend={onSend} onDecision={(c: string) => onSend(`Decision: replay ${c} plan.`)} onRunAction={handleRunAction}
              ozTyping={ozTyping} live={live}
              chatPrefill={chatPrefill} onChatPrefillConsumed={() => setChatPrefill(null)}
              workspaces={workspaces} activeId={activeId} loadedIds={loadedIds} runsMap={runsByWs}
              onSelectWs={selectWs} onCloseWs={closeWs} onLoadWs={loadWs} onCreateWs={() => setNewWsOpen(true)}
              theme={theme} setTheme={setTheme} conn={conn} onRestartOz={() => void handleRestartOz()}
              chatTarget={chatTarget} chatTargets={loadedWorkspaces} onChatTargetChange={setChatTarget}
              chatTargetName={chatTargetName} chatRuns={chatRuns}
              panelRatio={settings.preferences.panelRatio ?? DEFAULT_PANEL_RATIO}
              onPanelRatioChange={setPanelRatio}
            />
          )}
          {route === 'workspaces' && (
            <WorkspacesScreen workspaces={workspaces} activeId={activeId} onChange={(ws) => setWorkspaces((all) => all.map((w) => (w.id === ws.id ? ws : w)))} onSetActive={loadWs} onCreate={() => setNewWsOpen(true)} onDelete={(id) => void handleDeleteWorkspace(id)} onSave={(ws) => void handleSaveWorkspace(ws)} onGotoDashboard={() => setRoute('dashboard')} onPickRoot={handlePickWorkspaceRoot} />
          )}
          {route === 'clis' && <CLIsScreen clis={clis} onTest={handleCliTest} onAdd={() => onSend('Register a new CLI.')} />}
          {route === 'personas' && <PersonasScreen personas={personas} plays={plays} clis={clis} onChange={setPersona} onAddSub={addSub} onRemoveSub={removeSub} onUpdateSub={updateSub} onNewPersonaAsPriority={() => setCraftOpen(true)} live={live} />}
          {route === 'plays' && <PlaysScreen plays={plays} />}
          {route === 'settings' && <SettingsScreen settings={settings} dependencies={dependencies} onRecheckDep={(id: string) => setDependencies((ds: Dependency[]) => ds.map((d: Dependency) => (d.id === id ? { ...d, lastChecked: 'just now' } : d)))} onChange={saveSettings} live={live} />}
          </>)}
        </div>
      </div>

      <NewWorkspaceModal open={newWsOpen} onClose={() => setNewWsOpen(false)} onCreate={handleCreateWorkspace} onPickRoot={handlePickWorkspaceRoot} onValidateRoot={handleValidateWorkspaceRoot} />
      <NewPriorityModal open={newPriorityOpen} onClose={() => setNewPriorityOpen(false)} onSubmit={handleCreatePriority} />
      <NewTicketModal open={newTicketOpen} onClose={() => setNewTicketOpen(false)} onSubmit={handleCreateTicket} />
      <CraftPersonaModal open={craftOpen} onClose={() => setCraftOpen(false)} clis={clis} onSubmit={({ name, summary, placeAtTop }) => handleCreatePriority({ title: name, goal: summary, placeAtTop })} />
      <LaunchProgressModal state={launchProgress} onClose={closeLaunchProgress} />
    </div>
  )
}
