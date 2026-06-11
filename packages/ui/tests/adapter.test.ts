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
  adaptCli,
  modelIsStale,
  applyOrder,
  eventToLine,
  evidenceFromDetail,
  mapRunStatus,
  personasToAssignments,
  summarize,
  fmtTime,
  ADHOC_PRIORITY_ID,
} from '../app/adapter.ts'
import type { CliCheckView, CliModelsView, CliRunReadinessView, CliView } from '../electron/ipc-contract.ts'
import type { Persona } from '../app/model.ts'
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

type CliViewOverrides = {
  id?: string
  tested?: boolean
  testedAt?: number | null
  install?: Partial<CliCheckView>
  auth?: Partial<CliCheckView>
  models?: Partial<CliModelsView>
  configManaged?: Partial<CliRunReadinessView>
}

function cliView(overrides: CliViewOverrides = {}): CliView {
  return {
    id: overrides.id ?? 'claude',
    tested: overrides.tested ?? true,
    testedAt: overrides.testedAt === undefined ? 1780153227239 : overrides.testedAt,
    install: { ok: true, detail: 'installed', ...(overrides.install ?? {}) },
    auth: { ok: true, detail: 'authenticated', ...(overrides.auth ?? {}) },
    models: { canEnumerate: true, models: ['opus', 'sonnet'], detail: 'listed models', ...(overrides.models ?? {}) },
    configManaged: { mechanism: 'env', flags: ['--model'], managesUserConfig: false, detail: 'ready', ...(overrides.configManaged ?? {}) },
  }
}

