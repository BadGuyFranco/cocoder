// daemon → view-model adapter. The renderer consumes ONE shape (app/model.ts); the live daemon speaks
// its own (electron/ipc-contract.ts). These pure functions translate the daemon's reality onto the V1
// design's view-model so surfaces don't care which backend filled them. NEVER render raw daemon JSON —
// every field here is humanized. Run ids are OPAQUE (never parsed); timestamps are epoch ms.
//
// Type-only imports from electron/: erased at build, so the renderer bundle stays free of main-process
// code (topology: packages/ui imports only @cocoder/core + node/electron/third-party).
import type {
  Workspace as DWorkspace,
  Priority as DPriority,
  RunSummary,
  RunDetail,
  RunEvent,
  PersonasResponse,
  PersonaAssignment,
  CliView,
} from '../electron/ipc-contract.ts'
import type { Workspace, Priority, Run, RunStatus, Persona, TranscriptLine, EvidenceItem, SubAgent, Cli } from './model.ts'

// The pinned "Ad-hoc" row is a real daemon priority but the design renders it specially (a pinned row
// holding many concurrent runs), so it is pulled OUT of the normal queue and its runs lose their
// priorityId (the Ad-hoc row keys off `!run.priorityId`).
export const ADHOC_PRIORITY_ID = 'adhoc-session'

const shortSha = (s: string | undefined | null): string => (s ? String(s).slice(0, 7) : '')
const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const basename = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p
const humanize = (t: string): string => t.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

// epoch ms → deterministic UTC "YYYY-MM-DD HH:mm" (no locale/now() so it is test-stable and timezone-free).
export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
}

// A priority `goal` is a Markdown Objective block; the design row wants a one-liner. Strip headings/bold
// and collapse whitespace, then take the leading sentence(s) up to ~200 chars.
export function summarize(goal: string | null | undefined): string {
  if (!goal) return ''
  const flat = goal
    .replace(/^#+\s.*$/gm, '') // drop "## Objective" headings
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= 200) return flat
  const cut = flat.slice(0, 200)
  const lastStop = cut.lastIndexOf('. ')
  return `${(lastStop > 80 ? cut.slice(0, lastStop + 1) : cut).trimEnd()}…`
}

// daemon run status → design run status. `pending-scope-decision` IS the design's "blocked / needs a
// decision" (the decision-callout case). `stopped` has no daemon equivalent yet; unknowns degrade to it.
export function mapRunStatus(status: string, integrationStatus?: string | null): RunStatus {
  switch (status) {
    case 'running':
      return 'running'
    case 'completed':
      if (integrationStatus && integrationStatus !== 'merged') return 'not-landed'
      return 'complete'
    case 'pending-scope-decision':
      return 'blocked'
    case 'pending-landing':
      return 'not-landed'
    case 'failed':
      return 'failed'
    default:
      return 'stopped'
  }
}

const isActive = (s: RunStatus): boolean => s === 'running' || s === 'blocked' || s === 'not-landed'

const CLI_META: Record<string, { name: string; vendor: string }> = {
  claude: { name: 'Claude Code', vendor: 'Anthropic' },
  codex: { name: 'Codex', vendor: 'OpenAI' },
  'cursor-agent': { name: 'Cursor-agent', vendor: 'Cursor' },
}

// ── CLIs ── daemon probes/reporting → the renderer's design view-model.
export function adaptCli(view: CliView): Cli {
  const meta = CLI_META[view.id] ?? { name: humanize(view.id), vendor: '—' }
  const status = !view.tested
    ? 'not-installed'
    : !view.install.ok
      ? 'not-installed'
      : !view.auth.ok
        ? 'auth-failed'
        : 'ok'
  return {
    id: view.id,
    name: meta.name,
    vendor: meta.vendor,
    status,
    version: '—',
    lastTested: view.testedAt == null ? 'never' : fmtTime(view.testedAt),
    models: ['Default', ...view.models.models],
    canEnumerate: view.models.canEnumerate,
    modelsDetail: view.models.detail,
    runReadiness: {
      mechanism: view.configManaged.mechanism,
      flags: [...view.configManaged.flags],
      managesUserConfig: view.configManaged.managesUserConfig,
      detail: view.configManaged.detail,
    },
    tested: view.tested,
    errorDetail: !view.tested ? null : !view.install.ok ? view.install.detail : !view.auth.ok ? view.auth.detail : null,
  }
}

