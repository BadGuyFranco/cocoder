// Priorities panel — lives INSIDE the Dashboard (never a standalone page). Ordered, drag-reorderable
// list (top = next up) with a Launch per priority, plus the top "run without a priority" ad-hoc action
// (wired to the existing adhoc-session priority). POST /runs outcomes are first-class UI states.
//
// Order is CLIENT-OWNED (order: string[]) and persisted through the window.oz.prioritiesReorder seam —
// a local store today, swappable to a daemon endpoint with zero renderer change (ENDPOINTS OWED:
// POST /workspaces/:id/priorities/reorder). The daemon has no free-text ad-hoc task field yet either.
import { useEffect, useState } from 'react'
import type { Priority } from '../../electron/ipc-contract.ts'
import { listPriorities, launchRun } from '../client.ts'
import { Empty, Loading, ErrorNote } from '../components.tsx'

const ADHOC = 'adhoc-session'

type Launch = { state: 'idle' } | { state: 'launching'; id: string } | { state: 'result'; id: string; msg: string; ok: boolean }

// Apply a client-owned order to fetched priorities: ordered ids first (in order), the rest appended.
export function applyOrder(items: Priority[], order: readonly string[]): Priority[] {
  const byId = new Map(items.map((p) => [p.id, p]))
  const out: Priority[] = []
  for (const id of order) {
    const p = byId.get(id)
    if (p) {
      out.push(p)
      byId.delete(id)
    }
  }
  for (const p of items) if (byId.has(p.id)) out.push(p)
  return out
}

export function Priorities({ wsId, onLaunched }: { wsId: string; onLaunched?: (runId: string) => void }): JSX.Element {
  const [named, setNamed] = useState<Priority[] | null>(null)
  const [hasAdhoc, setHasAdhoc] = useState(true)
  const [err, setErr] = useState('')
  const [launch, setLaunch] = useState<Launch>({ state: 'idle' })
  const [dragId, setDragId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setNamed(null)
    setErr('')
    Promise.all([listPriorities(wsId), window.oz.prioritiesOrder(wsId)]).then(([r, order]) => {
      if (!live) return
      if (!r.ok) return setErr(r.error)
      setHasAdhoc(r.data.priorities.some((p) => p.id === ADHOC))
      const items = r.data.priorities.filter((p) => p.id !== ADHOC)
      setNamed(applyOrder(items, order))
    })
    return () => {
      live = false
    }
  }, [wsId])

  function persist(next: Priority[]): void {
    setNamed(next)
    void window.oz.prioritiesReorder(wsId, next.map((p) => p.id))
  }

  function onDrop(targetId: string): void {
    if (!named || !dragId || dragId === targetId) return setDragId(null)
    const from = named.findIndex((p) => p.id === dragId)
    const to = named.findIndex((p) => p.id === targetId)
    if (from < 0 || to < 0) return setDragId(null)
    const next = [...named]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    persist(next)
    setDragId(null)
  }

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

  return (
    <div className="priorities">
      {hasAdhoc && (
        <button className="btn btn-ghost adhoc" disabled={busy} onClick={() => void doLaunch(ADHOC)}>
          + Launch a run without a priority
        </button>
      )}
      {launch.state === 'result' && <p className={launch.ok ? 'launch-ok' : 'launch-bad'}>{launch.msg}</p>}

      {!named && !err && <Loading what="Loading priorities" />}
      {err && <ErrorNote>{err}</ErrorNote>}
      {named && named.length === 0 && <Empty>No named priorities.</Empty>}
      <ol className="prio-list">
        {named?.map((p) => (
          <li
            key={p.id}
            className={dragId === p.id ? 'prio-row dragging' : 'prio-row'}
            draggable
            onDragStart={() => setDragId(p.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(p.id)}
            onDragEnd={() => setDragId(null)}
          >
            <span className="drag-handle" aria-hidden>⠿</span>
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
