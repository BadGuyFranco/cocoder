// Workspaces section — list of workspaces (name · path), active one marked. The daemon's /workspaces
// is thin today (no description / roots / role), so the roots+roles editor is a clearly-DISABLED
// preview of the real shape (Name · Path · Role with exactly one Primary). See ENDPOINTS OWED
// (workspace CRUD + a roots[]/role model).
import type { Workspace } from '../../electron/ipc-contract.ts'
import { Card, Empty } from '../components.tsx'

const ROLES = ['Primary', 'Writable', 'Read-only']

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

      <Card title={<>Roots &amp; roles editor <span className="pending-tag">pending endpoint</span></>}>
        <p className="muted">Each root has a Name, Path, and Role — exactly one Primary per workspace. Disabled preview until workspace CRUD + a roots[] model land.</p>
        <div className="root-row">
          <input className="root-in" placeholder="Name" disabled />
          <input className="root-in grow" placeholder="/path/to/repo" disabled />
          <select disabled value="Primary">
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button className="btn btn-ghost" disabled>Remove</button>
        </div>
        <button className="btn btn-ghost" disabled>+ Add root</button>
      </Card>
    </div>
  )
}