export function modelIsStale(cli: Cli | undefined, model: string): boolean {
  return model !== '' && model !== 'Default' && cli !== undefined && cli.canEnumerate && !cli.models.includes(model)
}

// ── Workspaces ── daemon roots carry both rawPath (what the editor must persist) and resolved path.
export function adaptWorkspace(w: DWorkspace): Workspace {
  const roots = w.roots?.length
    ? w.roots.map((root, i) => ({
      id: `${w.id}-root-${i}`,
      name: root.name,
      path: root.rawPath,
      resolvedPath: root.path,
      role: root.role,
      ...(root.description ? { description: root.description } : {}),
    }))
    : w.path
      ? [{ id: `${w.id}-root`, name: basename(w.path), path: w.path, resolvedPath: w.path, role: 'primary' as const }]
      : []
  return {
    id: w.id,
    name: w.name,
    description: '',
    icon: 'ph-thin ph-cube',
    roots,
  }
}

// ── Priorities ── (title→name, goal→summary). The Ad-hoc priority is excluded (rendered as its own row).
export function adaptPriority(p: DPriority): Priority {
  return {
    id: p.id,
    name: p.title,
    summary: summarize(p.goal),
    status: 'ready',
    labels: p.scopeNarrowing ? ['scope-narrowed'] : [],
  }
}

// Join the priorities queue with its runs: a priority with a live (running/blocked) run links to it and
// adopts its status ("a run IS a priority being executed"). Newest active run wins. Ad-hoc is dropped.
export function adaptPriorities(priorities: readonly DPriority[], runs: readonly Run[]): Priority[] {
  return priorities
    .filter((p) => p.id !== ADHOC_PRIORITY_ID)
    .map((p) => {
      const base = adaptPriority(p)
      const live = runs.find((r) => r.priorityId === p.id && isActive(r.status))
      if (live) return { ...base, runId: live.id, status: live.status }
      return base
    })
}

// Apply a client-owned order overlay to the daemon's priority list (the drag-reorder seam): known ids
// sort by their saved index; ids not in the overlay (new priorities) keep their daemon order, appended.
// Pure + stable so it's deterministic. Swaps to a daemon reorder endpoint later with no renderer change.
export function applyOrder<T extends { id: string }>(items: T[], order: readonly string[]): T[] {
  if (!order || !order.length) return items
  const idx = new Map(order.map((id, i) => [id, i]))
  const rank = (id: string): number => (idx.has(id) ? (idx.get(id) as number) : Number.MAX_SAFE_INTEGER)
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.id) - rank(b.item.id) || a.i - b.i)
    .map((x) => x.item)
}

// last-event one-liner for a run we only know as a summary (no events fetched yet).
function summaryLastEvent(status: RunStatus): string | undefined {
  switch (status) {
    case 'running':
      return 'Running…'
    case 'blocked':
      return 'Paused — needs a scope decision'
    case 'not-landed':
      return 'Verified but not landed in the main checkout'
    case 'failed':
      return 'Run failed'
    default:
      return undefined
  }
}

// ── Runs (list) ── only id/status/priority/timestamps are known here; personas/transcript come from detail.
export function adaptRunSummary(r: RunSummary, priorityNames: Record<string, string>): Run {
  const status = mapRunStatus(r.status, r.integrationStatus)
  const adhoc = r.priorityId === ADHOC_PRIORITY_ID
  return {
    id: r.id,
    title: priorityNames[r.priorityId] ?? r.priorityId,
    status,
    priorityId: adhoc ? null : r.priorityId,
    personas: [],
    cli: '',
    startedAt: fmtTime(r.createdAt),
    progress: null,
    lastEvent: summaryLastEvent(status),
  }
}

export function adaptRuns(runs: readonly RunSummary[], priorityNames: Record<string, string>): Run[] {
  return runs.map((r) => adaptRunSummary(r, priorityNames))
}

// ── Transcript ── every event → a humanized line (never raw JSON). role = the persona if the event has
// one, else "system"; attention events carry flag:'decision' (used by callout styling).
const DECISION_EVENTS = new Set(['out-of-scope', 'run-error', 'verify-fail', 'wrapup-stale-abort', 'daemon-stale', 'integration-escalated', 'integration-failed'])

