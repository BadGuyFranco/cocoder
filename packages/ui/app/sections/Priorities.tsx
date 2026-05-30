// Priorities panel — lives INSIDE the Dashboard (never a standalone page). Ordered priority list with
// a Launch per priority, plus the top "run without a priority" ad-hoc action (wired to the existing
// adhoc-session priority — the daemon has no free-text task field yet; see ENDPOINTS OWED). POST /runs
// outcomes are first-class UI states: 202 launched · 409 in-flight · 400 bad · offline.
import { useEffect, useState } from 'react'
import type { Priority } from '../../electron/ipc-contract.ts'
import { listPriorities, launchRun } from '../client.ts'
import { Empty, Loading, ErrorNote } from '../components.tsx'

const ADHOC = 'adhoc-session'

type Launch = { state: 'idle' } | { state: 'launching'; id: string } | { state: 'result'; id: string; msg: string; ok: boolean }

export function Priorities({ wsId, onLaunched }: { wsId: string; onLaunched?: (runId: string) => void }): JSX.Element {
  const [items, setItems] = useState<Priority[] | null>(null)
  const [err, setErr] = useState('')
  const [launch, setLaunch] = useState<Launch>({ state: 'idle' })

  useEffect(() => {
    let live = true
    setItems(null)
    setErr('')
    listPriorities(wsId).then((r) => {
      if (!live) return
      if (r.ok) setItems(r.data.priorities)
      else setErr(r.error)
    })
    return () => {
      live = false
    }
  }, [wsId])

  async function doLaunch(id: string): Promise<void> {
    setLaunch({ state: 'launching', id })
    const r = await launchRun(wsId, id)
    if (r.ok) {
      setLaunch({ state: 'result', id, ok: true, msg: `Launched ${r.data.runId}` })
      onLaunched?.(r.data.runId)
    } else {
      const msg =
        r.status === 409 ? 'A run is already in flight (409)' : r.status === 400 ? `Rejected: ${r.error} (400)` : r.status === 0 ? `Daemon unreachable: ${r.error}` : `${r.error} (${r.status})`
      setLaunch({ state: 'result', id, ok: false, msg })
    }
  }

  const busy = launch.state === 'launching'
  const launchingId = launch.state === 'launching' ? launch.id : null
  const named = items?.filter((p) => p.id !== ADHOC) ?? []
  const hasAdhoc = items?.some((p) => p.id === ADHOC)

  return (
    <div className="priorities">
      {hasAdhoc !== false && (
        <button className="btn btn-ghost adhoc" disabled={busy} onClick={() => void doLaunch(ADHOC)}>
          + Launch a run without a priority
        </button>
      )}
      {launch.state === 'result' && (
        <p className={launch.ok ? 'launch-ok' : 'launch-bad'}>{launch.msg}</p>
      )}

      {!items && !err && <Loading what="Loading priorities" />}
      {err && <ErrorNote>{err}</ErrorNote>}
      {items && named.length === 0 && <Empty>No named priorities.</Empty>}
      <ol className="prio-list">
        {named.map((p) => (
          <li key={p.id} className="prio-row">
            <div className="prio-main">
              <strong>{p.title}</strong>
              <span className="muted mono">{p.id}</span>
            </div>
            <button className="btn" disabled={busy} onClick={() => void doLaunch(p.id)}>
              {launchingId === p.id ? 'Launching…' : 'Launch'}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
