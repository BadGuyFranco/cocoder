// Deb's live status feed (ADR-0016). A runner-OWNED projection over the store rows — the same
// write-once-from-the-DB pattern as record.ts, but refreshed live during the run and written to a path
// Deb's prompt names. It complements the runner-owned terminal snapshot: status answers concrete state,
// timestamps, and wait conditions, while the snapshot carries current Oscar/Bob terminal evidence.
// Pure: it derives everything from listEvents + the runner's precise wait-phase, so it is unit-testable
// without a live run.
import { runDisplayName, type RunEvent, type RunDisplayInput, type RunStore } from '../store/index.js'

/** What the runner is doing w.r.t. Oscar right now — the runner passes its precise wait-phase (it knows
 *  it exactly); the projection refines it to `stalled`/`blocked` from the event stream. */
export type RunnerPhase = 'awaiting-directive' | 'building' | 'verifying' | 'wrapped' | 'faulted' | 'awaiting-founder'
export type OscarState = 'waiting' | 'running' | 'verifying' | 'stalled' | 'blocked' | 'wrapped'
export type BobState = 'standby' | 'running' | 'done' | 'failed'
export type VerifyState = 'idle' | 'pending' | 'pass' | 'fail'
export type PlaybookStatus = 'running' | 'awaiting-founder' | 'done'

export interface PlaybookGateStatus {
  readonly playbookId: string
  readonly phaseIndex: number
  readonly phaseId: string
  readonly status: PlaybookStatus
  readonly reachedAt: number | null
}

export interface DebStatus {
  readonly runId: string
  readonly displayName: string
  readonly priorityId: string
  readonly priorityTitle: string
  readonly wrapDisposition: string | null
  readonly nextAction: {
    readonly type: string
    readonly runId?: string
    readonly priorityId?: string
    readonly endpoint?: string
    readonly method?: string
    readonly confirmWith?: string
  } | null
  readonly activeAtom: number | null
  readonly activeTask: string | null
  readonly oscar: OscarState
  readonly bob: BobState
  readonly verify: VerifyState
  /** One line: exactly what the runner is blocked on (e.g. "awaiting directive 2"). */
  readonly waitCondition: string
  readonly lastDirectiveAt: number | null
  readonly lastBuilderActivityAt: number | null
  readonly lastVerifyAt: number | null
  /** Fault dispatches the runner handed Deb that have no recorded verdict yet. */
  readonly outstandingFaults: ReadonlyArray<{ fault: string; atom: number | null; at: number }>
  /** Latest structured Bob blocker reply captured by the runner-owned builder monitor. */
  readonly latestBuilderBlocker: {
    readonly reply: string
    readonly at: number
    readonly atom: number | null
    readonly category: string
    readonly owner: string
  } | null
  /** Write scopes by persona id (constant per run) — so Deb knows who is scoped to write what. */
  readonly writeScopes: Readonly<Record<string, readonly string[]>>
  /** Current handoff/delegation files + their status (delivered / awaiting / pending / pass / fail). */
  readonly handoffs: ReadonlyArray<{ file: string; status: string }>
  /** Runner-owned watcher evidence: Deb is informed by events plus the separate terminal snapshot. */
  readonly watch: {
    readonly active: boolean
    readonly lastDispatchAt: number | null
    readonly lastDispatch: string | null
    readonly lastAssessmentAt: number | null
    readonly lastNudgeAt: number | null
  }
  /** A bounded tail of the run's event log. */
  readonly recentEvents: ReadonlyArray<{ at: number; type: string; note: string | null }>
  readonly generatedAt: number
}

const last = (events: readonly RunEvent[], types: readonly string[]): RunEvent | null => {
  for (let i = events.length - 1; i >= 0; i--) if (types.includes(events[i]!.type)) return events[i]!
  return null
}

