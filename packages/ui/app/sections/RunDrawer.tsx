// Run detail — opens IN PLACE within the Dashboard (a right-side inspector), Oz's window into an
// externally-running session. Read-only transcript (events timeline), human-friendly evidence (NO raw
// JSON), and the run controls. TIER-3: the only writes are the run-lifecycle ops this daemon owns —
// Attach (POST show), Close (POST teardown), Resume (POST runs resumeFromRunId). Never sendInput.
import { useState } from 'react'
import type { RunDetail } from '../../electron/ipc-contract.ts'
import { getRun, showRun, teardownRun, launchRun } from '../client.ts'
import { usePoll } from '../usePoll.ts'
import { StatusChip, Loading, ErrorNote } from '../components.tsx'
import { formatEvent, formatTime, isOversightEvent } from '../runevents.ts'

function Evidence({ d }: { d: RunDetail }): JSX.Element {
  return (
    <>
      {d.commitLinks.length > 0 && (
        <section className="ev">
          <h4>Commits</h4>
          {d.commitLinks.map((c) => (
            <div key={c.id} className="commit">
              <span className="mono">{c.commitSha.slice(0, 7)}</span> {c.message}
              {c.files.length > 0 && <div className="muted files">{c.files.join(', ')}</div>}
            </div>
          ))}
        </section>
      )}
      {d.diffs.length > 0 && (
        <details className="ev">
          <summary>Diffs ({d.diffs.length})</summary>
          {d.diffs.map((x) => (
            <pre key={x.sha} className="diff">{x.diff}</pre>
          ))}
        </details>
      )}
      {d.files.record && (
        <details className="ev">
          <summary>Run record</summary>
          <pre className="record">{d.files.record}</pre>
        </details>
      )}
      {d.files.pickup && (
        <details className="ev">
          <summary>Pickup brief</summary>
          <pre className="record">{d.files.pickup}</pre>
        </details>
      )}
    </>
  )
}

// Oversight / Debugger — a read-only PROJECTION of Deb's outputs + the monitor's signals (one
// debugger: Deb writes faults, Oz reads them). TIER-3: this renders only; it never triages, nudges, or
// sends input. It surfaces the oversight-relevant events from the same transcript, called out distinctly.
function Oversight({ d }: { d: RunDetail }): JSX.Element {
  const signals = d.events.filter((e) => isOversightEvent(e.type))
  return (
    <section className="ev oversight">
      <h4>Oversight · Deb (read-only)</h4>
      {signals.length === 0 ? (
        <p className="muted">No oversight signals — no faults, out-of-scope changes, or monitor flags recorded.</p>
      ) : (
        <ol className="timeline">
          {signals.map((e) => {
            const line = formatEvent(e)
            return (
              <li key={e.id} className={`tl tl-${line.tone}`}>
                <span className="tl-time mono">{formatTime(line.at)}</span>
                <span className="tl-title">{line.title}</span>
                {line.detail && <span className="tl-detail muted">{line.detail}</span>}
              </li>
            )
          })}
        </ol>
      )}
      <p className="muted oversight-note">Projection only — Deb writes faults/triage/dispositions; Oz reads them. No orchestration from here.</p>
    </section>
  )
}

export function RunDrawer({ wsId, runId, pollMs, onClose }: { wsId: string; runId: string; pollMs: number; onClose: () => void }): JSX.Element {
  const { data, error } = usePoll(() => getRun(runId), pollMs, `run:${runId}`)
  const [action, setAction] = useState('')

  async function attach(): Promise<void> {
    setAction('Attaching…')
    const r = await showRun(runId)
    setAction(r.ok ? 'Focused the cmux pane' : r.status === 409 ? 'Not live — nothing to attach (409)' : `Attach failed: ${r.error}`)
  }
  async function close(): Promise<void> {
    setAction('Closing panes…')
    const r = await teardownRun(runId)
    setAction(r.ok ? `Closed ${r.data.closed.length} pane(s)` : `Teardown failed: ${r.error}`)
  }
  async function resume(priorityId: string): Promise<void> {
    setAction('Resuming…')
    const r = await launchRun(wsId, priorityId, runId)
    setAction(r.ok ? `Resumed as ${r.data.runId}` : r.status === 409 ? 'A run is already in flight (409)' : `Resume failed: ${r.error}`)
  }

  return (
    <aside className="drawer" role="dialog" aria-label={`Run ${runId}`}>
      <header className="drawer-head">
        <div>
          <span className="mono">{runId}</span> {data?.ok && <StatusChip status={data.data.run.status} />}
        </div>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close run detail">✕</button>
      </header>

      {!data && !error && <Loading what="Loading run" />}
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && !data.ok && <ErrorNote>{data.error}</ErrorNote>}
      {data?.ok && (
        <div className="drawer-body">
          <div className="drawer-controls">
            <button className="btn" onClick={() => void resume(data.data.run.priorityId)}>Resume</button>
            <button className="btn btn-ghost" onClick={() => void close()}>Close panes</button>
          </div>
          {action && <p className="action-note">{action}</p>}

          <section className="ev">
            <h4>Sessions</h4>
            {data.data.sessions.map((sess) => (
              <div key={sess.id} className="session">
                <span>{sess.persona} <span className="muted mono">{sess.sessionRef}</span> {sess.exitCode != null && <span className="muted">exit {sess.exitCode}</span>}</span>
                {sess.deepLinkable ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => void attach()}>Attach</button>
                ) : (
                  <span className="muted">not live</span>
                )}
              </div>
            ))}
          </section>

          <Oversight d={data.data} />

          <section className="ev">
            <h4>Transcript</h4>
            <ol className="timeline">
              {data.data.events.map((e) => {
                const line = formatEvent(e)
                return (
                  <li key={e.id} className={`tl tl-${line.tone}`}>
                    <span className="tl-time mono">{formatTime(line.at)}</span>
                    <span className="tl-title">{line.title}</span>
                    {line.detail && <span className="tl-detail muted">{line.detail}</span>}
                  </li>
                )
              })}
            </ol>
          </section>

          <Evidence d={data.data} />
        </div>
      )}
    </aside>
  )
}
