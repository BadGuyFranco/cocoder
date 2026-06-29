// renderDebStatus — the runner-owned status feed projection (ADR-0016). Pure over the store rows, so it
// is driven here straight from recorded events (no live run): the same evidence Deb reads to answer
// "how's Oscar doing?".
import { describe, expect, test } from 'vitest'
import {
  type RunnerPhase,
  deriveRunSummary,
  deriveTerminalProjection,
  isAwaitingFounderResolutionStatus,
  isFinalizableFounderResolutionStatus,
  openRunStore,
  renderDebStatus,
  terminalWaitCondition,
  wrapupDeliveryDispatched,
} from '../src/index.js'

const priority = { id: 'demo', title: 'Demo' }
const scopes = { oscar: [], bob: ['packages/**'], deb: ['cocoder/**'] }
const now = () => 1_000_000

function statusFor(events: { type: string; data?: unknown }[], phase: RunnerPhase, over: Partial<Parameters<typeof renderDebStatus>[0]> = {}) {
  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'w', path: '/r', name: 'W' })
  const run = store.createRun({ workspaceId: 'w', priorityId: 'demo' })
  for (const e of events) store.recordEvent({ runId: run.id, type: e.type, data: e.data })
  return renderDebStatus({ store, runId: run.id, priority, scopes, phase, activeAtom: 0, activeTask: 'do x', waitCondition: 'awaiting directive 0', now, ...over }).json
}

