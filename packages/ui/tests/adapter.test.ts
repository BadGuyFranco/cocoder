// @vitest-environment node
// Adapter mapping tests — driven by fixtures CAPTURED FROM THE LIVE DAEMON (fixtures/*.json, ws id
// cocoder). This is the real evidence the daemon→view-model translation is correct: every assertion
// runs the actual daemon shapes through the adapter the renderer uses.
import { describe, it, expect } from 'vitest'
import {
  adaptWorkspace,
  adaptPriorities,
  adaptTickets,
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
  mergeRunsWithEnrichment,
  orderPersonas,
  personasToAssignments,
  summarize,
  fmtTime,
  ADHOC_PRIORITY_ID,
} from '../src/renderer/adapter.ts'
import type { CliCheckView, CliModelsView, CliRunReadinessView, CliView, RunDetail } from '../src/main/ipc-contract.ts'
import type { Persona } from '../src/renderer/model.ts'
import { seed } from '../src/renderer/model.ts'
import workspacesFx from '../fixtures/workspaces.json'
import prioritiesFx from '../fixtures/priorities.json'
import ticketsFx from '../fixtures/tickets.json'
import personasFx from '../fixtures/personas.json'
import runsFx from '../fixtures/runs.json'
import runDetailFx from '../fixtures/run-detail.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const W = workspacesFx as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = prioritiesFx as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const T = ticketsFx as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PERS = personasFx as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RUNS = runsFx as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DETAIL = runDetailFx as any

const priorityNames: Record<string, string> = Object.fromEntries(P.priorities.map((p: any) => [p.id, p.title]))

function detailWithEvents(events: RunDetail['events']): RunDetail {
  return {
    run: {
      id: 'run_founder',
      workspaceId: 'cocoder',
      priorityId: 'demo',
      playbookId: null,
      status: 'held',
      createdAt: 1780153227239,
      endedAt: 1780153229000,
    },
    sessions: [],
    workItems: [],
    commitLinks: [],
    events,
    files: { oscarOut: null, oscarErr: null, bobOut: null, bobErr: null, pickup: null, record: null },
    diffs: [],
  }
}

type CliViewOverrides = {
  id?: string
  tested?: boolean
  testedAt?: number | null
  install?: Partial<CliCheckView>
  auth?: Partial<CliCheckView>
  model?: Partial<CliCheckView>
  models?: Partial<CliModelsView>
  configManaged?: Partial<CliRunReadinessView>
  headlessCapable?: boolean
}

function cliView(overrides: CliViewOverrides = {}): CliView {
  const id = overrides.id ?? 'claude'
  return {
    id,
    tested: overrides.tested ?? true,
    testedAt: overrides.testedAt === undefined ? 1780153227239 : overrides.testedAt,
    install: { ok: true, detail: 'installed', ...(overrides.install ?? {}) },
    auth: { ok: true, detail: 'authenticated', ...(overrides.auth ?? {}) },
    model: { ok: true, detail: 'default model', ...(overrides.model ?? {}) },
    models: { canEnumerate: true, models: ['opus', 'sonnet'], detail: 'listed models', ...(overrides.models ?? {}) },
    configManaged: { mechanism: 'env', flags: ['--model'], managesUserConfig: false, detail: 'ready', ...(overrides.configManaged ?? {}) },
    headlessCapable: overrides.headlessCapable ?? (id === 'claude' || id === 'codex' || id === 'cursor-agent'),
  }
}

