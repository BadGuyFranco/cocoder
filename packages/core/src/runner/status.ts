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
  const failed = last(events, ['builder-failed'])
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

  // ── Oscar (runner phase, refined by the live monitor stream) ──
  const lastStuck = last(events, ['oscar-monitor-assessment'])
  const lastDirectiveAt = last(events, ['delegation', 'wrapup'])?.at ?? null
  const lastVerifyAt = lastAnyVerifyEvt?.at ?? null
  const stuckIsCurrent =
    lastStuck != null &&
    (lastStuck.data as { state?: unknown })?.state === 'stuck' &&
    lastStuck.at >= Math.max(lastDirectiveAt ?? 0, lastAnyVerifyEvt?.type === 'verify-pass' ? lastVerifyAt ?? 0 : 0)
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

  const json: DebStatus = {
    runId,
    displayName,
    priorityId: priority.id,
    priorityTitle: priority.title,
    activeAtom,
    activeTask,
    oscar,
    bob,
    verify,
    waitCondition,
    lastDirectiveAt,
    lastBuilderActivityAt: last(events, ['builder-dispatch', 'builder-done', 'monitor-assessment', 'nudge', 'commit'])?.at ?? null,
    lastVerifyAt,
    outstandingFaults,
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
