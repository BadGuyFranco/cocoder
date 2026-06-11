// Oz renderer root — rebuilt against the V1 claude.ai/design prototype (packages/ui/design-ref/).
// Composes the Fusion shell (Sidebar + TopBar workspace tabs) and routes to the Dashboard + the four
// screens (Workspaces · CLIs · Personas · Settings) with the two creation modals. This slice renders
// the design-faithful view-model from the ported seed (fixture parity, fully interactive); the daemon
// adapter is wired in the next slice (the existing electron/ plumbing is untouched).
import { useEffect, useMemo, useRef, useState } from 'react'
import { ozApi, loadWorkspaces, loadClis, loadWsData, loadRunDetail, sendOzMessage, launchRun, attachRun, teardownRun, resolveRun, testCli, loadOrder, persistOrder, saveAssignments, type ConnectionState } from './live.ts'
import { ADHOC_PRIORITY_ID, applyOrder, personasToAssignments } from './adapter.ts'
import { Sidebar, type Route } from './ui/Sidebar.tsx'
import { TopBar } from './ui/TopBar.tsx'
import { Dashboard } from './sections/dashboard/Dashboard.tsx'
import { WorkspacesScreen } from './sections/Workspaces.tsx'
import { CLIsScreen } from './sections/CLIs.tsx'
import { PersonasScreen } from './sections/Personas.tsx'
import { SettingsScreen } from './sections/Settings.tsx'
import { NewWorkspaceModal, CraftPersonaModal } from './sections/modals.tsx'
import { seed, DEFAULT_SETTINGS, type ChatMessage, type Cli, type Dependency, type Persona, type Priority, type Run, type Settings, type SubAgent, type Workspace } from './model.ts'
import type { PersonaAssignment } from '../electron/ipc-contract.ts'

const USER = seed.workspaces.length ? { initials: 'AF', name: 'Anthony Franco', role: 'founder' } : { initials: 'AF', name: 'Anthony Franco', role: 'founder' }
const ROUTE_TITLE: Record<Route, string> = { dashboard: 'Dashboard', workspaces: 'Workspaces', clis: 'CLIs', personas: 'Personas', settings: 'Settings' }

