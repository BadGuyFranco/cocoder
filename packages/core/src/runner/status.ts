// Deb's live status feed (ADR-0016). A runner-OWNED projection over the store rows — the same
// write-once-from-the-DB pattern as record.ts, but refreshed live during the run and written to a path
// Deb's prompt names. This is how Deb answers "how's Oscar doing?" with EVIDENCE (concrete state,
// timestamps, the current wait condition) instead of hunting cmux panes or run dirs (which her prompt
// forbids). Pure: it derives everything from listEvents + the runner's precise wait-phase, so it is
// unit-testable without a live run.
import type { RunEvent, RunStore } from '../store/index.js'

/** What the runner is doing w.r.t. Oscar right now — the runner passes its precise wait-phase (it knows
 *  it exactly); the projection refines it to `stalled`/`blocked` from the event stream. */
export type RunnerPhase = 'awaiting-directive' | 'building' | 'verifying' | 'wrapped' | 'faulted'
export type OscarState = 'waiting' | 'running' | 'verifying' | 'stalled' | 'blocked' | 'wrapped'
export type BobState = 'standby' | 'running' | 'done' | 'failed'
export type VerifyState = 'idle' | 'pending' | 'pass' | 'fail'

export interface DebStatus {
  readonly runId: string
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
  /** A bounded tail of the run's event log. */
  readonly recentEvents: ReadonlyArray<{ at: number; type: string; note: string | null }>
  readonly generatedAt: number
}

const last = (events: readonly RunEvent[], types: readonly string[]): RunEvent | null => {
  for (let i = events.length - 1; i >= 0; i--) if (types.includes(events[i]!.type)) return events[i]!
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

  // ── Verify (latest signal wins) ──
  const lastVerifyEvt = last(events, ['verify-dispatch', 'verify-pass', 'verify-rejected', 'verify-failed'])
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
  const lastVerifyAt = lastVerifyEvt?.at ?? null
  const stuckIsCurrent =
    lastStuck != null &&
    (lastStuck.data as { state?: unknown })?.state === 'stuck' &&
    lastStuck.at >= Math.max(lastDirectiveAt ?? 0, lastVerifyEvt?.type === 'verify-pass' ? lastVerifyAt ?? 0 : 0)
  let oscar: OscarState =
    phase === 'awaiting-directive'
      ? 'waiting'
      : phase === 'verifying'
        ? 'verifying'
        : phase === 'wrapped'
          ? 'wrapped'
          : phase === 'faulted'
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

  const recentLimit = input.recentLimit ?? 12
  const recentEvents = events.slice(-recentLimit).map((e) => ({ at: e.at, type: e.type, note: noteOf(e) }))

  const json: DebStatus = {
    runId,
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
  lines.push(`# Run status — ${s.runId}`, '')
  lines.push(`- **Priority:** ${s.priorityTitle} (\`${s.priorityId}\`)`)
  lines.push(`- **Active atom:** ${s.activeAtom ?? '—'}${s.activeTask ? ` — ${s.activeTask}` : ''}`)
  lines.push(`- **Oscar:** ${s.oscar}  ·  **Bob:** ${s.bob}  ·  **Verify:** ${s.verify}`)
  lines.push(`- **Waiting on:** ${s.waitCondition}`)
  lines.push(`- **Last directive:** ${ts(s.lastDirectiveAt, s.generatedAt)}`)
  lines.push(`- **Last builder activity:** ${ts(s.lastBuilderActivityAt, s.generatedAt)}`)
  lines.push(`- **Last verify:** ${ts(s.lastVerifyAt, s.generatedAt)}`, '')
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
