// @vitest-environment node
// Adapter mapping tests — driven by fixtures CAPTURED FROM THE LIVE DAEMON (fixtures/*.json, ws id
// cocoder). This is the real evidence the daemon→view-model translation is correct: every assertion
// runs the actual daemon shapes through the adapter the renderer uses.
import { describe, it, expect } from 'vitest'
import {
  adaptWorkspace,
  adaptPriorities,
  adaptRuns,
  adaptRunSummary,
  adaptRunDetail,
  adaptPersonas,
  applyOrder,
  eventToLine,
  evidenceFromDetail,
  mapRunStatus,
  summarize,
  fmtTime,
  ADHOC_PRIORITY_ID,
} from '../app/adapter.ts'
import workspacesFx from '../fixtures/workspaces.json'
import prioritiesFx from '../fixtures/priorities.json'
import personasFx from '../fixtures/personas.json'
import runsFx from '../fixtures/runs.json'
import runDetailFx from '../fixtures/run-detail.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const W = workspacesFx as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = prioritiesFx as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PERS = personasFx as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RUNS = runsFx as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DETAIL = runDetailFx as any

const priorityNames: Record<string, string> = Object.fromEntries(P.priorities.map((p: any) => [p.id, p.title]))

describe('status mapping', () => {
  it('maps the four daemon statuses onto the design vocabulary; pending-scope-decision → blocked', () => {
    expect(mapRunStatus('running')).toBe('running')
    expect(mapRunStatus('completed')).toBe('complete')
    expect(mapRunStatus('pending-scope-decision')).toBe('blocked')
    expect(mapRunStatus('failed')).toBe('failed')
    expect(mapRunStatus('weird-unknown')).toBe('stopped')
  })
})

describe('helpers', () => {
  it('summarize strips markdown headings/bold and trims to a one-liner', () => {
    const s = summarize(P.priorities.find((p: any) => p.id === 'adhoc-session').goal)
    expect(s).not.toContain('##')
    expect(s).not.toContain('**')
    expect(s.length).toBeLessThanOrEqual(201)
  })
  it('fmtTime is a deterministic UTC string (no locale/now())', () => {
    expect(fmtTime(1780153227239)).toBe('2026-05-30 15:00')
    expect(fmtTime(NaN)).toBe('')
  })
})

describe('workspaces (thin)', () => {
  it('maps id/name and synthesizes a single primary root from path; description owed', () => {
    const w = adaptWorkspace(W.workspaces[0])
    expect(w.id).toBe('cocoder')
    expect(w.name).toBe('CoCoder (dogfood)')
    expect(w.description).toBe('')
    expect(w.roots).toHaveLength(1)
    expect(w.roots[0].role).toBe('primary')
    expect(w.roots[0].path).toBe(W.workspaces[0].path)
  })
})

describe('priorities joined with runs', () => {
  it('excludes the ad-hoc priority and maps title→name, goal→summary', () => {
    const runs = adaptRuns(RUNS.runs, priorityNames)
    const out = adaptPriorities(P.priorities, runs)
    expect(out.find((p) => p.id === ADHOC_PRIORITY_ID)).toBeUndefined()
    const plays = out.find((p) => p.id === 'plays-mechanism')!
    expect(plays.name).toBe(priorityNames['plays-mechanism'])
    expect(plays.summary.length).toBeGreaterThan(0)
  })
  it('a priority with a live run adopts the run id + status; others are "ready"', () => {
    const runs = adaptRuns(RUNS.runs, priorityNames)
    const out = adaptPriorities(P.priorities, runs)
    // run_24 (plays-mechanism) is failed; run_17 (base-and-extension) is pending-scope-decision.
    const blocked = out.find((p) => p.id === 'base-and-extension-personas')
    const liveRun = runs.find((r) => r.priorityId === 'base-and-extension-personas' && r.status === 'blocked')
    if (liveRun) {
      expect(blocked!.runId).toBe(liveRun.id)
      expect(blocked!.status).toBe('blocked')
    }
    const dormant = out.find((p) => !runs.some((r) => r.priorityId === p.id && (r.status === 'running' || r.status === 'blocked')))
    expect(dormant!.status).toBe('ready')
  })
})

describe('runs list', () => {
  it('titles each run from its priority and routes ad-hoc runs off-priority', () => {
    const runs = adaptRuns(RUNS.runs, priorityNames)
    expect(runs).toHaveLength(RUNS.runs.length)
    const adhoc = RUNS.runs.find((r: any) => r.priorityId === ADHOC_PRIORITY_ID)
    if (adhoc) {
      const mapped = runs.find((r) => r.id === adhoc.id)!
      expect(mapped.priorityId).toBeNull()
    }
    const newest = adaptRunSummary(RUNS.runs[0], priorityNames)
    expect(newest.id).toBe(RUNS.runs[0].id)
    expect(newest.startedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('transcript from events', () => {
  it('humanizes every event type (no raw JSON) and flags decision events', () => {
    for (const e of DETAIL.events) {
      const line = eventToLine(e)
      expect(typeof line.body).toBe('string')
      expect(line.body.length).toBeGreaterThan(0)
      expect(line.body).not.toContain('{')
    }
    const stale = DETAIL.events.find((e: any) => e.type === 'daemon-stale')
    if (stale) expect(eventToLine(stale).flag).toBe('decision')
  })
})

describe('evidence from commits/diffs/files', () => {
  it('builds commit cards with diff stats and includes the run record', () => {
    const ev = evidenceFromDetail(DETAIL)
    expect(ev.length).toBeGreaterThan(0)
    const commit = ev.find((e) => e.kind === 'diff')
    expect(commit).toBeDefined()
    expect(commit!.lines).toMatch(/^\+\d+ −\d+$|file/)
    expect(ev.some((e) => e.kind === 'note' && e.label === 'Run record')).toBe(true)
  })
})

describe('run detail enrichment', () => {
  it('adds personas from sessions, cli from preflight, transcript + evidence + attach', () => {
    const run = adaptRunDetail(DETAIL, priorityNames)
    expect(run.id).toBe(DETAIL.run.id)
    expect(run.personas.length).toBe(new Set(DETAIL.sessions.map((s: any) => s.persona)).size)
    expect(run.cli.length).toBeGreaterThan(0)
    expect((run.transcript ?? []).length).toBe(DETAIL.events.length)
    expect((run.evidence ?? []).length).toBeGreaterThan(0)
    // run_21 sessions are not deepLinkable → no attach command (renderer falls back to a default)
    const anyLinkable = DETAIL.sessions.some((s: any) => s.deepLinkable)
    expect(run.attachCmd === undefined).toBe(!anyLinkable)
  })
})

describe('drag-reorder overlay', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  it('orders known ids by saved index; unknown ids keep daemon order, appended', () => {
    expect(applyOrder(items, ['c', 'a']).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd'])
  })
  it('returns items unchanged when there is no saved order', () => {
    expect(applyOrder(items, []).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('personas from the assignments map + roster', () => {
  it('renders the live roster with cli/model resolved from assignments', () => {
    const personas = adaptPersonas(PERS)
    expect(personas.length).toBeGreaterThan(0)
    const bob = personas.find((p) => p.id === 'bob')!
    expect(bob.name).toBe('Bob')
    expect(bob.cli).toBe(PERS.assignments.bob.cli)
    // role is split off the long description
    expect(bob.role.length).toBeLessThan(bob.description.length + 1)
    expect(bob.subAgents).toEqual([])
  })
})
