// Oz renderer root — rebuilt against the V1 claude.ai/design prototype (packages/ui/design-ref/).
// Composes the Fusion shell (Sidebar + TopBar workspace tabs) and routes to the Dashboard + the four
// screens (Workspaces · CLIs · Personas · Settings) with the two creation modals. This slice renders
// the design-faithful view-model from the ported seed (fixture parity, fully interactive); the daemon
// adapter is wired in the next slice (the existing electron/ plumbing is untouched).
import { useEffect, useMemo, useState } from 'react'
import { Sidebar, type Route } from './ui/Sidebar.tsx'
import { TopBar } from './ui/TopBar.tsx'
import { Dashboard } from './sections/dashboard/Dashboard.tsx'
import { WorkspacesScreen } from './sections/Workspaces.tsx'
import { CLIsScreen } from './sections/CLIs.tsx'
import { PersonasScreen } from './sections/Personas.tsx'
import { SettingsScreen } from './sections/Settings.tsx'
import { NewWorkspaceModal, CraftPersonaModal } from './sections/modals.tsx'
import { seed, DEFAULT_SETTINGS, type ChatMessage, type Cli, type Dependency, type Persona, type Priority, type Settings, type SubAgent, type Workspace } from './model.ts'

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

export function App() {
  const [route, setRoute] = useState<Route>('dashboard')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [workspaces, setWorkspaces] = useState<Workspace[]>(seed.workspaces)
  const [activeId, setActiveId] = useState(workspaces[0]?.id ?? '')
  const [loadedIds, setLoadedIds] = useState<string[]>(workspaces[0] ? [workspaces[0].id] : [])

  const seedPriorities = (seed as unknown as { priorities?: Record<string, Priority[]> }).priorities ?? {}
  const seedChat = (seed as unknown as { ozChat?: Record<string, ChatMessage[]> }).ozChat ?? {}
  const [prioritiesByWs, setPrioritiesByWs] = useState<Record<string, Priority[]>>(() => Object.fromEntries(workspaces.map((w) => [w.id, [...(seedPriorities[w.id] ?? [])]])))
  const runsByWs = seed.runsByWs
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [runHistoryOpen, setRunHistoryOpen] = useState(false)
  const [msgsByWs, setMsgsByWs] = useState<Record<string, ChatMessage[]>>(() => Object.fromEntries(workspaces.map((w) => [w.id, [...(seedChat[w.id] ?? [])]])))
  const [ozTyping, setOzTyping] = useState(false)

  // global-ish config (the prototype treats these as workspace-independent)
  const [personas, setPersonas] = useState<Persona[]>(seed.personas)
  const [clis, setClis] = useState<Cli[]>(seed.clis)
  const [dependencies, setDependencies] = useState(seed.dependencies)
  const [settings, setSettings] = useState<Settings>(seedSettings)
  const [newWsOpen, setNewWsOpen] = useState(false)
  const [craftOpen, setCraftOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { setTheme(settings.preferences.theme) }, [settings.preferences.theme])

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
    setTimeout(() => { setOzTyping(false); pushMsg(ozReply(text)) }, 650)
  }
  function reorder(from: number, to: number) {
    setPrioritiesByWs((cur) => { const list = [...(cur[activeId] ?? [])]; const [moved] = list.splice(from, 1); list.splice(to, 0, moved); return { ...cur, [activeId]: list } })
  }
  function addPriority(name: string, summary: string, placeAtTop: boolean) {
    const p: Priority = { id: `p${Date.now()}`, name, summary, status: 'ready', labels: ['persona-build'] }
    setPrioritiesByWs((cur) => ({ ...cur, [activeId]: placeAtTop ? [p, ...(cur[activeId] ?? [])] : [...(cur[activeId] ?? []), p] }))
  }

  // persona editing
  const setPersona = (id: string, next: Persona) => setPersonas((ps) => ps.map((p) => (p.id === id ? next : p)))
  const addSub = (pid: string) => setPersonas((ps) => ps.map((p) => (p.id === pid ? { ...p, subAgents: [...p.subAgents, { id: `sa${Date.now()}`, name: 'new sub', cli: 'claude-code', model: 'Default' }] } : p)))
  const removeSub = (pid: string, sid: string) => setPersonas((ps) => ps.map((p) => (p.id === pid ? { ...p, subAgents: p.subAgents.filter((s: SubAgent) => s.id !== sid) } : p)))
  const updateSub = (pid: string, sid: string, sa: SubAgent) => setPersonas((ps) => ps.map((p) => (p.id === pid ? { ...p, subAgents: p.subAgents.map((s: SubAgent) => (s.id === sid ? sa : s)) } : p)))

  return (
    <div className="oz-app" style={{ gridTemplateColumns: `${navCollapsed ? 64 : 220}px 1fr` }}>
      <Sidebar route={route} setRoute={setRoute} runs={runs} user={USER} collapsed={navCollapsed} onToggleCollapsed={() => setNavCollapsed((c) => !c)} />
      <div className="oz-main">
        <TopBar title={ROUTE_TITLE[route]} route={route} workspaces={workspaces} activeId={activeId} loadedIds={loadedIds} runsMap={runsByWs} onSelectWs={selectWs} onCloseWs={closeWs} onLoadWs={loadWs} onCreateWs={() => setNewWsOpen(true)} theme={theme} setTheme={setTheme} />
        <div className="oz-content">
          {route === 'dashboard' && workspace && (
            <Dashboard
              workspace={workspace} priorities={priorities} runs={runs} ozMessages={messages}
              selectedRunId={selectedRunId} setSelectedRunId={setSelectedRunId}
              onReorder={reorder} onLaunch={(p: Priority) => onSend(`Launch the priority “${p.name}”.`)} onAdhoc={() => onSend('Run an ad-hoc task: ')}
              onAddPriority={() => onSend('Draft a new priority.')} onSend={onSend} onDecision={(c: string) => onSend(`Decision: replay ${c} plan.`)} onRunAction={(a: string, id: string) => onSend(`${a} ${id}`)}
              ozTyping={ozTyping} runHistoryOpen={runHistoryOpen} setRunHistoryOpen={setRunHistoryOpen}
            />
          )}
          {route === 'workspaces' && (
            <WorkspacesScreen workspaces={workspaces} activeId={activeId} onChange={(ws) => setWorkspaces((all) => all.map((w) => (w.id === ws.id ? ws : w)))} onSetActive={loadWs} onCreate={() => setNewWsOpen(true)} onDelete={(id) => setWorkspaces((all) => all.filter((w) => w.id !== id))} onGotoDashboard={() => setRoute('dashboard')} />
          )}
          {route === 'clis' && <CLIsScreen clis={clis} onTest={(id) => setClis((cs) => cs.map((c) => (c.id === id ? { ...c, lastTested: 'just now' } : c)))} onAdd={() => onSend('Register a new CLI.')} />}
          {route === 'personas' && <PersonasScreen personas={personas} clis={clis} onChange={setPersona} onAddSub={addSub} onRemoveSub={removeSub} onUpdateSub={updateSub} onNewPersonaAsPriority={() => setCraftOpen(true)} />}
          {route === 'settings' && <SettingsScreen settings={settings} dependencies={dependencies} onRecheckDep={(id: string) => setDependencies((ds: Dependency[]) => ds.map((d: Dependency) => (d.id === id ? { ...d, lastChecked: 'just now' } : d)))} onChange={setSettings} />}
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
