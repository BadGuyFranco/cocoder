// WS1 closeout (runner-decoupling-refactor.md): the cross-surface agreement regression the WS1 done-when
// names. WS1.1–1.4 made all THREE run-level surfaces derive their terminal status from the SAME `run-end`
// event, but nothing yet ASSERTED they agree:
//   1. Deb status feed   — deriveTerminalProjection(events) → renderDebStatus → oscar
//   2. portable run.json — deriveRunSummary(events).status   (what the runner feeds writePortableRunHistory.terminal.status, WS1.3)
//   3. record.md         — renderRunRecord → **Status** via deriveRunSummary(events).status (WS1.4)
//
// This suite pins it. For a faulted / held / stopped run built from ONE store, all three surfaces are read
// from that single event log and provably agree on the terminal status — they cannot disagree by
// construction because there is one source. The two summary surfaces (portable, record) share full RunStatus
// granularity and are byte-equal on the `run-end {status}` value; the coarser feed agrees at the granularity
// it shares — the terminal-blocked oscar/phase the SAME terminal markers derive (the feed has no per-status
// RunStatus: stopped and failed both map to faulted → oscar blocked, held → awaiting-founder → blocked).
//
// The run ROW is deliberately left at its default 'running' (setRunStatus is skipped), so a passing
// assertion can ONLY mean each surface read the EVENT, never a runner-local/row. The negative-control test
// goes further: it sets the row to a CONTRADICTING terminal status and proves no surface follows it. If a
// future change re-couples any surface to a runner local that drifts from the event log, both go red.
//
// TEST-ONLY (the three derivations already landed in WS1.1–1.4): this PASSES on the current tree as written —
// its value is pinning the agreement, not red→green. DETERMINISM (WS1.1 rule): ONE store/run per shape, no
// two-store deep-equal; the only compared fields are the `run-end {status}` and the derived oscar/phase —
// render-time generatedAt, free-text waitCondition/activeTask, and wall-clock endedAt are excluded by design.
import { describe, expect, test } from 'vitest'
import { type RunnerPhase, deriveRunSummary, deriveTerminalProjection, openRunStore, renderDebStatus, renderRunRecord } from '../src/index.js'

const workspace = { id: 'cocoder', path: '/repo', name: 'CoCoder' }
const priority = { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'g', objective: 'o' }
const scopes = { oscar: [], bob: ['packages/**'], deb: ['cocoder/**'] }
const now = () => 1_000_000

// The exact terminal markers each runner exit records (mirrors the status.test.ts / record.test.ts fixtures):
// the run-end {status} tuple plus, for held/stopped, the dedicated marker deriveTerminalProjection reads.
// `feedPhase` is the terminal phase the feed derives; every terminal shape resolves to oscar 'blocked'.
const TERMINALS: ReadonlyArray<{
  label: string
  status: 'failed' | 'held' | 'stopped'
  feedPhase: RunnerPhase
  events: { type: string; data?: unknown }[]
}> = [
  {
    label: 'faulted',
    status: 'failed',
    feedPhase: 'faulted',
    events: [
      { type: 'delegation', data: { atom: 0, task: 'do x' } },
      { type: 'builder-dispatch', data: { atom: 0 } },
      { type: 'builder-scope-conflict', data: { atom: 0, message: 'writePaths out of scope' } },
      { type: 'triage-dispatch', data: { fault: 'builder-scope-conflict', atom: 0 } },
      { type: 'run-end', data: { status: 'failed', atoms: 1, committedShas: [], outOfScope: [], selfCommitted: false } },
    ],
  },
  {
    label: 'held',
    status: 'held',
    feedPhase: 'awaiting-founder',
    events: [
      { type: 'delegation', data: { atom: 2 } },
      { type: 'builder-dispatch', data: { atom: 2 } },
      { type: 'run-held', data: { park: 'pre-dispatch', atom: 2 } },
      { type: 'run-end', data: { status: 'held', atoms: 2, committedShas: [], outOfScope: [], selfCommitted: false } },
    ],
  },
  {
    label: 'stopped',
    status: 'stopped',
    feedPhase: 'faulted',
    events: [
      { type: 'delegation', data: { atom: 1 } },
      { type: 'builder-dispatch', data: { atom: 1 } },
      { type: 'run-stopped', data: { atom: 1 } },
      { type: 'run-end', data: { status: 'stopped', atoms: 2, committedShas: [], outOfScope: [], selfCommitted: false } },
    ],
  },
]

