// Top bar owns global shell controls off-dashboard. The dashboard places workspace and Oz controls
// inside its own panels so the workspace/global boundary is visually explicit.
import { OzGlobalControls, type ShellTheme } from './ShellControls.tsx'

export function TopBar({ title, route, theme, setTheme, conn, onRestartOz }: {
  title: string; route: string
  theme: ShellTheme; setTheme: (fn: (t: ShellTheme) => ShellTheme) => void; conn: string; onRestartOz?: () => void
}) {
  return (
    <header className="oz-topbar">
      {route !== 'dashboard' && <div className="oz-topbar-title">{title}</div>}
      <div className="oz-topbar-spacer" />
      {route !== 'dashboard' && <OzGlobalControls theme={theme} setTheme={setTheme} conn={conn} onRestartOz={onRestartOz} />}
    </header>
  )
}
