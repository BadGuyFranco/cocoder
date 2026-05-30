// Glass sidebar — the 5-section nav (Dashboard · Workspaces · CLIs · Personas · Settings). The
// Dashboard item carries a badge counting running+blocked runs in the active workspace (dev-note 1).
// Ported from design-ref/components.jsx; dev-pin overlay intentionally dropped.
import { Icon } from './primitives.tsx'
import type { Run } from '../model.ts'

export type Route = 'dashboard' | 'workspaces' | 'clis' | 'personas' | 'settings'

const NAV_ITEMS: { id: Route; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'squares-four' },
  { id: 'workspaces', label: 'Workspaces', icon: 'folders' },
  { id: 'clis', label: 'CLIs', icon: 'terminal-window' },
  { id: 'personas', label: 'Personas', icon: 'users-three' },
  { id: 'settings', label: 'Settings', icon: 'gear-six' },
]

export function Sidebar({ route, setRoute, runs, user }: { route: Route; setRoute: (r: Route) => void; runs: Run[]; user: { initials: string; name: string; role: string } }) {
  const activeRuns = runs.filter((r) => r.status === 'running' || r.status === 'blocked').length
  return (
    <aside className="oz-sidebar">
      <div className="oz-brand">
        <span className="oz-brand-mark">OZ</span>
        <div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5 }}>control plane</div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-secondary)', letterSpacing: 0.3 }}>cocoder · v0.7.2</div>
        </div>
      </div>
      <nav className="oz-nav">
        {NAV_ITEMS.map((item) => {
          const badge = item.id === 'dashboard' && activeRuns > 0 ? activeRuns : null
          return (
            <div key={item.id} className={`oz-nav-item ${route === item.id ? 'active' : ''}`} onClick={() => setRoute(item.id)}>
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {badge && <span className="oz-nav-badge">{badge}</span>}
            </div>
          )
        })}
      </nav>
      <div className="oz-sidebar-footer">
        <div className="oz-avatar">{user.initials}</div>
        <div style={{ minWidth: 0 }}>
          <div className="oz-user-name">{user.name}</div>
          <div className="oz-user-meta">{user.role}</div>
        </div>
      </div>
    </aside>
  )
}
