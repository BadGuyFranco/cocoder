// Workspaces section — list of workspaces (name · path), active one marked. The daemon's /workspaces
// is thin today (no description / roots / role), so the roots+roles editor is a clearly-marked pending
// surface (fleshed as a disabled editor in slice 7) — see ENDPOINTS OWED (workspace CRUD + roots model).
import type { Workspace } from '../../electron/ipc-contract.ts'
import { Card, Empty, Pending } from '../components.tsx'

export function Workspaces({ workspaces, activeId }: { workspaces: Workspace[]; activeId: string }): JSX.Element {
  return (
    <div className="section">
      <h2>Workspaces</h2>
      {workspaces.length === 0 && <Empty>No workspaces configured in local/workspaces.json.</Empty>}
      <div className="list">
        {workspaces.map((w) => (
          <Card key={w.id} title={<>{w.name} {w.id === activeId && <span className="tag-active">active</span>}</>}>
            <div className="kv">
              <span className="k">Path</span>
              <span className="v mono">{w.path}</span>
            </div>
            <div className="kv">
              <span className="k">Id</span>
              <span className="v mono">{w.id}</span>
            </div>
          </Card>
        ))}
      </div>
      <Pending
        label="Roots & roles editor"
        note="Add/remove root folders and set each to Primary / Writable / Read-only (exactly one Primary). Needs workspace CRUD + a roots[] model on the daemon."
      />
    </div>
  )
}
