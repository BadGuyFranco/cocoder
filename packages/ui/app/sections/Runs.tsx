// Runs panel — lives INSIDE the Dashboard. Oz is the watcher for every run in the workspace: this is
// the at-a-glance list (newest-first, status chips, timing). Selecting a run opens its detail in place
// (RunDrawer). Polls while visible. Read-only TIER-3 — it observes, never orchestrates.
import type { RunSummary } from '../../electron/ipc-contract.ts'
import { listRuns } from '../client.ts'
import { usePoll } from '../usePoll.ts'
import { StatusChip, Empty, Loading, ErrorNote } from '../components.tsx'
import { formatDuration } from '../runevents.ts'

export function Runs({ wsId, pollMs, selectedId, onSelect }: { wsId: string; pollMs: number; selectedId: string | null; onSelect: (id: string) => void }): JSX.Element {
  const { data, error } = usePoll(() => listRuns(wsId), pollMs, `runs:${wsId}`)

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!data) return <Loading what="Loading runs" />
  if (!data.ok) return <ErrorNote>{data.error}</ErrorNote>
  const runs: RunSummary[] = data.data.runs
  if (runs.length === 0) return <Empty>No runs yet.</Empty>

  return (
    <ul className="runs-list">
      {runs.map((r) => (
        <li key={r.id}>
          <button className={r.id === selectedId ? 'run-row selected' : 'run-row'} onClick={() => onSelect(r.id)}>
            <div className="run-main">
              <span className="mono run-id">{r.id}</span>
              <span className="muted run-prio">{r.priorityId}</span>
            </div>
            <div className="run-meta">
              <StatusChip status={r.status} />
              <span className="muted run-dur">{formatDuration(r.createdAt, r.endedAt)}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