const statusLine = (record: string): string => {
  const line = record.split('\n').find((l) => l.includes('**Status:'))
  if (!line) throw new Error('record did not include a status line')
  return line
}

// Build ONE store/run, record the terminal event log ONCE, and leave the run row at its default 'running'
// (no setRunStatus) so every surface MUST read the event. All three surfaces below read this single store.
function terminalStore(events: { type: string; data?: unknown }[]) {
  const store = openRunStore(':memory:')
  store.upsertWorkspace(workspace)
  const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
  for (const e of events) store.recordEvent({ runId: run.id, type: e.type, data: e.data })
  return { store, run }
}

describe('WS1 closeout — the three run-level surfaces agree on a terminal run by construction', () => {
  for (const t of TERMINALS) {
    test(`${t.label}: feed, portable run.json, and record.md all derive the same terminal status from one run-end event`, () => {
      const { store, run } = terminalStore(t.events)
      const events = store.listEvents(run.id)

      // The run ROW is still 'running' — so any agreement below comes from the event log, not the row.
      expect(store.getRun(run.id)!.status).toBe('running')

      // Surface 2 — portable run.json: the status the runner feeds writePortableRunHistory.terminal.status (WS1.3).
      const portableStatus = deriveRunSummary(events)!.status

      // Surface 3 — record.md: the **Status** line (WS1.4).
      const recordStatus = statusLine(renderRunRecord(store, run.id, { workspace, priority }))

      // Surface 1 — Deb status feed: terminal projection → oscar. activeTask/waitCondition are the free-text
      // display labels (excluded); only the projection-derived oscar/phase are compared.
      const projection = deriveTerminalProjection(events)!
      const feed = renderDebStatus({
        store,
        runId: run.id,
        priority,
        scopes,
        phase: projection.phase,
        activeAtom: projection.activeAtom,
        activeTask: null,
        waitCondition: `terminal: ${t.label}`,
        now,
      }).json

      // The two summary surfaces share full RunStatus granularity → byte-equal on the run-end value.
      expect(portableStatus).toBe(t.status)
      expect(recordStatus).toBe(`- **Status:** ${t.status}`)
      expect(recordStatus.endsWith(portableStatus)).toBe(true)

      // The feed is coarser (no per-status RunStatus): it agrees at the granularity it shares — the
      // terminal-blocked state the SAME terminal markers in the SAME event log derive.
      expect(projection.phase).toBe(t.feedPhase)
      expect(feed.oscar).toBe('blocked')
    })
  }

  test('negative control: a run row contradicting the run-end event moves no surface — all three follow the event', () => {
    // run-end says 'stopped'; force the ROW to a DIFFERENT terminal status. A surface re-coupled to the row
    // would report 'completed'/'running' here — proof the three read the event, not a runner-local/row.
    const { store, run } = terminalStore([
      { type: 'run-stopped', data: { atom: 1 } },
      { type: 'run-end', data: { status: 'stopped', atoms: 1, committedShas: [], outOfScope: [], selfCommitted: false } },
    ])
    store.setRunStatus(run.id, 'completed')
    const events = store.listEvents(run.id)

    expect(store.getRun(run.id)!.status).toBe('completed')
    expect(deriveRunSummary(events)!.status).toBe('stopped')
    expect(statusLine(renderRunRecord(store, run.id, { workspace, priority }))).toBe('- **Status:** stopped')
    const projection = deriveTerminalProjection(events)!
    expect(projection.phase).toBe('faulted')
    const feed = renderDebStatus({
      store,
      runId: run.id,
      priority,
      scopes,
      phase: projection.phase,
      activeAtom: projection.activeAtom,
      activeTask: null,
      waitCondition: 'stopped',
      now,
    }).json
    expect(feed.oscar).toBe('blocked')
  })
})