describe('renderDebStatus', () => {
  test('founder-resolution status predicates distinguish recognition from finalization', () => {
    expect(isAwaitingFounderResolutionStatus('held')).toBe(true)
    expect(isAwaitingFounderResolutionStatus('awaiting-founder')).toBe(true)
    expect(isAwaitingFounderResolutionStatus('awaiting-archive-confirmation')).toBe(true)
    expect(isAwaitingFounderResolutionStatus('running')).toBe(false)
    expect(isAwaitingFounderResolutionStatus('completed')).toBe(false)

    expect(isFinalizableFounderResolutionStatus('held')).toBe(false)
    expect(isFinalizableFounderResolutionStatus('awaiting-founder')).toBe(true)
    expect(isFinalizableFounderResolutionStatus('awaiting-archive-confirmation')).toBe(true)
  })

  test('awaiting a directive → Oscar waiting, Bob standby', () => {
    const s = statusFor([], 'awaiting-directive')
    expect(s.oscar).toBe('waiting')
    expect(s.bob).toBe('standby')
    expect(s.verify).toBe('idle')
    expect(s.waitCondition).toBe('awaiting directive 0')
    expect(s.writeScopes).toEqual(scopes)
    expect(s.wrapDisposition).toBeNull()
  })

  test('builder dispatched, not done → Bob running, Oscar running', () => {
    const s = statusFor([{ type: 'delegation', data: { atom: 0, task: 'do x' } }, { type: 'builder-dispatch', data: { atom: 0 } }], 'building')
    expect(s.bob).toBe('running')
    expect(s.oscar).toBe('running')
    expect(s.lastDirectiveAt).not.toBeNull()
  })

  test('verify dispatched, no verdict → Oscar verifying, verify pending', () => {
    const s = statusFor(
      [{ type: 'delegation', data: { atom: 0 } }, { type: 'builder-dispatch', data: { atom: 0 } }, { type: 'builder-done', data: { atom: 0 } }, { type: 'verify-dispatch', data: { atom: 0 } }],
      'verifying',
    )
    expect(s.oscar).toBe('verifying')
    expect(s.bob).toBe('done')
    expect(s.verify).toBe('pending')
    expect(s.handoffs).toContainEqual({ file: 'verify-0.json', status: 'pending' })
  })

  test('verify dispatch clears a stale stuck assessment from the prior wait', () => {
    const s = statusFor(
      [
        { type: 'delegation', data: { atom: 0 } },
        { type: 'builder-dispatch', data: { atom: 0 } },
        { type: 'oscar-monitor-assessment', data: { stage: 'watch', atom: 0, state: 'stuck', note: 'deb recommends a nudge' } },
        { type: 'builder-done', data: { atom: 0 } },
        { type: 'verify-dispatch', data: { atom: 0 } },
      ],
      'verifying',
    )
    expect(s.oscar).toBe('verifying')
    expect(s.verify).toBe('pending')
  })

  test('active atom verify ignores a prior atom pass', () => {
    const s = statusFor(
      [
        { type: 'delegation', data: { atom: 0 } },
        { type: 'builder-dispatch', data: { atom: 0 } },
        { type: 'builder-done', data: { atom: 0 } },
        { type: 'verify-dispatch', data: { atom: 0 } },
        { type: 'verify-pass', data: { atom: 0, reason: 'ok' } },
        { type: 'delegation', data: { atom: 1 } },
        { type: 'builder-dispatch', data: { atom: 1 } },
      ],
      'building',
      { activeAtom: 1, activeTask: 'do y', waitCondition: 'building atom 1' },
    )
    expect(s.activeAtom).toBe(1)
    expect(s.verify).toBe('idle')
    expect(s.handoffs).not.toContainEqual({ file: 'verify-1.json', status: 'pass' })
  })

  test('status markdown uses display label and labels the technical id', () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'w', path: '/r', name: 'W' })
    const run = store.createRun({ workspaceId: 'w', priorityId: 'demo' })

    const markdown = renderDebStatus({
      store,
      runId: run.id,
      runDisplay: { displayNumber: 1 },
      priority,
      scopes,
      phase: 'awaiting-directive',
      activeAtom: 0,
      activeTask: 'do x',
      waitCondition: 'awaiting directive 0',
      now,
    }).markdown

    expect(markdown).toContain('# Run status — workspace run 1')
    expect(markdown).toContain(`- **Technical id:** \`${run.id}\``)
    expect(markdown).toContain('- **Wrap disposition:** —')
  })

  test('status markdown uses the workspace name when the run display carries one', () => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'w', path: '/r', name: 'W' })
    const run = store.createRun({ workspaceId: 'w', priorityId: 'demo' })

    const markdown = renderDebStatus({
      store,
      runId: run.id,
      runDisplay: { displayNumber: 98, workspaceName: 'CoCoder' },
      priority,
      scopes,
      phase: 'awaiting-directive',
      activeAtom: 0,
      activeTask: 'do x',
      waitCondition: 'awaiting directive 0',
      now,
    }).markdown

    expect(markdown).toContain('# Run status — CoCoder run 98')
    expect(markdown).toContain(`- **Technical id:** \`${run.id}\``)
  })

  test('wrap disposition surfaces the latest recorded event value', () => {
    const s = statusFor(
      [
        { type: 'wrap-disposition', data: { disposition: 'continue', buildAtoms: 1, signal: null } },
        {
          type: 'wrap-disposition',
          data: {
            disposition: 'archive-confirmation',
            buildAtoms: 0,
            signal: 'node scripts/proof-launch-disposition.mjs',
            action: { type: 'archive-priority-confirmation', runId: 'run_x', priorityId: 'demo', endpoint: '/runs/run_x/archive-confirmation', method: 'POST', confirmWith: 'archive' },
          },
        },
      ],
      'wrapped',
    )
    expect(s.wrapDisposition).toBe('archive-confirmation')
    expect(s.nextAction).toMatchObject({ type: 'archive-priority-confirmation', endpoint: '/runs/run_x/archive-confirmation', confirmWith: 'archive' })
  })

  test('wrap disposition remains absent without a recorded event', () => {
    const s = statusFor([{ type: 'wrapup', data: { atoms: 0, forced: false } }], 'wrapped')
    expect(s.wrapDisposition).toBeNull()
  })

  test('a current stuck assessment while awaiting Oscar → stalled', () => {
    const s = statusFor(
      [{ type: 'delegation', data: { atom: 0 } }, { type: 'oscar-monitor-assessment', data: { stage: 'directive', atom: 1, state: 'stuck' } }],
      'awaiting-directive',
    )
    expect(s.oscar).toBe('stalled')
  })

  test('an outstanding fault dispatch → blocked, surfaced in outstandingFaults', () => {
    const s = statusFor([{ type: 'triage-dispatch', data: { fault: 'directive-timeout', atom: 0 } }], 'faulted')
    expect(s.oscar).toBe('blocked')
    expect(s.outstandingFaults).toHaveLength(1)
    expect(s.outstandingFaults[0]?.fault).toBe('directive-timeout')
  })

  test('latest Bob blocker reply is surfaced with owner and timestamp', () => {
    const reply = 'The atom requires creating `cocoder/decisions/0040-oz-write-side-autonomy.md`, but its declared write scope is `packages/**`. I need an explicit one-file override.'
    const s = statusFor(
      [
        { type: 'delegation', data: { atom: 0 } },
        { type: 'builder-dispatch', data: { atom: 0 } },
        { type: 'nudge', data: { atom: 0, text: 'You seem stalled — what is blocking you? Keep going, or say what you need.' } },
        { type: 'builder-blocker', data: { atom: 0, reply, category: 'authority-scope-conflict', owner: 'runner-fault' } },
        { type: 'builder-blocked', data: { atom: 0, message: 'builder reported authority-scope-conflict' } },
        { type: 'triage-dispatch', data: { fault: 'builder-blocked', atom: 0 } },
      ],
      'faulted',
    )
    expect(s.bob).toBe('failed')
    expect(s.latestBuilderBlocker).toMatchObject({ reply, atom: 0, category: 'authority-scope-conflict', owner: 'deb-triage' })
    expect(s.latestBuilderBlocker?.at).not.toBeNull()
  })

  test('a triaged fault is no longer outstanding', () => {
    const s = statusFor(
      [{ type: 'triage-dispatch', data: { fault: 'directive-timeout', atom: 0 } }, { type: 'fault-triaged', data: { fault: 'directive-timeout', disposition: 'cocoder-bug' } }],
      'faulted',
    )
    expect(s.outstandingFaults).toHaveLength(0)
  })

  test('recent event log is bounded and evidence-bearing (timestamps + notes)', () => {
    const events = Array.from({ length: 20 }, (_, i) => ({ type: 'monitor-assessment', data: { atom: i, note: `n${i}` } }))
    const s = statusFor(events, 'building', { recentLimit: 5 })
    expect(s.recentEvents).toHaveLength(5)
    expect(s.recentEvents[4]?.note).toBe('n19')
    expect(s.generatedAt).toBe(1_000_000)
  })
})

