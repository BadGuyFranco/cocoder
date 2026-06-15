// Glass sidebar — the nav (Dashboard · Workspaces · CLIs · Personas · Plays · Settings). The Dashboard
// item carries a badge counting running+blocked runs in the active workspace. Collapsible to an icon rail
// (toggle in the brand row); when collapsed, hovering an item shows its label as a tooltip — giving the
// Priorities panel more room. NAV_ITEMS is the single source of truth; add an entry to add a section (the
// old "five items only" cap was a design-ref artifact, not a real constraint).
import { Icon } from './primitives.tsx'
import type { Run } from '../model.ts'

export type Route = 'dashboard' | 'workspaces' | 'clis' | 'personas' | 'plays' | 'settings'

const NAV_ITEMS: { id: Route; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'squares-four' },
  { id: 'workspaces', label: 'Workspaces', icon: 'folders' },
  { id: 'clis', label: 'CLIs', icon: 'terminal-window' },
  { id: 'personas', label: 'Personas', icon: 'users-three' },
  { id: 'plays', label: 'Plays', icon: 'tree-structure' },
  { id: 'settings', label: 'Settings', icon: 'gear-six' },
]

export function Sidebar({ route, setRoute, runs, user, collapsed, onToggleCollapsed }: {
  route: Route; setRoute: (r: Route) => void; runs: Run[]
  user: { initials: string; name: string; role: string }
  collapsed: boolean; onToggleCollapsed: () => void
}) {
  const activeRuns = runs.filter((r) => r.status === 'running' || r.status === 'blocked').length
  return (
    <aside className={`oz-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="oz-brand">
        <span className="oz-brand-mark">OZ</span>
        {!collapsed && (
          <div className="oz-brand-text">
            <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5 }}>control plane</div>
            <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-secondary)', letterSpacing: 0.3 }}>cocoder · v0.7.2</div>
          </div>
        )}
        <button className="oz-collapse-btn" onClick={onToggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Icon name={collapsed ? 'caret-right' : 'caret-left'} size={13} />
        </button>
      </div>
      <nav className="oz-nav">
        {NAV_ITEMS.map((item) => {
          const badge = item.id === 'dashboard' && activeRuns > 0 ? activeRuns : null
          return (
            <div key={item.id} className={`oz-nav-item ${route === item.id ? 'active' : ''}`} onClick={() => setRoute(item.id)} title={collapsed ? item.label : undefined}>
              <Icon name={item.icon} size={17} />
              <span className="oz-nav-label">{item.label}</span>
              {badge && <span className="oz-nav-badge">{badge}</span>}
              {collapsed && <span className="oz-nav-tip">{item.label}{badge ? ` · ${badge}` : ''}</span>}
            </div>
          )
        })}
      </nav>
      <div className="oz-sidebar-footer">
        <div className="oz-avatar">{user.initials}</div>
        {!collapsed && (
          <div style={{ minWidth: 0 }}>
            <div className="oz-user-name">{user.name}</div>
            <div className="oz-user-meta">{user.role}</div>
          </div>
        )}
      </div>
    </aside>
  )
}
