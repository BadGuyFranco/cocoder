// The shell: persistent 5-section left nav (exactly Dashboard · Workspaces · CLIs · Personas ·
// Settings — Runs and Priorities are PANELS inside Dashboard, never nav items), a workspace picker
// that switches the whole context, and a live connection indicator. Renders the active section.
import { useEffect, useState } from 'react'
import type { ConnectionState, Settings as Prefs, Workspace } from '../electron/ipc-contract.ts'
import { DEFAULT_SETTINGS } from '../electron/ipc-contract.ts'
import { getHealth, listWorkspaces } from './client.ts'
import { Loading, ErrorNote } from './components.tsx'
import { Dashboard } from './sections/Dashboard.tsx'
import { Workspaces } from './sections/Workspaces.tsx'
import { CLIs } from './sections/CLIs.tsx'
import { Personas } from './sections/Personas.tsx'
import { Settings } from './sections/Settings.tsx'

type SectionId = 'dashboard' | 'workspaces' | 'clis' | 'personas' | 'settings'
const NAV: { id: SectionId; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'clis', label: 'CLIs' },
  { id: 'personas', label: 'Personas' },
  { id: 'settings', label: 'Settings' },
]

const CONN_LABEL: Record<ConnectionState, string> = {
  connected: 'Daemon connected',
  connecting: 'Connecting…',
  offline: 'Daemon offline',
  fixtures: 'Fixture replay',
}

export function App(): JSX.Element {
  const [section, setSection] = useState<SectionId>('dashboard')
  const [conn, setConn] = useState<ConnectionState>('connecting')
  const [sha, setSha] = useState<string>('')
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [wsId, setWsId] = useState<string>('')
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_SETTINGS)
  const [loadErr, setLoadErr] = useState<string>('')

  useEffect(() => {
    let live = true
    void getHealth().then((h) => {
      if (!live) return
      setConn(h.state)
      setSha(h.sha ?? '')
    })
    void Promise.all([listWorkspaces(), window.oz.settingsGet()]).then(([r, s]) => {
      if (!live) return
      setPrefs(s)
      if (!r.ok) return setLoadErr(r.error)
      setWorkspaces(r.data.workspaces)
      const def = s.defaultWorkspaceId && r.data.workspaces.some((w) => w.id === s.defaultWorkspaceId) ? s.defaultWorkspaceId : ''
      setWsId((cur) => cur || def || r.data.workspaces[0]?.id || '')
    })
    return () => {
      live = false
    }
  }, [])

  function changePrefs(patch: Partial<Prefs>): void {
    void window.oz.settingsSet(patch).then(setPrefs)
  }

  const ws = workspaces?.find((w) => w.id === wsId)

  return (
    <div className="shell">
      <aside className="nav">
        <div className="brand">
          Oz
          <span className="brand-sub">control plane</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={n.id === section ? 'nav-item active' : 'nav-item'} onClick={() => setSection(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className={`conn conn-${conn}`} title={sha ? `daemon @ ${sha.slice(0, 7)}` : undefined}>
          <span className="dot" />
          {CONN_LABEL[conn]}
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <label className="ws-picker">
            <span>Workspace</span>
            <select value={wsId} onChange={(e) => setWsId(e.target.value)} disabled={!workspaces?.length}>
              {!workspaces?.length && <option>—</option>}
              {workspaces?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          {ws && <span className="ws-path" title={ws.path}>{ws.path}</span>}
        </header>

        <div className="surface">
          {loadErr && <ErrorNote>Could not reach the Oz daemon: {loadErr}</ErrorNote>}
          {!workspaces && !loadErr && <Loading what="Connecting to daemon" />}
          {workspaces && (
            <>
              {section === 'dashboard' && <Dashboard wsId={wsId} wsName={ws?.name ?? wsId} pollMs={prefs.pollIntervalMs} />}
              {section === 'workspaces' && <Workspaces workspaces={workspaces} activeId={wsId} />}
              {section === 'clis' && <CLIs />}
              {section === 'personas' && <Personas wsId={wsId} wsName={ws?.name ?? wsId} />}
              {section === 'settings' && <Settings settings={prefs} workspaces={workspaces} onChange={changePrefs} />}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