// ── WS1 step 1 (runner-decoupling-refactor.md): prove a TERMINAL run's DebStatus is derivable from the
// event log alone. `renderDebStatus` takes four run-state inputs the runner feeds imperatively — `phase`,
// `activeAtom`, `activeTask`, `waitCondition`. INVENTORY of those four for a terminal run:
//   - `phase`        LOAD-BEARING, DERIVABLE — `run-end {status}` / `run-held` / `run-stopped` markers.
//   - `activeAtom`   LOAD-BEARING, DERIVABLE — terminal marker's `atom`, else the last atom-bearing event.
//   - `activeTask`   display-only, NOT derivable — free-text prose; touches no derived field (pass-through).
//   - `waitCondition` display-only, NOT derivable — free-text prose; touches no derived field (pass-through).
// `deriveTerminalProjection` recovers the load-bearing pair; this suite asserts that pair reproduces the
// canonical `renderDebStatus` projection for every terminal path, modulo the two free-text labels. No
// runner writes are moved yet — this is the projection seed the later WS1 swap is verified against.
describe('deriveTerminalProjection — WS1 terminal projection seed', () => {
  // The exact events the runner records on a fault (fail(): the fault-type event, the triage dispatch, then
  // run-end status=failed). refreshStatus is called with ('faulted', atom, null, <prose>).
  const faultedEvents = [
    { type: 'delegation', data: { atom: 0, task: 'do x' } },
    { type: 'builder-dispatch', data: { atom: 0 } },
    { type: 'builder-scope-conflict', data: { atom: 0, message: 'writePaths out of scope' } },
    { type: 'triage-dispatch', data: { fault: 'builder-scope-conflict', atom: 0 } },
    { type: 'run-end', data: { status: 'failed', atoms: 1, committedShas: [], outOfScope: [] } },
  ]
  // holdRun(): run-held {park, atom} then run-end status=held — and it never calls refreshStatus, so the
  // status feed today carries a STALE pre-hold phase. The projection closes that gap from events alone.
  const heldEvents = [
    { type: 'delegation', data: { atom: 2 } },
    { type: 'builder-dispatch', data: { atom: 2 } },
    { type: 'run-held', data: { park: 'pre-dispatch', atom: 2 } },
    { type: 'run-end', data: { status: 'held', atoms: 2, committedShas: [], outOfScope: [] } },
  ]
  // stopRun(): run-stopped {atom} then run-end status=stopped — also no refreshStatus (same stale-feed gap).
  const stoppedEvents = [
    { type: 'delegation', data: { atom: 1 } },
    { type: 'builder-dispatch', data: { atom: 1 } },
    { type: 'run-stopped', data: { atom: 1 } },
    { type: 'run-end', data: { status: 'stopped', atoms: 2, committedShas: [], outOfScope: [] } },
  ]

  const projectionFor = (events: { type: string; data?: unknown }[]) => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'w', path: '/r', name: 'W' })
    const run = store.createRun({ workspaceId: 'w', priorityId: 'demo' })
    for (const e of events) store.recordEvent({ runId: run.id, type: e.type, data: e.data })
    return deriveTerminalProjection(store.listEvents(run.id))
  }

  test('faulted: projection equals the inputs the runner feeds at fail()', () => {
    expect(projectionFor(faultedEvents)).toEqual({ phase: 'faulted', activeAtom: 0 })
  })

  test('completed and awaiting terminal wraps project from run-end status and atom count', () => {
    expect(projectionFor([{ type: 'wrapup', data: { atoms: 2 } }, { type: 'run-end', data: { status: 'completed', atoms: 2, committedShas: [], outOfScope: [] } }])).toEqual({
      phase: 'wrapped',
      activeAtom: 2,
    })
    expect(projectionFor([{ type: 'wrap-disposition', data: { disposition: 'archive-confirmation' } }, { type: 'run-end', data: { status: 'awaiting-archive-confirmation', atoms: 1, committedShas: [], outOfScope: [] } }])).toEqual({
      phase: 'awaiting-founder',
      activeAtom: 1,
    })
    expect(projectionFor([{ type: 'wrap-disposition', data: { disposition: 'continue' } }, { type: 'run-end', data: { status: 'awaiting-founder', atoms: 1, committedShas: [], outOfScope: [] } }])).toEqual({
      phase: 'awaiting-founder',
      activeAtom: 1,
    })
  })

  test('faulted: DebStatus rendered from the derived pair matches the canonical one (modulo display labels)', () => {
    // Render BOTH from one store/run so event `at` timestamps (recordEvent stamps real wall-clock, which
    // DebStatus surfaces via lastDirectiveAt/recentEvents[].at) are identical — otherwise two stores drift
    // microseconds apart and the deep-equal flakes. The contract under test is: the DERIVED (phase,
    // activeAtom) reproduce the canonical imperative inputs the runner feeds at fail().
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'w', path: '/r', name: 'W' })
    const run = store.createRun({ workspaceId: 'w', priorityId: 'demo' })
    for (const e of faultedEvents) store.recordEvent({ runId: run.id, type: e.type, data: e.data })
    const render = (phase: RunnerPhase, activeAtom: number | null) =>
      renderDebStatus({ store, runId: run.id, priority, scopes, phase, activeAtom, activeTask: null, waitCondition: 'run failed after builder-scope-conflict', now }).json

    const derived = deriveTerminalProjection(store.listEvents(run.id))!
    const canonical = render('faulted', 0) // what the runner passes today at fail()
    const fromEvents = render(derived.phase, derived.activeAtom)
    expect(fromEvents).toEqual(canonical)
    expect(canonical.oscar).toBe('blocked')
  })

  test('held: projection recovers awaiting-founder + atom that the runner never refreshes', () => {
    const derived = projectionFor(heldEvents)
    expect(derived).toEqual({ phase: 'awaiting-founder', activeAtom: 2 })
    const s = statusFor(heldEvents, derived!.phase, { activeAtom: derived!.activeAtom, activeTask: null, waitCondition: 'held by founder' })
    expect(s.oscar).toBe('blocked')
    expect(s.activeAtom).toBe(2)
  })

  test('stopped: projection recovers a terminal-blocked phase + atom from run-stopped', () => {
    const derived = projectionFor(stoppedEvents)
    expect(derived).toEqual({ phase: 'faulted', activeAtom: 1 })
    const s = statusFor(stoppedEvents, derived!.phase, { activeAtom: derived!.activeAtom, activeTask: null, waitCondition: 'stopped' })
    expect(s.oscar).toBe('blocked')
    expect(s.activeAtom).toBe(1)
  })

  test('a still-running event log has no terminal projection', () => {
    expect(projectionFor([{ type: 'delegation', data: { atom: 0 } }, { type: 'builder-dispatch', data: { atom: 0 } }])).toBeNull()
  })

  // run_283 stranding class: a `failed` run that nonetheless dispatched a WRAP-UP READY artifact has Oscar
  // holding a live delivery instruction. The projection must be wrapped/standing-by, not faulted/blocked.
  const failedWithDeliveryEvents = [
    { type: 'wrapup', data: { atoms: 3 } },
    { type: 'landing-outcome', data: { landed: true, status: 'failed' } },
    { type: 'wrapup-delivery-dispatch', data: { ref: 'surface:104', path: 'wrapup-delivery.md' } },
    { type: 'run-end', data: { status: 'failed', atoms: 3, committedShas: ['a'], outOfScope: [] } },
  ]
  test('failed run that delivered a WRAP-UP READY projects wrapped/standing-by, not faulted', () => {
    const derived = projectionFor(failedWithDeliveryEvents)
    expect(derived).toEqual({ phase: 'wrapped', activeAtom: 3 })
    const s = statusFor(failedWithDeliveryEvents, derived!.phase, { activeAtom: derived!.activeAtom, activeTask: null, waitCondition: 'standing by' })
    expect(s.oscar).toBe('wrapped') // not 'blocked' — the pane is not dead
  })

  test('failed run with NO wrap-up delivery stays faulted/blocked (the true-fault branch is unchanged)', () => {
    const derived = projectionFor([
      { type: 'wrapup-format-invalid', data: { play: 'wrap-up', issues: ['x'] } },
      { type: 'run-end', data: { status: 'failed', atoms: 2, committedShas: [], outOfScope: [] } },
    ])
    expect(derived).toEqual({ phase: 'faulted', activeAtom: null })
  })

  // Send-outcome hardening: a dispatch whose send THREW (`delivered:false`) is not an outstanding delivery —
  // Oscar never received it, so the projection must fall through to the no-delivery fault, not standing-by.
  test('failed run whose delivery send failed (delivered:false) projects faulted, not standing-by', () => {
    const sendFailedEvents = [
      { type: 'wrapup', data: { atoms: 3 } },
      { type: 'wrapup-delivery-dispatch', data: { ref: 'surface:104', path: 'wrapup-delivery.md', delivered: false, error: 'pane gone' } },
      { type: 'run-end', data: { status: 'failed', atoms: 3, committedShas: ['a'], outOfScope: [] } },
    ]
    expect(wrapupDeliveryDispatched(sendFailedEvents as never)).toBe(false)
    // Same as every failed/no-delivery projection: activeAtom comes from the last atom-bearing event
    // (none here), so it is null — the wrapped/standing-by branch is the only one keyed off endAtoms.
    expect(projectionFor(sendFailedEvents)).toEqual({ phase: 'faulted', activeAtom: null })
  })

  test('wrapupDeliveryDispatched: delivered:true and absent both count; only delivered:false does not', () => {
    expect(wrapupDeliveryDispatched([{ type: 'wrapup-delivery-dispatch', data: { delivered: true } }] as never)).toBe(true)
    expect(wrapupDeliveryDispatched([{ type: 'wrapup-delivery-dispatch', data: { ref: 'x' } }] as never)).toBe(true)
    expect(wrapupDeliveryDispatched([{ type: 'wrapup-delivery-dispatch', data: { delivered: false } }] as never)).toBe(false)
    expect(wrapupDeliveryDispatched([{ type: 'run-end', data: {} }] as never)).toBe(false)
  })

  test('terminalWaitCondition: failed + delivery says standing-by; failed + no delivery says nothing pending', () => {
    expect(terminalWaitCondition('failed', true)).toBe(
      'WRAP-UP READY delivered after a failed wrap; Oscar is standing by for founder questions until explicit teardown',
    )
    expect(terminalWaitCondition('failed')).toBe('run failed; no further runner action pending')
    // The delivery flag never overrides a completed run's already-honest "remains reachable" line.
    expect(terminalWaitCondition('completed', true)).toBe(
      'run completed; Oscar remains reachable for founder questions until explicit teardown',
    )
  })
})