describe('status mapping', () => {
  it('maps daemon statuses onto the design vocabulary (single mode — no landing sub-state)', () => {
    expect(mapRunStatus('running')).toBe('running')
    expect(mapRunStatus('completed')).toBe('complete')
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
  it('maps independent-of-runner priorities to a runnerless dashboard signal', () => {
    const out = adaptPriorities([{ id: 'runnerless', title: 'Runnerless', goal: 'g', scopeNarrowing: null, independentOfRunner: true }], [])
    expect(out[0]).toMatchObject({ id: 'runnerless', independentOfRunner: true, labels: ['runnerless'] })
  })
  it('a priority with a live run adopts the run id + status; others are "ready"', () => {
    const runs = adaptRuns(RUNS.runs, priorityNames)
    const out = adaptPriorities(P.priorities, runs)
    // run_24 (plays-mechanism) is failed; run_17 (base-and-extension) is completed.
    const active = out.find((p) => p.id === 'base-and-extension-personas')
    const settledRun = runs.find((r) => r.priorityId === 'base-and-extension-personas')
    expect(settledRun?.status).toBe('complete')
    expect(active!.runId).toBeUndefined()
    const dormant = out.find((p) => !runs.some((r) => r.priorityId === p.id && (r.status === 'running' || r.status === 'blocked')))
    expect(dormant!.status).toBe('ready')
  })
  it('does NOT adopt a settled (completed) run as the priority’s active run — only active runs attach', () => {
    const priorities = [{ id: 'p-done', title: 'Done', goal: 'g', scopeNarrowing: null }]
    const runs = adaptRuns(
      [{ id: 'run_done', workspaceId: 'cocoder', priorityId: 'p-done', status: 'completed', createdAt: 1780153227239, endedAt: 1780153229000 }],
      { 'p-done': 'Done' },
    )
    const out = adaptPriorities(priorities, runs)
    // A completed run committed its work straight to the branch and ended — it is not an active row.
    expect(out[0].runId).toBeUndefined()
    expect(out[0].status).not.toBe('complete')
  })
})

describe('tickets', () => {
  it('maps daemon ticket fixtures into the renderer view model', () => {
    const tickets = adaptTickets(T.tickets)

    expect(tickets.map((ticket) => [ticket.id, ticket.state])).toEqual([
      ['0003', 'open'],
      ['0012', 'open'],
      ['0008', 'closed'],
    ])
    expect(tickets.find((ticket) => ticket.id === '0012')).toMatchObject({
      title: 'Guard against design-ref rebuilds reverting committed packages/ui/app fixes',
      type: 'task',
      status: 'Open',
      priority: 'oz-dashboard-bugs',
      owner: 'oscar run_94',
      created: '2026-06-15',
      body: expect.stringContaining('design-ref rebuild-clobber guard'),
    })
  })

  it('preserves ticket pending-close run markers from the daemon surface', () => {
    const tickets = adaptTickets([{ ...T.tickets[0], pendingCloseRunId: 'run_238' }])

    expect(tickets[0]).toMatchObject({ id: '0003', pendingCloseRunId: 'run_238' })
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

  it('labels runs with the workspace-local display number when the daemon provides it', () => {
    const summary = { id: 'run_global_42', displayNumber: 3, workspaceId: 'cocoder', priorityId: 'p', status: 'running', createdAt: 1780153227239, endedAt: null } as const
    const run = adaptRunSummary(summary, { p: 'Priority' })

    expect(run.id).toBe('run_global_42')
    expect(run.displayNumber).toBe(3)
    expect(run.displayName).toBe('workspace run 3')
  })

  it('uses the real workspace name for display numbers when the live adapter has it', () => {
    const summary = { id: 'run_global_98', displayNumber: 98, workspaceId: 'cocoder', priorityId: 'p', status: 'running', createdAt: 1780153227239, endedAt: null } as const

    expect(adaptRunSummary(summary, { p: 'Priority' }, 'CoCoder').displayName).toBe('CoCoder run 98')
    expect(adaptRuns([summary], { p: 'Priority' }, 'CoCoder')[0].displayName).toBe('CoCoder run 98')
    expect(adaptRunSummary(summary, { p: 'Priority' }).displayName).toBe('workspace run 98')
    expect(adaptRuns([summary], { p: 'Priority' })[0].displayName).toBe('workspace run 98')
  })
})

describe('run enrichment merging', () => {
  it('preserves real detail-only fields for unchanged active runs during summary refreshes', () => {
    const summary = adaptRunSummary({ id: 'run_active', workspaceId: 'cocoder', priorityId: 'p', status: 'running', createdAt: 1780153227239, endedAt: null }, { p: 'Priority' })
    const enriched = {
      ...summary,
      personas: ['oscar', 'bob'],
      cli: 'claude · codex',
      lastEvent: 'Delegated: real event',
      transcript: [{ role: 'oscar', body: 'real event' }],
      evidence: [{ kind: 'note' as const, label: 'Run record', body: 'record' }],
      attachCmd: 'cmux show surface:2',
    }

    expect(mergeRunsWithEnrichment([summary], [enriched])).toEqual([enriched])
  })

  it('does not carry enrichment across a status change', () => {
    const blocked = adaptRunSummary({ id: 'run_active', workspaceId: 'cocoder', priorityId: 'p', status: 'pending-scope-decision', createdAt: 1780153227239, endedAt: null }, { p: 'Priority' })
    const running = adaptRunSummary({ id: 'run_active', workspaceId: 'cocoder', priorityId: 'p', status: 'running', createdAt: 1780153227239, endedAt: null }, { p: 'Priority' })
    const enrichedBlocked = { ...blocked, personas: ['oscar'], lastEvent: 'Blocked detail' }

    expect(mergeRunsWithEnrichment([running], [enrichedBlocked])).toEqual([running])
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
    // Single mode: the settled outcome + non-gating push are humanized (no integration/landing events).
    expect(eventToLine({ id: 'e', runId: 'r', type: 'landing-outcome', data: { outcome: '✅ COMMITTED on `main`' }, at: 0 }).body).toContain('COMMITTED')
    expect(eventToLine({ id: 'e', runId: 'r', type: 'branch-pushed', data: { branch: 'feature/x' }, at: 0 }).body).toContain('feature/x')
    expect(eventToLine({ id: 'e', runId: 'r', type: 'ui-bundle-rebuild-failed', data: { exitCode: 2, output: 'vite failed' }, at: 0 })).toMatchObject({
      body: expect.stringContaining('Oz UI bundle rebuild FAILED'),
      flag: 'decision',
    })
    expect(eventToLine({ id: 'e', runId: 'r', type: 'ui-bundle-rebuild-clobber-blocked', data: { files: ['packages/ui/app/App.tsx'] }, at: 0 })).toMatchObject({
      body: expect.stringContaining('packages/ui/app/App.tsx'),
      flag: 'decision',
    })
    expect(eventToLine({ id: 'e', runId: 'r', type: 'daemon-auto-reload-build-failed', data: { exitCode: 2, output: 'typecheck failed' }, at: 0 })).toMatchObject({
      body: expect.stringContaining('Oz daemon reload validation FAILED'),
      flag: 'decision',
    })
    expect(eventToLine({ id: 'e', runId: 'r', type: 'daemon-auto-reload-restart-queued', data: {}, at: 0 }).body).toContain('restarting')
  })

  it('renders founder decision requests with the question body and decision flag', () => {
    const question = [
      'FOUNDER DECISION NEEDED: pick the UI behavior.',
      '',
      'A) Surface the pending question on the run card.',
      'B) Keep showing the terminal run-end event.',
    ].join('\n')

    expect(eventToLine({ id: 'e', runId: 'r', type: 'founder-decision-requested', data: { question }, at: 0 })).toMatchObject({
      body: expect.stringContaining('FOUNDER DECISION NEEDED — FOUNDER DECISION NEEDED: pick the UI behavior.'),
      flag: 'decision',
    })
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

  it('prefers a still-pending founder question as the run last event over later terminal events', () => {
    const question = [
      'FOUNDER DECISION NEEDED: choose the final UI path.',
      '',
      'A) Show the pending decision on the card.',
      'B) Show only the held terminal status.',
    ].join('\n')
    const run = adaptRunDetail(detailWithEvents([
      { id: 'e1', runId: 'run_founder', type: 'founder-decision-requested', data: { question }, at: 1 },
      { id: 'e2', runId: 'run_founder', type: 'run-held', data: { park: 'pre-dispatch', atom: 0 }, at: 2 },
      { id: 'e3', runId: 'run_founder', type: 'run-end', data: { status: 'held' }, at: 3 },
      { id: 'e4', runId: 'run_founder', type: 'commit', data: { sha: 'abc123456789', message: 'run-history' }, at: 4 },
    ]), { demo: 'Demo' })

    expect(run.lastEvent).toContain('FOUNDER DECISION NEEDED — FOUNDER DECISION NEEDED: choose the final UI path.')
    expect(run.lastEvent).not.toContain('Committed abc1234')
  })

  it('falls back to the latest event once a founder question is superseded', () => {
    const question = [
      'FOUNDER DECISION NEEDED: choose the final UI path.',
      '',
      'A) Resume.',
      'B) Stop.',
    ].join('\n')
    const resumed = adaptRunDetail(detailWithEvents([
      { id: 'e1', runId: 'run_founder', type: 'founder-decision-requested', data: { question }, at: 1 },
      { id: 'e2', runId: 'run_founder', type: 'run-resumed', data: { park: 'pre-dispatch', atom: 0 }, at: 2 },
      { id: 'e3', runId: 'run_founder', type: 'commit', data: { sha: 'abc123456789', message: 'founder answer' }, at: 3 },
    ]), { demo: 'Demo' })
    const completed = adaptRunDetail(detailWithEvents([
      { id: 'e1', runId: 'run_founder', type: 'founder-decision-requested', data: { question }, at: 1 },
      { id: 'e2', runId: 'run_founder', type: 'run-end', data: { status: 'completed' }, at: 2 },
    ]), { demo: 'Demo' })

    expect(resumed.lastEvent).toBe('Committed abc1234 — founder answer.')
    expect(completed.lastEvent).toBe('Run ended — status completed.')
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
    expect(personas.map((p) => p.id)).toEqual(['oscar', 'bob', 'deb'])
    const bob = personas.find((p) => p.id === 'bob')!
    expect(bob.name).toBe('Bob')
    expect(bob.cli).toBe(PERS.assignments.bob.cli)
    // role is split off the long description
    expect(bob.role.length).toBeLessThan(bob.description.length + 1)
    expect(bob.subAgents).toEqual([])
  })

  it('uses the canonical persona order with unknown personas after the roster', () => {
    const personas = orderPersonas([{ id: 'quinn' }, { id: 'doc' }, { id: 'bob' }, { id: 'oz' }, { id: 'deb' }, { id: 'oscar' }])
    expect(personas.map((p) => p.id)).toEqual(['oz', 'oscar', 'bob', 'deb', 'quinn', 'doc'])
  })

  it('maps assignment plays to sub-agents and keeps absent plays as an empty hierarchy', () => {
    const personas = adaptPersonas(PERS)
    const oscar = personas.find((p) => p.id === 'oscar')!
    expect(oscar.subAgents).toEqual([{ id: 'wrap-up', name: 'wrap-up', cli: 'cursor-agent', model: 'Default' }])
    expect(personas.find((p) => p.id === 'bob')!.subAgents).toEqual([])
  })

  it('maps persona and play tiers from assignments into the editable model', () => {
    const personas = adaptPersonas({
      workspace: { id: 'cocoder', name: 'CoCoder', path: '/repo' },
      personas: [{ id: 'oscar', label: 'Oscar', role: 'Orchestrator — delegates work' }],
      assignments: {
        oscar: {
          cli: 'claude',
          model: '',
          tier: 'burstable',
          plays: { documentation: { cli: 'claude', model: '', tier: 'economy_lane' } },
        },
      },
    })

    expect(personas[0]).toMatchObject({ id: 'oscar', model: 'Default', tier: 'burstable' })
    expect(personas[0].subAgents).toEqual([{ id: 'documentation', name: 'documentation', cli: 'claude', model: 'Default', tier: 'economy_lane' }])
  })

  it('derives display runMode from assignment mode, not enabled staffing', () => {
    const personas = adaptPersonas({
      workspace: { id: 'cocoder', name: 'CoCoder', path: '/repo' },
      personas: [
        { id: 'oscar', label: 'Oscar', role: 'Orchestrator — delegates work' },
        { id: 'bob', label: 'Bob', role: 'Builder — builds work' },
        { id: 'deb', label: 'Deb', role: 'Repair — triages faults' },
      ],
      assignments: {
        oscar: { cli: 'claude', model: '', mode: 'headless' },
        bob: { cli: 'codex', model: '', enabled: false },
        deb: { cli: 'claude', model: '' },
      },
    })

    expect(personas.find((p) => p.id === 'oscar')!.runMode).toBe('headless')
    expect(personas.find((p) => p.id === 'bob')!.runMode).toBe('visible')
    expect(personas.find((p) => p.id === 'deb')!.runMode).toBe('visible')
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
      runMode: 'headless' as const,
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

  it('writes selected tiers and removes stale tiers when concrete models are selected', () => {
    const persona: Persona = {
      id: 'oscar',
      name: 'Oscar',
      role: 'Orchestrator',
      description: 'Delegates work.',
      icon: 'ph-thin ph-strategy',
      cli: 'claude',
      model: 'Default',
      tier: 'burstable',
      runMode: 'visible',
      subAgents: [
        { id: 'wrap-up', name: 'wrap-up', cli: 'claude', model: 'Default', tier: 'economy_lane' },
        { id: 'documentation', name: 'documentation', cli: 'claude', model: 'opus' },
      ],
    }

    const payload = personasToAssignments([persona], {
      oscar: {
        cli: 'claude',
        model: 'stale-model',
        tier: 'stale-tier',
        plays: {
          'wrap-up': { cli: 'claude', model: 'stale-model', tier: 'stale-tier' },
          documentation: { cli: 'claude', model: '', tier: 'stale-tier' },
        },
      },
    })

    expect(payload.oscar).toMatchObject({ cli: 'claude', model: '', tier: 'burstable' })
    expect(payload.oscar.plays).toEqual({
      'wrap-up': { cli: 'claude', model: '', tier: 'economy_lane' },
      documentation: { cli: 'claude', model: 'opus' },
    })
  })

  it('writes edited mode for Oscar and Bob while preserving non-honored daemon modes untouched', () => {
    const oscar: Persona = {
      id: 'oscar',
      name: 'Oscar',
      role: 'Orchestrator',
      description: 'Delegates work.',
      icon: 'ph-thin ph-strategy',
      cli: 'claude',
      model: 'Default',
      runMode: 'headless',
      subAgents: [],
    }
    const bob: Persona = {
      id: 'bob',
      name: 'Bob',
      role: 'Builder',
      description: 'Builds work.',
      icon: 'ph-thin ph-hammer',
      cli: 'codex',
      model: 'Default',
      runMode: 'visible',
      subAgents: [],
    }
    const deb: Persona = {
      id: 'deb',
      name: 'Deb',
      role: 'Repair',
      description: 'Repairs machinery.',
      icon: 'ph-thin ph-bug-beetle',
      cli: 'claude',
      model: 'Default',
      runMode: 'headless',
      subAgents: [],
    }

    const payload = personasToAssignments([oscar, bob, deb], {
      bob: { cli: 'codex', model: '', mode: 'headless' },
      deb: { cli: 'claude', model: '' },
    })

    expect(payload.oscar.mode).toBe('headless')
    expect(payload.bob.mode).toBe('visible')
    expect(payload.deb.mode).toBeUndefined()
  })

  it('maps Bob runMode into the assignments payload like Oscar and keeps Deb preview-only', () => {
    const oscar: Persona = {
      id: 'oscar',
      name: 'Oscar',
      role: 'Orchestrator',
      description: 'Delegates work.',
      icon: 'ph-thin ph-strategy',
      cli: 'claude',
      model: 'Default',
      runMode: 'headless',
      subAgents: [],
    }
    const bob: Persona = {
      id: 'bob',
      name: 'Bob',
      role: 'Builder',
      description: 'Builds work.',
      icon: 'ph-thin ph-hammer',
      cli: 'codex',
      model: 'Default',
      runMode: 'headless',
      subAgents: [],
    }
    const deb: Persona = {
      id: 'deb',
      name: 'Deb',
      role: 'Repair',
      description: 'Repairs machinery.',
      icon: 'ph-thin ph-bug-beetle',
      cli: 'claude',
      model: 'Default',
      runMode: 'headless',
      subAgents: [],
    }

    const payload = personasToAssignments([oscar, bob, deb], {
      deb: { cli: 'claude', model: '', mode: 'visible' },
    })

    expect(payload.oscar.mode).toBe('headless')
    expect(payload.bob.mode).toBe('headless')
    expect(payload.deb.mode).toBe('visible')
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
  it('keeps fixture CLI headless capability aligned with the adapter ids', () => {
    const adapterTruth = { claude: true, codex: true, 'cursor-agent': true } as const
    const clisById = Object.fromEntries(seed.clis.map((cli) => [cli.id, cli.headlessCapable]))

    expect(Object.fromEntries(Object.keys(adapterTruth).map((id) => [id, clisById[id]]))).toEqual(adapterTruth)
    expect(clisById['claude-code']).toBeUndefined()
    expect(seed.clis.filter((cli) => !(cli.id in adapterTruth) && cli.headlessCapable)).toEqual([])
  })

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
      headlessCapable: true,
      modelsDetail: 'listed models',
      errorDetail: null,
    })
    expect(cli.models).toEqual(['Default', 'opus', 'sonnet'])
    expect(cli.runReadiness).toEqual({ mechanism: 'env', flags: ['--model'], managesUserConfig: false, detail: 'ready' })
  })

  it('maps declared model tiers when the daemon reports them and omits tiers when absent', () => {
    expect(adaptCli(cliView({ models: { tiers: { bursted: 'opus', economy_lane: 'sonnet' } } })).tiers).toEqual({
      bursted: 'opus',
      economy_lane: 'sonnet',
    })
    expect(adaptCli(cliView()).tiers).toBeUndefined()
  })

  it('preserves headless capability from the daemon CLI view', () => {
    expect(adaptCli(cliView({ id: 'cursor-agent', headlessCapable: true })).headlessCapable).toBe(true)
    expect(adaptCli(cliView({ id: 'claude', headlessCapable: true })).headlessCapable).toBe(true)
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