export function eventToLine(e: RunEvent): TranscriptLine {
  const d = (e.data ?? {}) as Record<string, unknown>
  const str = (k: string): string => (typeof d[k] === 'string' ? (d[k] as string) : '')
  const arr = (k: string): string[] => (Array.isArray(d[k]) ? (d[k] as unknown[]).map(String) : [])
  let body: string
  switch (e.type) {
    case 'run-start':
      body = `Run started — priority "${str('priority')}".`
      break
    case 'daemon-stale':
      body = `⚠️ Daemon was stale at launch (boot ${shortSha(str('bootSha'))} vs head ${shortSha(str('headSha'))}).`
      break
    case 'preflight':
      body = `Preflight ${str('persona')} via ${str('cli')}: ${d.ok ? 'passed' : 'FAILED'}.`
      break
    case 'spawn':
      body = `Spawned ${str('persona')} in ${str('ref')}.`
      break
    case 'delegation':
      body = str('task') ? `Delegated: ${trunc(str('task'), 140)}` : 'Delegated a work item.'
      break
    case 'builder-dispatch':
      body = 'Builder dispatched.'
      break
    case 'monitor-assessment':
      body = str('assessment') ? `Monitor: ${trunc(str('assessment'), 140)}` : 'Monitor assessed progress.'
      break
    case 'builder-done':
      body = 'Builder reported done.'
      break
    case 'verify-dispatch':
      body = 'Verification dispatched.'
      break
    case 'verify-pass':
      body = 'Verification passed.'
      break
    case 'verify-fail':
      body = `Verification FAILED${str('reason') ? ` — ${trunc(str('reason'), 140)}` : ''}.`
      break
    case 'commit':
      body = `Committed ${shortSha(str('sha'))}${str('message') ? ` — ${trunc(str('message'), 100)}` : ''}.`.replace(' .', '.')
      break
    case 'out-of-scope':
      body = `Out-of-scope changes flagged: ${arr('files').join(', ')}.`
      break
    case 'wrapup':
      body = `Wrap-up over ${Number(d.atoms ?? 0)} atom(s)${d.forced ? ' (forced)' : ''}.`
      break
    case 'wrapup-stale-abort':
      body = '⚠️ Wrap-up aborted — daemon stale; no closeout produced.'
      break
    case 'run-end':
      body = `Run ended — status ${str('status')}${str('integrationStatus') ? `; integration ${str('integrationStatus')}` : ''}.`
      break
    case 'integrated':
      body = `Integrated onto trunk — ${shortSha(str('mergeSha'))}.`
      break
    case 'integration-escalated':
      body = `⚠️ Not landed${str('reason') ? ` — ${trunc(str('reason'), 180)}` : ''}.`
      break
    case 'integration-failed':
      body = `⚠️ Integration failed${str('reason') ? ` — ${trunc(str('reason'), 180)}` : ''}.`
      break
    case 'run-error':
      body = `Run error — ${trunc(str('message'), 200)}`
      break
    case 'teardown':
      body = `Torn down — closed ${arr('closed').join(', ')}.`
      break
    default:
      body = humanize(e.type)
  }
  const role = str('persona') || str('targetPersona') || 'system'
  const line: TranscriptLine = { role, body }
  if (DECISION_EVENTS.has(e.type)) line.flag = 'decision'
  return line
}

function diffStat(diff: string): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) add++
    else if (l.startsWith('-') && !l.startsWith('---')) del++
  }
  return { add, del }
}

// ── Evidence ── commits + diffs + the run record/pickup, as human cards (kinds: diff/pr/error/note).
export function evidenceFromDetail(detail: RunDetail): EvidenceItem[] {
  const items: EvidenceItem[] = []
  const stats: Record<string, { add: number; del: number }> = {}
  for (const df of detail.diffs ?? []) stats[df.sha] = diffStat(df.diff)
  const committed = new Set<string>()

  for (const c of detail.commitLinks ?? []) {
    committed.add(c.commitSha)
    const s = stats[c.commitSha]
    items.push({
      kind: 'diff',
      label: `${shortSha(c.commitSha)} · ${trunc(c.message, 80)}`,
      body: (c.files ?? []).join(', ') || undefined,
      lines: s ? `+${s.add} −${s.del}` : `${(c.files ?? []).length} file(s)`,
    })
  }
  // diffs without a commit link (e.g. out-of-scope, uncommitted)
  for (const df of detail.diffs ?? []) {
    if (committed.has(df.sha)) continue
    const s = stats[df.sha]
    items.push({ kind: 'diff', label: `${shortSha(df.sha)} (uncommitted)`, lines: `+${s.add} −${s.del}` })
  }
  // a run-error event surfaces as an error card
  const err = (detail.events ?? []).find((e) => e.type === 'run-error')
  if (err) items.push({ kind: 'error', label: 'Run error', body: trunc(String((err.data as Record<string, unknown>)?.message ?? ''), 400) })

  if (detail.files?.record) items.push({ kind: 'note', label: 'Run record', body: trunc(detail.files.record, 700) })
  if (detail.files?.pickup) items.push({ kind: 'note', label: 'Pickup brief', body: trunc(detail.files.pickup, 700) })
  return items
}

