// Dashboard — the operator's home, built AROUND the Oz chat (command center). Priorities and Runs are
// supporting PANELS here, never their own nav pages. Selecting a run (or launching one) opens its
// detail in place via RunDrawer. The whole surface is scoped to the picked workspace.
import { useState } from 'react'
import { Card } from '../components.tsx'
import { OzChat } from './OzChat.tsx'
import { Priorities } from './Priorities.tsx'
import { Runs } from './Runs.tsx'
import { RunDrawer } from './RunDrawer.tsx'

export function Dashboard({ wsId, wsName, pollMs }: { wsId: string; wsName: string; pollMs: number }): JSX.Element {
  const [runId, setRunId] = useState<string | null>(null)
  const POLL_MS = pollMs

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
            <Priorities wsId={wsId} onLaunched={setRunId} />
          </Card>
          <Card title="Runs">
            <Runs wsId={wsId} pollMs={POLL_MS} selectedId={runId} onSelect={setRunId} />
          </Card>
        </div>
      </div>
      <p className="hint">Workspace context <span className="mono">{wsId}</span> drives this Oz, its priorities, and its runs.</p>
      {runId && <RunDrawer wsId={wsId} runId={runId} pollMs={POLL_MS} onClose={() => setRunId(null)} />}
    </div>
  )
}