// ── WS1 terminal projection (runner-decoupling, ADDITIVE; see runner-decoupling-refactor.md) ──────────
// `renderDebStatus` takes four run-state inputs the runner currently feeds IMPERATIVELY from its own
// locals: `phase`, `activeAtom`, `activeTask`, `waitCondition`. Of these, only `phase` and `activeAtom`
// are load-bearing — they steer derived fields (`oscar`; `verify`'s active-atom selection; `handoffs`).
// `activeTask` and `waitCondition` are free-text DISPLAY labels: pure pass-throughs that touch no derived
// field, and (being prose) are NOT reproducible from the event log — that is the WS1 inventory's hard edge.
//
// For a TERMINAL run (failed / held / stopped) the load-bearing pair is fully recoverable from the event
// log alone: the terminal markers (`run-end {status}`, `run-held {atom}`, `run-stopped {atom}`) plus the
// last atom-bearing event pin both `phase` and `activeAtom` with no runner help. This function derives
// that pair so a terminal run's DebStatus needs zero runner locals. It is the projection seed: nothing is
// wired into the runner yet (no writes moved this step) — it exists to be asserted against the canonical
// `renderDebStatus` output, which is the WS1 step-1 deliverable.
//
// Coarseness recorded for the work-list: `stopped` has no dedicated RunnerPhase/OscarState, so it maps to
// `'faulted'` (→ oscar `'blocked'`), the generic terminal-blocked state. A dedicated terminal OscarState
// is a later refinement, NOT this step.
const lastAtomBearing = (events: readonly RunEvent[]): number | null => {
  for (let i = events.length - 1; i >= 0; i--) {
    const a = atomOf(events[i]!)
    if (a !== null) return a
  }
  return null
}
export function deriveTerminalProjection(
  events: readonly RunEvent[],
): { readonly phase: RunnerPhase; readonly activeAtom: number | null } | null {
  const held = last(events, ['run-held'])
  if (held) return { phase: 'awaiting-founder', activeAtom: atomOf(held) ?? lastAtomBearing(events) }
  const stopped = last(events, ['run-stopped'])
  if (stopped) return { phase: 'faulted', activeAtom: atomOf(stopped) ?? lastAtomBearing(events) }
  const endStatus = (last(events, ['run-end'])?.data as { status?: unknown } | undefined)?.status
  if (endStatus === 'failed') return { phase: 'faulted', activeAtom: lastAtomBearing(events) }
  return null
}
const lastForAtom = (events: readonly RunEvent[], types: readonly string[], atom: number | null): RunEvent | null => {
  if (atom === null) return last(events, types)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (types.includes(event.type) && atomOf(event) === atom) return event
  }
  return null
}
const atomOf = (e: RunEvent | null): number | null => {
  const a = (e?.data as { atom?: unknown } | undefined)?.atom
  return typeof a === 'number' ? a : null
}
const noteOf = (e: RunEvent): string | null => {
  const d = e.data as Record<string, unknown> | undefined
  if (!d) return null
  for (const k of ['note', 'reason', 'summary', 'disposition', 'text', 'task', 'message', 'state']) {
    if (typeof d[k] === 'string' && (d[k] as string).trim() !== '') return d[k] as string
  }
  return null
}