// ── Run detail → an enriched Run (personas + cli + transcript + evidence + attach) ──
export function adaptRunDetail(detail: RunDetail, priorityNames: Record<string, string>): Run {
  const base = adaptRunSummary(detail.run, priorityNames)
  const sessions = detail.sessions ?? []
  const events = detail.events ?? []
  const personas = [...new Set(sessions.map((s) => s.persona))]
  const clis = [...new Set(events.filter((e) => e.type === 'preflight').map((e) => String((e.data as Record<string, unknown>)?.cli ?? '')).filter(Boolean))]
  const transcript = events.map(eventToLine)
  const last = events.length ? eventToLine(events[events.length - 1]) : null
  const linkable = sessions.find((s) => s.deepLinkable)
  return {
    ...base,
    personas,
    cli: clis.join(' · '),
    transcript,
    evidence: evidenceFromDetail(detail),
    lastEvent: last ? last.body : base.lastEvent,
    attachCmd: linkable ? `cmux show ${linkable.sessionRef}` : undefined,
  }
}

// ── Personas ── prefer the real personas[] roster; fall back to the assignments map. Oz is rendered
// separately by the screen. cli/model come from the assignment when present, else the roster default.
const PERSONA_ICONS: Record<string, string> = {
  oscar: 'ph-thin ph-strategy',
  bob: 'ph-thin ph-hammer',
  deb: 'ph-thin ph-bug-beetle',
  talia: 'ph-thin ph-test-tube',
  quinn: 'ph-thin ph-magnifying-glass',
  doc: 'ph-thin ph-book-open',
}

// A roster `role` is "Short title — long description"; split it so the card shows a crisp role.
function splitRole(role: string): { role: string; description: string } {
  const i = role.indexOf('—')
  if (i === -1) return { role, description: role }
  return { role: role.slice(0, i).trim(), description: role.slice(i + 1).trim() }
}

export function adaptPersonas(resp: PersonasResponse): Persona[] {
  const assignments = resp.assignments ?? {}
  const roster = resp.personas ?? []
  // If the roster is empty (older daemon), synthesize from the assignment keys.
  const ids = roster.length ? roster.map((p) => p.id) : Object.keys(assignments)
  return ids.map((id) => {
    const meta = roster.find((p) => p.id === id)
    const a = assignments[id] ?? { cli: '', model: '' }
    const { role, description } = splitRole(meta?.role ?? id)
    const subAgents: SubAgent[] = Object.entries(a.plays ?? {}).map(([playId, play]) => ({
      id: playId,
      name: playId,
      cli: play.cli,
      model: play.model || 'Default',
    }))
    return {
      id,
      name: meta?.label ?? humanize(id),
      role,
      description,
      icon: PERSONA_ICONS[id] ?? 'ph-thin ph-user',
      cli: a.cli || '',
      model: a.model || 'Default',
      runMode: a.enabled === false ? 'headless' : 'visible',
      subAgents,
    }
  })
}

const assignmentModel = (model: string): string => (model === 'Default' ? '' : model)

export function personasToAssignments(personas: readonly Persona[], base: Record<string, PersonaAssignment> = {}): Record<string, PersonaAssignment> {
  const out: Record<string, PersonaAssignment> = { ...base }
  for (const persona of personas) {
    const prev = base[persona.id]
    const { plays: _oldPlays, ...rest } = prev ?? {}
    const plays = Object.fromEntries(
      persona.subAgents.map((sa) => [sa.id, { cli: sa.cli, model: assignmentModel(sa.model) }]),
    )
    const core = {
      ...rest,
      cli: persona.cli,
      model: assignmentModel(persona.model),
    }
    out[persona.id] = Object.keys(plays).length ? { ...core, plays } : core
  }
  return out
}
