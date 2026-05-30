import { describe, it, expect } from 'vitest'
import { formatEvent, formatDuration, isOversightEvent } from '../app/runevents.ts'
import type { RunEvent } from '../electron/ipc-contract.ts'

const ev = (type: string, data: Record<string, unknown>): RunEvent => ({ id: 'e', runId: 'r', type, data, at: 1000 })

describe('formatEvent — human timeline, never raw JSON', () => {
  it('renders known events with friendly titles + tone', () => {
    expect(formatEvent(ev('run-start', { priority: 'p' })).title).toBe('Run started')
    expect(formatEvent(ev('verify-pass', {})).tone).toBe('good')
    expect(formatEvent(ev('out-of-scope', { path: 'x' })).tone).toBe('warn')
    expect(formatEvent(ev('run-error', { error: 'boom' })).tone).toBe('bad')
    expect(formatEvent(ev('commit', { sha: 'abcdef1234', message: 'm' })).title).toBe('Commit abcdef1')
  })

  it('degrades unknown events to a readable title (not JSON)', () => {
    const line = formatEvent(ev('some-new-thing', { a: 1 }))
    expect(line.title).toBe('some new thing')
    expect(line.title).not.toContain('{')
  })

  it('classifies oversight signals (Deb/monitor), incl. forward-compatible fault/triage', () => {
    expect(isOversightEvent('out-of-scope')).toBe(true)
    expect(isOversightEvent('monitor-assessment')).toBe(true)
    expect(isOversightEvent('daemon-stale')).toBe(true)
    expect(isOversightEvent('fault-recorded')).toBe(true)
    expect(isOversightEvent('triage-disposition')).toBe(true)
    expect(isOversightEvent('commit')).toBe(false)
    expect(isOversightEvent('spawn')).toBe(false)
  })

  it('formats duration', () => {
    expect(formatDuration(0, 0)).toBe('')
    expect(formatDuration(1000, 6000)).toBe('5s')
    expect(formatDuration(0 + 1000, 1000 + 95000)).toBe('1m 35s')
  })
})