export function renderDebStatus(input: {
  readonly store: RunStore
  readonly runId: string
  readonly priority: { readonly id: string; readonly title: string }
  readonly runDisplay?: Pick<RunDisplayInput, 'displayNumber'> | null
  readonly scopes: Readonly<Record<string, readonly string[]>>
  readonly phase: RunnerPhase
  readonly activeAtom: number | null
  readonly activeTask: string | null
  readonly waitCondition: string
  readonly now?: () => number
  readonly recentLimit?: number
}): { json: DebStatus; markdown: string } {
  const { store, runId, priority, scopes, phase, activeAtom, activeTask, waitCondition } = input
  const now = (input.now ?? Date.now)()
  const events = store.listEvents(runId)
  const displayName = runDisplayName({ id: runId, displayNumber: input.runDisplay?.displayNumber ?? null })

  // ── Bob ──
  const dispatch = last(events, ['builder-dispatch'])
  const done = last(events, ['builder-done'])
  const failed = last(events, ['builder-failed', 'builder-blocked', 'builder-scope-conflict'])
  const bob: BobState = failed
    ? 'failed'
    : dispatch && (!done || (atomOf(dispatch) ?? -1) > (atomOf(done) ?? -1))
      ? 'running'
      : done
        ? 'done'
        : 'standby'

  // ── Verify (latest signal for the active atom wins) ──
  const verifyEvents = ['verify-dispatch', 'verify-pass', 'verify-rejected', 'verify-failed'] as const
  const lastVerifyEvt = lastForAtom(events, verifyEvents, activeAtom)
  const lastAnyVerifyEvt = last(events, verifyEvents)
  const verify: VerifyState =
    lastVerifyEvt?.type === 'verify-pass'
      ? 'pass'
      : lastVerifyEvt?.type === 'verify-rejected' || lastVerifyEvt?.type === 'verify-failed'
        ? 'fail'
        : lastVerifyEvt?.type === 'verify-dispatch'
          ? 'pending'
          : 'idle'

  // ── Outstanding faults: triage-dispatches with no later verdict/skip ──
  const triageDispatched = events.filter((e) => e.type === 'triage-dispatch')
  const triageSettled = events.filter((e) => e.type === 'fault-triaged' || e.type === 'triage-skipped').length
  const outstandingFaults = triageDispatched.slice(triageSettled).map((e) => ({
    fault: String((e.data as { fault?: unknown })?.fault ?? 'unknown'),
    atom: atomOf(e),
    at: e.at,
  }))
  const lastBuilderBlocker = last(events, ['builder-blocker'])
  const lastBuilderBlockerData = lastBuilderBlocker?.data as { reply?: unknown; category?: unknown; owner?: unknown } | undefined
  const latestBuilderBlocker = typeof lastBuilderBlockerData?.reply === 'string'
    ? {
        reply: lastBuilderBlockerData.reply,
        at: lastBuilderBlocker!.at,
        atom: atomOf(lastBuilderBlocker),
        category: typeof lastBuilderBlockerData.category === 'string' ? lastBuilderBlockerData.category : 'reported-blocker',
        owner: outstandingFaults.some((fault) => fault.fault === 'builder-blocked' && fault.atom === atomOf(lastBuilderBlocker))
          ? 'deb-triage'
          : (typeof lastBuilderBlockerData.owner === 'string' ? lastBuilderBlockerData.owner : 'runner'),
      }
    : null

  // ── Oscar (runner phase, refined by the live monitor stream) ──
  const lastDirective = last(events, ['delegation', 'wrapup'])
  const lastDirectiveAt = lastDirective?.at ?? null
  const lastVerifyAt = lastAnyVerifyEvt?.at ?? null
  const lastStuck = last(events, ['oscar-monitor-assessment'])
  const phaseBoundary = [lastDirective, last(events, ['builder-dispatch', 'builder-blocker', 'builder-done', 'builder-failed', 'builder-blocked', 'builder-scope-conflict']), lastAnyVerifyEvt]
    .filter((e): e is RunEvent => e !== null)
    .reduce<RunEvent | null>((latest, event) => {
      if (latest === null) return event
      if (event.at !== latest.at) return event.at > latest.at ? event : latest
      return events.indexOf(event) > events.indexOf(latest) ? event : latest
    }, null)
  const stuckIsCurrent =
    lastStuck != null &&
    (lastStuck.data as { state?: unknown })?.state === 'stuck' &&
    (phaseBoundary === null ||
      lastStuck.at > phaseBoundary.at ||
      (lastStuck.at === phaseBoundary.at && events.indexOf(lastStuck) >= events.indexOf(phaseBoundary)))
  let oscar: OscarState =
    phase === 'awaiting-directive'
      ? 'waiting'
      : phase === 'verifying'
        ? 'verifying'
        : phase === 'wrapped'
          ? 'wrapped'
          : phase === 'faulted' || phase === 'awaiting-founder'
            ? 'blocked'
            : 'running'
  if (outstandingFaults.length > 0) oscar = 'blocked'
  else if (stuckIsCurrent && (phase === 'awaiting-directive' || phase === 'verifying')) oscar = 'stalled'

  // ── Handoffs (the current atom's contract files + any open fault) ──
  const handoffs: { file: string; status: string }[] = []
  if (activeAtom !== null) {
    handoffs.push({ file: `directive-${activeAtom}.json`, status: phase === 'awaiting-directive' ? 'awaiting' : 'delivered' })
    if (verify !== 'idle' && (phase === 'verifying' || verify === 'pass' || verify === 'fail')) {
      handoffs.push({ file: `verify-${activeAtom}.json`, status: verify })
    }
  }
  for (const f of outstandingFaults) handoffs.push({ file: `fault (${f.fault})`, status: 'awaiting-triage' })

  // ── Deb watcher evidence ──
  const watchStarted = last(events, ['deb-watch-started'])
  const watchStopped = last(events, ['deb-watch-stopped', 'deb-watch-error'])
  const lastWatchDispatch = last(events, ['deb-watch-dispatch'])
  const lastWatchAssessment = [...events].reverse().find((e) => e.type === 'oscar-monitor-assessment' && (e.data as { stage?: unknown })?.stage === 'watch') ?? null
  const lastDebNudge = [...events].reverse().find((e) => e.type === 'oscar-nudge' && (e.data as { source?: unknown })?.source === 'deb') ?? null
  const lastDispatchDetail = (lastWatchDispatch?.data as { detail?: unknown } | undefined)?.detail

  const recentLimit = input.recentLimit ?? 12
  const recentEvents = events.slice(-recentLimit).map((e) => ({ at: e.at, type: e.type, note: noteOf(e) }))
  const wrapEventData = last(events, ['wrap-disposition'])?.data as { disposition?: unknown; action?: unknown } | undefined
  const recordedWrapDisposition = wrapEventData?.disposition
  const wrapDisposition = typeof recordedWrapDisposition === 'string' && recordedWrapDisposition.trim() !== '' ? recordedWrapDisposition : null
  const action = wrapEventData?.action as Record<string, unknown> | undefined
  const nextAction = action && typeof action.type === 'string'
    ? {
        type: action.type,
        ...(typeof action.runId === 'string' ? { runId: action.runId } : {}),
        ...(typeof action.priorityId === 'string' ? { priorityId: action.priorityId } : {}),
        ...(typeof action.endpoint === 'string' ? { endpoint: action.endpoint } : {}),
        ...(typeof action.method === 'string' ? { method: action.method } : {}),
        ...(typeof action.confirmWith === 'string' ? { confirmWith: action.confirmWith } : {}),
      }
    : null

  const json: DebStatus = {
    runId,
    displayName,
    priorityId: priority.id,
    priorityTitle: priority.title,
    wrapDisposition,
    nextAction,
    activeAtom,
    activeTask,
    oscar,
    bob,
    verify,
    waitCondition,
    lastDirectiveAt,
    lastBuilderActivityAt: last(events, ['builder-dispatch', 'builder-blocker', 'builder-done', 'builder-failed', 'builder-blocked', 'builder-scope-conflict', 'monitor-assessment', 'nudge', 'commit'])?.at ?? null,
    lastVerifyAt,
    outstandingFaults,
    latestBuilderBlocker,
    writeScopes: scopes,
    handoffs,
    watch: {
      active: watchStarted !== null && (watchStopped === null || watchStopped.at < watchStarted.at),
      lastDispatchAt: lastWatchDispatch?.at ?? null,
      lastDispatch: typeof lastDispatchDetail === 'string' ? lastDispatchDetail : null,
      lastAssessmentAt: lastWatchAssessment?.at ?? null,
      lastNudgeAt: lastDebNudge?.at ?? null,
    },
    recentEvents,
    generatedAt: now,
  }

  return { json, markdown: renderMarkdown(json) }
}

