// Run-record projection (ADR-0003): a human-readable receipt GENERATED from the DB rows.
// Write-once, never read back as truth — a rendering, not a source.
import type { Priority } from '../priorities/index.js'
import { isFullyLanded, type RunStore, type Workspace } from '../store/index.js'

const ts = (ms: number | null): string => (ms === null ? '—' : new Date(ms).toISOString())

export function renderRunRecord(
  store: RunStore,
  runId: string,
  meta: { workspace: Workspace; priority: Priority },
): string {
  const run = store.getRun(runId)
  if (!run) throw new Error(`renderRunRecord: run ${runId} not found`)
  const sessions = store.listSessions(runId)
  const workItems = store.listWorkItems(runId)
  const commits = store.listCommitLinks(runId)
  const events = store.listEvents(runId)

  const lines: string[] = []
  lines.push(`# Run ${run.id}`, '')
  lines.push(`- **Workspace:** ${meta.workspace.name} (\`${meta.workspace.id}\`) — ${meta.workspace.path}`)
  lines.push(`- **Priority:** ${meta.priority.title} (\`${run.priorityId}\`)`)
  lines.push(`- **Status:** ${run.status}`)
  lines.push(`- **Integration:** ${run.integrationStatus}`)
  lines.push(`- **Landed on main checkout/trunk:** ${isFullyLanded(run) ? 'yes' : 'no'}`)
  if (!isFullyLanded(run)) {
    lines.push(`- **Disposition:** work remains on run branch \`${run.runBranch ?? 'n/a'}\` in \`${run.worktreePath ?? 'n/a'}\``)
  }
  lines.push(`- **Started:** ${ts(run.createdAt)}  ·  **Ended:** ${ts(run.endedAt)}`, '')

  lines.push('## Sessions', '')
  for (const s of sessions) {
    lines.push(`- **${s.persona}** — \`${s.sessionRef}\` — exit ${s.exitCode ?? 'n/a'}`)
  }
  if (sessions.length === 0) lines.push('- (none)')
  lines.push('')

  lines.push('## Work items', '')
  for (const w of workItems) {
    lines.push(`- **${w.sourcePersona} → ${w.targetPersona}** [${w.status}] — scope: ${w.writeScope.join(', ') || '(read-only)'}`)
    lines.push(`  - Task: ${w.task}`)
  }
  if (workItems.length === 0) lines.push('- (none)')
  lines.push('')

  lines.push('## Commits', '')
  for (const c of commits) {
    lines.push(`- \`${c.commitSha}\` — ${c.message}`)
    for (const f of c.files) lines.push(`  - ${f}`)
  }
  if (commits.length === 0) lines.push('- (none committed)')
  lines.push('')

  const outOfScope = events.filter((e) => e.type === 'out-of-scope')
  if (outOfScope.length > 0) {
    lines.push('## Out-of-scope (held back — expand or discard)', '')
    for (const e of outOfScope) {
      const files = (e.data as { files?: string[] })?.files ?? []
      for (const f of files) lines.push(`- ${f}`)
    }
    lines.push('')
  }

  lines.push('## Event log', '')
  for (const e of events) lines.push(`- ${ts(e.at)} \`${e.type}\``)
  lines.push('')

  return lines.join('\n')
}