// WS1.3 — the portable run-history surface's run-level summary (`status`, `atoms`, `committedShas`,
// `outOfScope`, `selfCommitted`) was threaded into `writePortableRunHistory` from runner LOCALS. The runner
// records exactly that tuple into the terminal `run-end` event before projecting the portable history, so
// `deriveRunSummary` recovers the whole summary from the event log alone — the proof the surface can project
// ONE source instead of trusting a parallel runner copy. This suite asserts the derived summary equals the
// tuple the runner imperatively builds for each of the four terminal shapes (completed / failed / held /
// stopped). DETERMINISM (WS1.1): summary carries no event `at`, so one store per shape is enough and there is
// no wall-clock field to drift — no two-store deep-equal.
describe('deriveRunSummary — WS1.3 portable run-history summary projection', () => {
  // Each tuple is the exact `data` the runner records at its matching exit:
  //   completed → runner.ts:2020   failed → runner.ts:1054   held → runner.ts:1724   stopped → runner.ts:1686
  const summaryFor = (events: { type: string; data?: unknown }[]) => {
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'w', path: '/r', name: 'W' })
    const run = store.createRun({ workspaceId: 'w', priorityId: 'demo' })
    for (const e of events) store.recordEvent({ runId: run.id, type: e.type, data: e.data })
    return deriveRunSummary(store.listEvents(run.id))
  }

  test('completed: derived summary equals the tuple the runner records at run end', () => {
    const built = { status: 'completed', atoms: 3, committedShas: ['aaa111', 'bbb222'], outOfScope: [], selfCommitted: false }
    expect(summaryFor([
      { type: 'delegation', data: { atom: 0 } },
      { type: 'builder-done', data: { atom: 2 } },
      { type: 'run-end', data: built },
    ])).toEqual(built)
  })

  test('failed: derived summary equals the tuple the runner records at fail()', () => {
    const built = { status: 'failed', atoms: 1, committedShas: [], outOfScope: ['packages/ui/x.ts'], selfCommitted: true }
    expect(summaryFor([
      { type: 'builder-scope-conflict', data: { atom: 0, message: 'out of scope' } },
      { type: 'run-end', data: built },
    ])).toEqual(built)
  })

  test('held: derived summary equals the tuple the runner records at holdRun()', () => {
    const built = { status: 'held', atoms: 2, committedShas: ['ccc333'], outOfScope: [], selfCommitted: false }
    expect(summaryFor([
      { type: 'run-held', data: { park: 'pre-dispatch', atom: 2 } },
      { type: 'run-end', data: built },
    ])).toEqual(built)
  })

  test('stopped: derived summary equals the tuple the runner records at stopRun()', () => {
    const built = { status: 'stopped', atoms: 2, committedShas: [], outOfScope: [], selfCommitted: false }
    expect(summaryFor([
      { type: 'run-stopped', data: { atom: 1 } },
      { type: 'run-end', data: built },
    ])).toEqual(built)
  })

  test('a still-running event log (no run-end) has no derivable summary', () => {
    expect(summaryFor([{ type: 'delegation', data: { atom: 0 } }, { type: 'builder-dispatch', data: { atom: 0 } }])).toBeNull()
  })
})