const ts = (ms: number | null, now: number): string => {
  if (ms === null) return '—'
  const ago = Math.max(0, Math.round((now - ms) / 1000))
  return `${new Date(ms).toISOString()} (${ago}s ago)`
}

function renderMarkdown(s: DebStatus): string {
  const lines: string[] = []
  lines.push(`# Run status — ${s.displayName}`, '')
  if (s.displayName !== s.runId) lines.push(`- **Technical id:** \`${s.runId}\``)
  lines.push(`- **Priority:** ${s.priorityTitle} (\`${s.priorityId}\`)`)
  lines.push(`- **Wrap disposition:** ${s.wrapDisposition ?? '—'}`)
  lines.push(`- **Next action:** ${s.nextAction ? `${s.nextAction.type}${s.nextAction.endpoint ? ` via ${s.nextAction.endpoint}` : ''}` : '—'}`)
  lines.push(`- **Active atom:** ${s.activeAtom ?? '—'}${s.activeTask ? ` — ${s.activeTask}` : ''}`)
  lines.push(`- **Oscar:** ${s.oscar}  ·  **Bob:** ${s.bob}  ·  **Verify:** ${s.verify}`)
  lines.push(`- **Waiting on:** ${s.waitCondition}`)
  lines.push(`- **Last directive:** ${ts(s.lastDirectiveAt, s.generatedAt)}`)
  lines.push(`- **Last builder activity:** ${ts(s.lastBuilderActivityAt, s.generatedAt)}`)
  lines.push(`- **Last verify:** ${ts(s.lastVerifyAt, s.generatedAt)}`, '')
  lines.push('## Deb watcher', '')
  lines.push(`- **Active:** ${s.watch.active ? 'yes' : 'no'}`)
  lines.push(`- **Last dispatch:** ${s.watch.lastDispatch ?? '—'} — ${ts(s.watch.lastDispatchAt, s.generatedAt)}`)
  lines.push(`- **Last watch assessment:** ${ts(s.watch.lastAssessmentAt, s.generatedAt)}`)
  lines.push(`- **Last Deb nudge delivered:** ${ts(s.watch.lastNudgeAt, s.generatedAt)}`, '')
  if (s.outstandingFaults.length > 0) {
    lines.push('## Outstanding fault dispatches', '')
    for (const f of s.outstandingFaults) lines.push(`- ${f.fault}${f.atom !== null ? ` (atom ${f.atom})` : ''} — ${ts(f.at, s.generatedAt)}`)
    lines.push('')
  }
  if (s.latestBuilderBlocker !== null) {
    lines.push('## Latest Bob blocker', '')
    lines.push(`- **At:** ${ts(s.latestBuilderBlocker.at, s.generatedAt)}`)
    lines.push(`- **Atom:** ${s.latestBuilderBlocker.atom ?? '—'}`)
    lines.push(`- **Category:** ${s.latestBuilderBlocker.category}`)
    lines.push(`- **Owner:** ${s.latestBuilderBlocker.owner}`)
    lines.push(`- **Reply:** ${s.latestBuilderBlocker.reply}`, '')
  }
  lines.push('## Write scopes by persona', '')
  for (const [p, scope] of Object.entries(s.writeScopes)) lines.push(`- **${p}:** ${scope.length ? scope.join(', ') : '(read-only)'}`)
  lines.push('')
  lines.push('## Handoffs', '')
  for (const h of s.handoffs) lines.push(`- \`${h.file}\` — ${h.status}`)
  if (s.handoffs.length === 0) lines.push('- (none)')
  lines.push('')
  lines.push('## Recent events', '')
  for (const e of s.recentEvents) lines.push(`- ${ts(e.at, s.generatedAt)} \`${e.type}\`${e.note ? ` — ${e.note}` : ''}`)
  lines.push('')
  return lines.join('\n')
}