const seedSettings = (): Settings => {
  // The prototype settings nest extra keys; map onto our typed shape, falling back to defaults.
  const s = (seed as unknown as { settings?: Partial<Settings> }).settings
  return {
    preferences: { ...DEFAULT_SETTINGS.preferences, ...(s?.preferences ?? {}) },
    watching: { ...DEFAULT_SETTINGS.watching, ...(s?.watching ?? {}) },
    advanced: { ...DEFAULT_SETTINGS.advanced, ...(s?.advanced ?? {}) },
  }
}

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
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [workspaces, setWorkspaces] = useState<Workspace[]>(seed.workspaces)
  const [activeId, setActiveId] = useState(workspaces[0]?.id ?? '')
  const [loadedIds, setLoadedIds] = useState<string[]>(workspaces[0] ? [workspaces[0].id] : [])

  const seedPriorities = (seed as unknown as { priorities?: Record<string, Priority[]> }).priorities ?? {}
  const seedChat = (seed as unknown as { ozChat?: Record<string, ChatMessage[]> }).ozChat ?? {}
  const [prioritiesByWs, setPrioritiesByWs] = useState<Record<string, Priority[]>>(() => Object.fromEntries(workspaces.map((w) => [w.id, [...(seedPriorities[w.id] ?? [])]])))
  const [runsByWs, setRunsByWs] = useState<Record<string, Run[]>>(seed.runsByWs)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [runHistoryOpen, setRunHistoryOpen] = useState(false)
  const [msgsByWs, setMsgsByWs] = useState<Record<string, ChatMessage[]>>(() => Object.fromEntries(workspaces.map((w) => [w.id, [...(seedChat[w.id] ?? [])]])))
  const [ozTyping, setOzTyping] = useState(false)
  const [chatPrefill, setChatPrefill] = useState<string | null>(null)

  // global-ish config (the prototype treats these as workspace-independent)
  const [personas, setPersonas] = useState<Persona[]>(seed.personas)
  const [personaAssignments, setPersonaAssignments] = useState<Record<string, PersonaAssignment>>({})
  const [clis, setClis] = useState<Cli[]>(seed.clis)
  const [dependencies, setDependencies] = useState(seed.dependencies)
  const [settings, setSettings] = useState<Settings>(seedSettings)
  const [newWsOpen, setNewWsOpen] = useState(false)
  const [craftOpen, setCraftOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)

  // ── Live daemon wiring ── source is decided by window.oz.health(): 'fixtures' (or no bridge, e.g.
  // jsdom tests) keeps the ported seed; 'connected' loads real data through the adapter; otherwise we
  // show an honest offline state. clis/dependencies/ozChat/settings stay seed-backed (pending endpoints).
  const [conn, setConn] = useState<ConnectionState>('connecting')
  const [live, setLive] = useState(false)
  const [pollMs, setPollMs] = useState(2500)
  const [reloadNonce, setReloadNonce] = useState(0) // bumped by Retry to re-attempt the connection
  const namesRef = useRef<Record<string, Record<string, string>>>({}) // wsId → (priorityId → title)

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { setTheme(settings.preferences.theme) }, [settings.preferences.theme])

  // Decide the data source once on mount and, when connected, replace workspaces/priorities/runs/personas
  // with live data. Seed state stays as the initial value so fixtures/tests render immediately.
  useEffect(() => {
    const oz = ozApi()
    if (!oz) { setConn('fixtures'); return }
    let cancelled = false
    const goOffline = (state: ConnectionState) => {
      // A bridge exists but the daemon isn't answering: never present seed demo data as if it were live.
      setLive(false); setConn(state); setWorkspaces([]); setRunsByWs({}); setPrioritiesByWs({})
    }
    void (async () => {
      setConn('connecting')
      let health
      try { health = await oz.health() } catch { if (!cancelled) goOffline('offline'); return }
      if (cancelled) return
      if (health.state === 'fixtures') { setConn('fixtures'); return }
      if (health.state !== 'connected') { goOffline(health.state); return }
      setConn('connected'); setLive(true)
      try { const s = await oz.settingsGet(); if (!cancelled && s?.pollIntervalMs) setPollMs(s.pollIntervalMs) } catch { /* keep default */ }
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
      setPrioritiesByWs((cur) => ({ ...cur, [first.id]: applyOrder(data.priorities, order) }))
      setRunsByWs((cur) => ({ ...cur, [first.id]: data.runs }))
      if (data.personas.length) {
        setPersonas(data.personas)
        setPersonaAssignments(data.assignments)
      }
    })()
    return () => { cancelled = true }
  }, [reloadNonce])

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
      const enriched = await loadRunDetail(oz, selectedRunId, namesRef.current[ws] ?? {})
      if (stop || !enriched) return
      setRunsByWs((cur) => ({ ...cur, [ws]: (cur[ws] ?? []).map((r) => (r.id === enriched.id ? enriched : r)) }))
    }
    void tick()
    const id = setInterval(() => void tick(), pollMs)
    return () => { stop = true; clearInterval(id) }
  }, [live, selectedRunId, activeId, pollMs])

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
      setPrioritiesByWs((cur) => ({ ...cur, [activeId]: applyOrder(data.priorities, order) }))
      setRunsByWs((cur) => ({ ...cur, [activeId]: data.runs }))
      if (data.personas.length) {
        setPersonas(data.personas)
        setPersonaAssignments(data.assignments)
      }
    })()
    return () => { cancelled = true }
  }, [live, activeId])

  const workspace = workspaces.find((w) => w.id === activeId) ?? workspaces[0]
  const priorities = prioritiesByWs[activeId] ?? []
  const runs = useMemo(() => runsByWs[activeId] ?? [], [runsByWs, activeId])
  const messages = (msgsByWs[activeId] && msgsByWs[activeId].length ? msgsByWs[activeId] : [greeting(workspace?.name ?? '')])

  function selectWs(id: string) { setActiveId(id); setSelectedRunId(null) }
  function loadWs(id: string) { setLoadedIds((ids) => (ids.includes(id) ? ids : [...ids, id])); selectWs(id) }
  function closeWs(id: string) { setLoadedIds((ids) => ids.filter((x) => x !== id)); if (activeId === id) { const next = loadedIds.find((x) => x !== id); if (next) selectWs(next) } }

  function pushMsg(m: ChatMessage) { setMsgsByWs((cur) => ({ ...cur, [activeId]: [...(cur[activeId] ?? []), m] })) }
  function onSend(text: string) {
    pushMsg({ id: `u${Date.now()}`, role: 'user', time: 'now', body: text })
    setOzTyping(true)
    if (!live) {
      setTimeout(() => { setOzTyping(false); pushMsg(ozReply(text)) }, 650)
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
        pushMsg(await sendOzMessage(oz, activeId, text))
        await refreshActiveWs()
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
  function addPriority(name: string, summary: string, placeAtTop: boolean) {
    const p: Priority = { id: `p${Date.now()}`, name, summary, status: 'ready', labels: ['persona-build'] }
    setPrioritiesByWs((cur) => ({ ...cur, [activeId]: placeAtTop ? [p, ...(cur[activeId] ?? [])] : [...(cur[activeId] ?? []), p] }))
  }

  // ── Live mutations ── all routed through the auth-correct main client (window.oz). In fixtures/seed/
  // test mode (`!live`) the actions keep the design's chat-stub behavior so the demo stays interactive.
  const [actionMsg, setActionMsg] = useState<{ kind: 'ok' | 'info' | 'err'; text: string } | null>(null)
  const notify = (kind: 'ok' | 'info' | 'err', text: string) => { setActionMsg({ kind, text }); window.setTimeout(() => setActionMsg(null), 6000) }
  async function refreshActiveWs() {
    const oz = ozApi()
    if (!oz) return
    const data = await loadWsData(oz, activeId)
    const order = await loadOrder(oz, activeId)
    namesRef.current[activeId] = data.names
    setPrioritiesByWs((cur) => ({ ...cur, [activeId]: applyOrder(data.priorities, order) }))
    setRunsByWs((cur) => ({ ...cur, [activeId]: data.runs }))
  }
  // POST /runs launches a REAL run — only ever reached from a live user click, never in tests/CI.
  async function doLaunch(priorityId: string, label: string, resumeFromRunId?: string) {
    const oz = ozApi()
    if (!oz) return
    const res = await launchRun(oz, activeId, priorityId, resumeFromRunId)
    if (res.ok) { notify('ok', `${label}…`); await refreshActiveWs() }
    else if (res.status === 409) notify('info', 'A run is already in flight for this workspace.')
    else notify('err', res.error || `Launch failed (${res.status}).`)
  }
  function handleLaunch(p: Priority) {
    if (!live) { onSend(`Launch the priority “${p.name}”.`); return }
    void doLaunch(p.id, `Launching “${p.name}”`)
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
      } else if (action === 'resolve-landed' || action === 'resolve-discard') {
        const disposition = action === 'resolve-landed' ? 'landed' : 'discard'
        const res = await resolveRun(oz, id, disposition)
        if (res.ok) { notify('ok', disposition === 'landed' ? 'Marked the run landed.' : 'Discarded the run.'); await refreshActiveWs() }
        else notify('err', res.error || `Resolve failed (${res.status}).`)
      } else if (action === 'stop') {
        notify('info', 'Stopping a run isn’t wired yet (POST /runs/:id/stop — pending endpoint).')
      } else {
        notify('info', 'The Oz chat command interface is a pending endpoint.')
      }
    })()
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
    if (prev && prev.cli === next.cli && prev.model === next.model && prev.subAgents === next.subAgents) {
      setPersonas(personas.map((p) => (p.id === id ? next : p)))
      return
    }
    void persistPersonas(personas.map((p) => (p.id === id ? next : p)))
  }
  function addSub(pid: string, playId: string) {
    const id = playId.trim()
    if (!id) { notify('err', 'Play id is required.'); return }
    const persona = personas.find((p) => p.id === pid)
    if (persona?.subAgents.some((s) => s.id === id)) { notify('err', `Play "${id}" is already assigned to ${persona.name}.`); return }
    const next = personas.map((p) => (p.id === pid ? { ...p, subAgents: [...p.subAgents, { id, name: id, cli: clis[0]?.id ?? 'claude', model: 'Default' }] } : p))
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
        <TopBar title={ROUTE_TITLE[route]} route={route} workspaces={workspaces} activeId={activeId} loadedIds={loadedIds} runsMap={runsByWs} onSelectWs={selectWs} onCloseWs={closeWs} onLoadWs={loadWs} onCreateWs={() => setNewWsOpen(true)} theme={theme} setTheme={setTheme} conn={conn} />
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
              workspace={workspace} priorities={priorities} runs={runs} ozMessages={messages}
              selectedRunId={selectedRunId} setSelectedRunId={setSelectedRunId}
              onReorder={reorder} onLaunch={handleLaunch} onAdhoc={handleAdhoc}
              onAddPriority={() => onSend('Draft a new priority.')} onSend={onSend} onDecision={(c: string) => onSend(`Decision: replay ${c} plan.`)} onRunAction={handleRunAction}
              ozTyping={ozTyping} runHistoryOpen={runHistoryOpen} setRunHistoryOpen={setRunHistoryOpen} live={live}
              chatPrefill={chatPrefill} onChatPrefillConsumed={() => setChatPrefill(null)}
            />
          )}
          {route === 'workspaces' && (
            <WorkspacesScreen workspaces={workspaces} activeId={activeId} onChange={(ws) => setWorkspaces((all) => all.map((w) => (w.id === ws.id ? ws : w)))} onSetActive={loadWs} onCreate={() => setNewWsOpen(true)} onDelete={(id) => setWorkspaces((all) => all.filter((w) => w.id !== id))} onGotoDashboard={() => setRoute('dashboard')} live={live} />
          )}
          {route === 'clis' && <CLIsScreen clis={clis} onTest={handleCliTest} onAdd={() => onSend('Register a new CLI.')} />}
          {route === 'personas' && <PersonasScreen personas={personas} clis={clis} onChange={setPersona} onAddSub={addSub} onRemoveSub={removeSub} onUpdateSub={updateSub} onNewPersonaAsPriority={() => setCraftOpen(true)} live={live} />}
          {route === 'settings' && <SettingsScreen settings={settings} dependencies={dependencies} onRecheckDep={(id: string) => setDependencies((ds: Dependency[]) => ds.map((d: Dependency) => (d.id === id ? { ...d, lastChecked: 'just now' } : d)))} onChange={setSettings} live={live} />}
          </>)}
        </div>
      </div>

      <NewWorkspaceModal open={newWsOpen} onClose={() => setNewWsOpen(false)} onCreate={({ name, description, root }) => {
        const id = `ws-${Date.now()}`
        const ws: Workspace = { id, name, description, icon: 'ph-thin ph-cube', created: 'just now', roots: [{ id: `r${Date.now()}`, name: root.name, path: root.path, role: 'primary' }] }
        setWorkspaces((all) => [...all, ws]); setPrioritiesByWs((cur) => ({ ...cur, [id]: [] })); loadWs(id); setRoute('dashboard')
      }} />
      <CraftPersonaModal open={craftOpen} onClose={() => setCraftOpen(false)} clis={clis} onSubmit={({ name, summary, placeAtTop }) => { addPriority(name, summary, placeAtTop); setRoute('dashboard') }} />
    </div>
  )
}