describe('status mapping', () => {
  it('maps daemon statuses onto the design vocabulary; pending-scope-decision → blocked, pending-landing → not-landed', () => {
    expect(mapRunStatus('running')).toBe('running')
    expect(mapRunStatus('completed')).toBe('complete')
    expect(mapRunStatus('completed', 'escalated')).toBe('not-landed')
    expect(mapRunStatus('pending-scope-decision')).toBe('blocked')
    expect(mapRunStatus('pending-landing')).toBe('not-landed')
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

describe('workspaces', () => {
  it('maps daemon roots with raw editable paths and resolved display paths', () => {
    const w = adaptWorkspace(W.workspaces[0])
    expect(w.id).toBe('cocoder')
    expect(w.name).toBe('CoCoder (dogfood)')
    expect(w.description).toBe('')
    expect(w.roots).toHaveLength(2)
    expect(w.roots[0].role).toBe('primary')
    expect(w.roots[0].path).toBe('${COCODER_HOME}')
    expect(w.roots[0].resolvedPath).toBe(W.workspaces[0].path)
    expect(w.roots[1]).toMatchObject({ name: 'Reference', path: './reference', resolvedPath: '/Volumes/NAS LOCAL/CoCoder/local/workspace/reference', role: 'readonly', description: 'Docs root' })
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
  it('keeps a not-landed run attached to its priority until integration is resolved', () => {
    const priorities = [{ id: 'p-not-landed', title: 'Needs landing', goal: 'g', scopeNarrowing: null }]
    const runs = adaptRuns(
      [{ id: 'run_not_landed', workspaceId: 'cocoder', priorityId: 'p-not-landed', status: 'pending-landing', integrationStatus: 'escalated', createdAt: 1780153227239, endedAt: 1780153229000 }],
      { 'p-not-landed': 'Needs landing' },
    )
    const out = adaptPriorities(priorities, runs)
    expect(out[0]).toMatchObject({ runId: 'run_not_landed', status: 'not-landed' })
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
    expect(eventToLine({ id: 'e', runId: 'r', type: 'integration-escalated', data: { reason: 'verify failed' }, at: 0 }).body).toContain('Not landed')
    expect(eventToLine({ id: 'e', runId: 'r', type: 'integration-escalated', data: { reason: 'verify failed' }, at: 0 }).flag).toBe('decision')
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

  it('maps assignment plays to sub-agents and keeps absent plays as an empty hierarchy', () => {
    const personas = adaptPersonas(PERS)
    const oscar = personas.find((p) => p.id === 'oscar')!
    expect(oscar.subAgents).toEqual([{ id: 'wrap-up', name: 'wrap-up', cli: 'cursor-agent', model: 'Default' }])
    expect(personas.find((p) => p.id === 'bob')!.subAgents).toEqual([])
  })

  it('builds a full assignments save payload with plays and preserves daemon-side mode', () => {
    const personas = adaptPersonas(PERS)
    const base = {
      ...PERS.assignments,
      oscar: { ...PERS.assignments.oscar, mode: 'headless' as const },
    }
    const bobNext = { ...personas.find((p) => p.id === 'bob')!, model: 'gpt-5' }
    const oscarNext = {
      ...personas.find((p) => p.id === 'oscar')!,
      subAgents: [{ id: 'wrap-up', name: 'wrap-up', cli: 'cursor-agent', model: 'gpt-5-mini' }],
    }
    const next = personas.map((p) => (p.id === 'bob' ? bobNext : p.id === 'oscar' ? oscarNext : p))

    const payload = personasToAssignments(next, base)

    expect(Object.keys(payload).sort()).toEqual(Object.keys(PERS.assignments).sort())
    expect(payload.bob).toMatchObject({ cli: 'codex', model: 'gpt-5' })
    expect(payload.deb.enabled).toBe(true)
    expect(payload.oscar.mode).toBe('headless')
    expect(payload.oscar.plays).toEqual({ 'wrap-up': { cli: 'cursor-agent', model: 'gpt-5-mini' } })
  })

  it('removing a sub-agent drops only that play key', () => {
    const persona: Persona = {
      id: 'oscar',
      name: 'Oscar',
      role: 'Orchestrator',
      description: 'Delegates work.',
      icon: 'ph-thin ph-strategy',
      cli: 'claude',
      model: 'Default',
      runMode: 'visible',
      subAgents: [
        { id: 'wrap-up', name: 'wrap-up', cli: 'cursor-agent', model: 'Default' },
        { id: 'documentation', name: 'documentation', cli: 'codex', model: 'gpt-5-mini' },
      ],
    }
    const payload = personasToAssignments([{ ...persona, subAgents: persona.subAgents.filter((sa) => sa.id !== 'wrap-up') }], {
      oscar: {
        cli: 'claude',
        model: '',
        plays: {
          'wrap-up': { cli: 'cursor-agent', model: '' },
          documentation: { cli: 'codex', model: 'gpt-5-mini' },
        },
      },
    })

    expect(payload.oscar.plays).toEqual({ documentation: { cli: 'codex', model: 'gpt-5-mini' } })
  })
})

describe('clis', () => {
  it('maps a tested ok CLI, prepends Default, and formats lastTested via fmtTime', () => {
    const cli = adaptCli(cliView())
    expect(cli).toMatchObject({
      id: 'claude',
      name: 'Claude Code',
      vendor: 'Anthropic',
      status: 'ok',
      version: '—',
      lastTested: fmtTime(1780153227239),
      tested: true,
      canEnumerate: true,
      modelsDetail: 'listed models',
      errorDetail: null,
    })
    expect(cli.models).toEqual(['Default', 'opus', 'sonnet'])
    expect(cli.runReadiness).toEqual({ mechanism: 'env', flags: ['--model'], managesUserConfig: false, detail: 'ready' })
  })

  it('maps install failure to not-installed with install detail', () => {
    const cli = adaptCli(cliView({ install: { ok: false, detail: 'missing binary' }, auth: { ok: false, detail: 'not checked' } }))
    expect(cli.status).toBe('not-installed')
    expect(cli.errorDetail).toBe('missing binary')
  })

  it('maps auth failure to auth-failed with auth detail when install is ok', () => {
    const cli = adaptCli(cliView({ auth: { ok: false, detail: 'login expired' } }))
    expect(cli.status).toBe('auth-failed')
    expect(cli.errorDetail).toBe('login expired')
  })

  it('keeps an untested CLI honest with no error detail and never lastTested', () => {
    const cli = adaptCli(cliView({ tested: false, testedAt: null, install: { ok: false, detail: 'not probed' } }))
    expect(cli.tested).toBe(false)
    expect(cli.status).toBe('not-installed')
    expect(cli.errorDetail).toBeNull()
    expect(cli.lastTested).toBe('never')
  })

  it('maps non-enumerating CLIs to Default-only when no models are reported', () => {
    const cli = adaptCli(cliView({ models: { canEnumerate: false, models: [], detail: 'free text only' } }))
    expect(cli.canEnumerate).toBe(false)
    expect(cli.models).toEqual(['Default'])
    expect(cli.modelsDetail).toBe('free text only')
  })

  it('detects stale models only when an enumerated list can prove the model is gone', () => {
    const cli = adaptCli(cliView())
    const nonEnumerating = adaptCli(cliView({ models: { canEnumerate: false, models: [], detail: 'free text only' } }))
    expect(modelIsStale(cli, 'haiku')).toBe(true)
    expect(modelIsStale(cli, 'Default')).toBe(false)
    expect(modelIsStale(undefined, 'haiku')).toBe(false)
    expect(modelIsStale(nonEnumerating, 'haiku')).toBe(false)
  })
})
