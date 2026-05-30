// Dashboard — the operator's home, built AROUND the Oz chat (command center). Priorities and Runs are
// supporting PANELS here, never their own nav pages. Slice 0 lays out the three regions; later slices
// fill the chat (1), priorities panel (2), and runs panel + drawer (3).
import { Card, Pending } from '../components.tsx'
import { OzChat } from './OzChat.tsx'

export function Dashboard({ wsId, wsName }: { wsId: string; wsName: string }): JSX.Element {
  return (
    <div className="section dashboard">
      <h2>Dashboard — {wsName}</h2>
      <div className="dash-grid">
        <div className="dash-chat">
          <Card title="Oz — command center">
            <OzChat wsId={wsId} wsName={wsName} />
          </Card>
        </div>
        <div className="dash-side">
          <Card title="Priorities">
            <Pending label="Priorities panel" note="Ordered list with Launch + ad-hoc run. Arrives in slice 2." />
          </Card>
          <Card title="Runs">
            <Pending label="Runs panel" note="Live + recent runs with status, opening an in-place detail drawer. Arrives in slice 3." />
          </Card>
        </div>
      </div>
      <p className="hint">Workspace context <span className="mono">{wsId}</span> drives this Oz, its priorities, and its runs.</p>
    </div>
  )
}
