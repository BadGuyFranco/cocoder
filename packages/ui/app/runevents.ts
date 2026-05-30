// Turn a raw run event into a human timeline line — NEVER raw JSON (hard constraint #6). Pure +
// unit-tested. Unknown types degrade to a readable title, so a new daemon event never shows as JSON.
import type { RunEvent } from '../electron/ipc-contract.ts'

export interface TimelineLine {
  readonly type: string
  readonly title: string
  readonly detail?: string
  readonly tone: 'info' | 'good' | 'warn' | 'bad'
  readonly at: number
}

const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const short = (sha: unknown): string => s(sha).slice(0, 7)

export function formatEvent(e: RunEvent): TimelineLine {
  const d = e.data ?? {}
  const at = e.at
  switch (e.type) {
    case 'run-start':
      return { type: e.type, title: 'Run started', detail: `priority ${s(d.priority)}`, tone: 'info', at }
    case 'preflight':
      return { type: e.type, title: `Preflight — ${s(d.persona)} (${s(d.cli)})`, detail: d.ok ? 'ok' : 'failed', tone: d.ok ? 'good' : 'bad', at }
    case 'spawn':
      return { type: e.type, title: `Spawned ${s(d.persona)}`, detail: s(d.ref), tone: 'info', at }
    case 'delegation':
      return { type: e.type, title: `Delegated ${s(d.sourcePersona) || ''}→${s(d.targetPersona) || ''}`.trim(), detail: s(d.task).slice(0, 140), tone: 'info', at }
    case 'builder-dispatch':
      return { type: e.type, title: 'Builder dispatched', detail: s(d.task).slice(0, 140), tone: 'info', at }
    case 'builder-done':
      return { type: e.type, title: 'Builder finished', tone: 'info', at }
    case 'monitor-assessment':
      return { type: e.type, title: 'Monitor assessment', detail: s(d.assessment || d.summary || d.state).slice(0, 200), tone: 'info', at }
    case 'verify-dispatch':
      return { type: e.type, title: 'Verify dispatched', tone: 'info', at }
    case 'verify-pass':
      return { type: e.type, title: 'Verify passed', tone: 'good', at }
    case 'commit':
      return { type: e.type, title: `Commit ${short(d.sha || d.commitSha)}`, detail: s(d.message).slice(0, 140), tone: 'good', at }
    case 'out-of-scope':
      return { type: e.type, title: 'Out-of-scope change flagged', detail: s(d.path || d.detail).slice(0, 160), tone: 'warn', at }
    case 'daemon-stale':
      return { type: e.type, title: 'Daemon stale vs HEAD', detail: `boot ${short(d.bootSha)} · head ${short(d.headSha)}`, tone: 'warn', at }
    case 'wrapup':
      return { type: e.type, title: 'Wrap-up', tone: 'info', at }
    case 'run-end':
      return { type: e.type, title: 'Run ended', detail: s(d.status), tone: 'info', at }
    case 'teardown':
      return { type: e.type, title: 'Teardown', detail: s(d.detail), tone: 'info', at }
    case 'orphaned':
      return { type: e.type, title: 'Orphaned session', detail: s(d.detail), tone: 'warn', at }
    case 'run-error':
      return { type: e.type, title: 'Run error', detail: s(d.error || d.message).slice(0, 200), tone: 'bad', at }
    default:
      return { type: e.type, title: e.type.replace(/-/g, ' '), tone: 'info', at }
  }
}

// Oversight projection (slice 6): the event types Deb/the monitor write that Oz READS read-only.
// Substring match keeps it forward-compatible with fault/triage/disposition events the daemon may add.
const OVERSIGHT_EXACT = new Set(['out-of-scope', 'monitor-assessment', 'daemon-stale', 'run-error', 'orphaned'])
const OVERSIGHT_SUBSTR = ['fault', 'triage', 'disposition']
export const isOversightEvent = (type: string): boolean => OVERSIGHT_EXACT.has(type) || OVERSIGHT_SUBSTR.some((k) => type.includes(k))

export const formatTime = (ms: number): string => {
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export const formatDuration = (start: number, end: number | null): string => {
  if (!start) return ''
  const ms = (end ?? start) - start
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${sec % 60}s`
}
