// Deb's triage verdict (ADR-0013 tier 2, expanded by ADR-0016). When the runner hits a fault it
// dispatches Deb to triage it; Deb reads the fault context (+ the live deb-status feed) and writes ONE
// verdict here. Same shape of contract as the directive / verify artifacts: Deb (the agent) READS +
// emits a judgment; the runner — the single DB writer (ADR-0003) — records it and routes the
// disposition. Deb never writes the store.
//
// ADR-0016 adds REPAIR MODE: for a `cocoder-bug`, Deb may either PROPOSE a fix (a diff for founder
// review — the default, and the only option in a non-CoCoder workspace) or REPAIR directly (edit files
// within her write-scope; the runner gate-commits her declared repair files, ADR-0007). A repair never
// rescues the run and never widens scope — product code is outside repair authority and surfaced.
import { COCODER_GOVERNANCE_AUTHOR, commitFiles, recordSuccessfulCommit, runCommitGate } from '../commit-gate/index.js'
import type { AuditWriteBoundary, CommitGateResult, Git } from '../commit-gate/index.js'
import type { ResolvedPersona } from '../personas/index.js'
import type { Run, RunStore, Workspace } from '../store/index.js'
import { createTicket } from '../tickets/index.js'
import { partitionByScope } from '../write-scope/index.js'
import type { SessionHost, SessionRef } from '../session-host/index.js'
import { join } from 'node:path'
import type { RunnerIO } from './io.js'
import type { RunnerPhase } from './status.js'
import { buildDebTriageDispatch } from './prompts.js'
import { faultFingerprint } from './fingerprint.js'
import { isStopRequestedError } from './stop.js'

export type Disposition =
  | 'cocoder-bug' // the CoCoder machinery misbehaved → propose a fix, or (repair mode) apply a scoped one
  | 'repo-bug' // the target repo's persona/tools/Plays → ask the founder
  | 'one-off' // isolated / unlikely to repeat → just log it

/** How Deb handles a `cocoder-bug`. `propose` (default) = a diff for founder review, nothing applied.
 *  `repair` = Deb has edited files within her write-scope in the worktree; the runner gate-commits them. */
export type TriageMode = 'propose' | 'repair'

export interface Triage {
  readonly disposition: Disposition
  /** One line: what the fault was and why this disposition (plain English; founder-facing). */
  readonly summary: string
  /** For 'cocoder-bug': the proposed fix as a unified diff / description (NOT applied — reviewed). */
  readonly proposal?: string
  /** 'propose' (default) or 'repair' — only meaningful for 'cocoder-bug' (ADR-0016). */
  readonly mode: TriageMode
  /** Repair-mode evidence (ADR-0016 §3). Present when Deb applied a scoped repair. */
  readonly diagnosis?: string
  readonly whyCocoderOwned?: string
  readonly filesChanged?: readonly string[]
  readonly verification?: string
  readonly remainingRisk?: string
  /** How Deb escalated a RECURRING fault (ADR-0016 §recurrence): `repair` (fixed it), `ticket` (filed a
   *  tracked follow-up on an existing priority), or `recommend-priority` (the ticket asks the founder to
   *  approve a new priority). Absent for a first occurrence / no escalation. */
  readonly escalation?: 'repair' | 'ticket' | 'recommend-priority'
  /** Optional ticket id Deb proposed; the governed create spine may allocate a different id when absent. */
  readonly ticketId?: string
  /** Ticket metadata Deb returns; the runner files the ticket through the governed create spine. */
  readonly ticketTitle?: string
  readonly ticketType?: string
  readonly ticketPriority?: string
  readonly ticketBody?: string
}

const DISPOSITIONS: readonly Disposition[] = ['cocoder-bug', 'repo-bug', 'one-off']

const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
const asStringList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined

/** Validate a triage.json payload. Throws (treated as "not ready yet" while polling). Back-compat:
 *  a verdict without `mode` parses as 'propose'. `repair` is honoured only for a `cocoder-bug` (any
 *  other disposition falls back to 'propose' — repair is meaningless for repo-bug/one-off). */
export function parseTriage(json: string): Triage {
  const d = JSON.parse(json) as Record<string, unknown>
  if (!DISPOSITIONS.includes(d.disposition as Disposition)) {
    throw new Error(`triage: "disposition" must be one of ${DISPOSITIONS.join(' | ')}`)
  }
  if (typeof d.summary !== 'string' || d.summary.trim() === '') {
    throw new Error('triage: "summary" must be a non-empty string')
  }
  const disposition = d.disposition as Disposition
  const mode: TriageMode = d.mode === 'repair' && disposition === 'cocoder-bug' ? 'repair' : 'propose'
  const escalation =
    d.escalation === 'repair' || d.escalation === 'ticket' || d.escalation === 'recommend-priority' ? d.escalation : undefined
  return {
    disposition,
    summary: d.summary,
    proposal: asString(d.proposal),
    mode,
    diagnosis: asString(d.diagnosis),
    whyCocoderOwned: asString(d.whyCocoderOwned),
    filesChanged: asStringList(d.filesChanged),
    verification: asString(d.verification),
    remainingRisk: asString(d.remainingRisk),
    escalation,
    ticketId: asString(d.ticketId),
    ticketTitle: asString(d.ticketTitle),
    ticketType: asString(d.ticketType),
    ticketPriority: asString(d.ticketPriority),
    ticketBody: asString(d.ticketBody),
  }
}

function today(now: () => number): string {
  return new Date(now()).toISOString().slice(0, 10)
}

function ticketBody(verdict: Triage): string {
  if (verdict.ticketBody) return verdict.ticketBody
  return [
    '## Context',
    '',
    verdict.diagnosis ?? verdict.summary,
    '',
    ...(verdict.whyCocoderOwned ? ['## Why CoCoder-owned', '', verdict.whyCocoderOwned, ''] : []),
    ...(verdict.remainingRisk ? ['## Remaining Risk', '', verdict.remainingRisk, ''] : []),
  ].join('\n')
}

// ── The fault/triage funnel (extracted from runRun, WS5.2) ───────────────────────────────────────────
// triageFault is the run_231 cascade epicentre: it fingerprints the fault for cross-run recurrence,
// dispatches Deb to triage it, awaits her one verdict, and — for a scoped repair/escalation — gate-commits
// ONLY her in-scope edits through the WS3 commit spine (commitFiles/runCommitGate + recordSuccessfulCommit).
// The quarantine-before-fault + declared-files-only (scope-partition) guards from bca1b27 / WS3.3 are
// preserved EXACTLY: a non-declared path can never be swept in. All runRun state arrives via an explicit
// deps record; faultSeq survives as a nextFaultSeq() accessor so the monotonic fault counter keeps
// incrementing across calls (a value copy would reset it).
export interface TriageDeps {
  readonly debRef: SessionRef | null
  readonly deb: ResolvedPersona | undefined
  /** Monotonic fault-sequence accessor (NOT a value copy): returns the current index, then increments. */
  readonly nextFaultSeq: () => number
  readonly refreshStatus: (phase: RunnerPhase, activeAtom: number | null, activeTask: string | null, waitCondition: string) => Promise<void>
  readonly store: RunStore
  readonly workspace: Workspace
  readonly run: Run
  readonly git: Git
  readonly worktreePath: string
  readonly io: RunnerIO
  readonly runDir: string
  readonly sessionHost: SessionHost
  readonly debAlive: () => Promise<boolean>
  readonly auditWriteBoundary: AuditWriteBoundary | undefined
  readonly runReference: string
  readonly runBranch: string
  readonly withPortableRunHistoryScope: (scope: readonly string[]) => readonly string[]
  readonly now: () => number
  readonly timeouts: { readonly orchestrationMs: number; readonly pollMs: number }
  readonly signal: AbortSignal | undefined
}

const renderDisposition = (faultType: string, atomIndex: number | null, v: Triage, gate: CommitGateResult | null, occurrence: number, runBranch: string): string => {
  const where = atomIndex !== null ? ` (atom ${atomIndex})` : ''
  const lines = [`# Deb disposition: ${v.disposition}`, '']
  const ticketId = v.ticketId
  if (occurrence >= 2) lines.push(`> ⚠️ **RECURRENCE (#${occurrence})** — this fault matched ${occurrence - 1} prior run(s) by fingerprint; it is no longer a one-off.`, '')
  lines.push(`- **Fault:** ${faultType}${where}`, `- **Mode:** ${v.mode}`, `- **Summary:** ${v.summary}`, '')
  const isTicket = v.escalation === 'ticket' || v.escalation === 'recommend-priority'
  if (isTicket) {
    lines.push(v.escalation === 'recommend-priority' ? '## Escalation — recommends a NEW priority (needs your approval)' : '## Escalation — tracked follow-up ticket filed', '')
    if (ticketId) lines.push(`- **Ticket:** ${ticketId} (\`cocoder/tickets/\`)`)
    if (v.diagnosis) lines.push(`- **Diagnosis:** ${v.diagnosis}`)
    if (v.whyCocoderOwned) lines.push(`- **Why CoCoder-owned:** ${v.whyCocoderOwned}`)
    lines.push('')
  } else if (v.disposition === 'cocoder-bug' && v.mode === 'repair') {
    lines.push('## Scoped repair — APPLIED within Deb\'s write-scope', '')
    if (v.diagnosis) lines.push(`- **Diagnosis:** ${v.diagnosis}`)
    if (v.whyCocoderOwned) lines.push(`- **Why CoCoder-owned:** ${v.whyCocoderOwned}`)
    if (v.filesChanged && v.filesChanged.length) lines.push(`- **Files Deb changed:** ${v.filesChanged.join(', ')}`)
    if (v.verification) lines.push(`- **Verification:** ${v.verification}`)
    if (v.remainingRisk) lines.push(`- **Remaining risk:** ${v.remainingRisk}`)
    lines.push('')
  } else if (v.disposition === 'cocoder-bug') {
    lines.push('## Proposed fix — NOT applied; for founder review', '', '```diff', v.proposal ?? '(no diff provided)', '```', '')
  }
  if (gate) {
    if (gate.committedSha) lines.push(`Committed as \`${gate.committedSha}\` (files: ${gate.committedFiles.join(', ') || 'none'}) on branch \`${runBranch}\`. The run still fails — land it from that branch to bring the ${isTicket ? 'ticket' : 'repair'} to trunk.`, '')
    else lines.push('No in-scope changes were committed (nothing within Deb\'s write-scope changed).', '')
    if (gate.outOfLane.length > 0) lines.push(`**Outside Deb's repair lane:** ${gate.outOfLane.join(', ')}`, '')
  }
  if (v.disposition === 'repo-bug') lines.push('## For the founder', '', v.summary, '')
  return lines.join('\n')
}

export const triageFault = async (deps: TriageDeps, faultType: string, atomIndex: number | null, message: string): Promise<void> => {
  if (!deps.debRef) return // no Deb on this run → no triage
  const i = deps.nextFaultSeq()
  await deps.refreshStatus('faulted', atomIndex, null, `fault: ${faultType}`)
  try {
    // Cross-run recurrence (ADR-0016 §recurrence): fingerprint this fault + count prior matches across
    // the workspace's runs (the durable memory in the DB). occurrence>=2 → tell Deb to escalate instead
    // of logging another one-off; it is the same fault recurring, not a fresh surprise.
    const fingerprint = faultFingerprint(faultType, message)
    const priorRuns = deps.store.listFaultHistory(deps.workspace.id).filter((f) => f.fingerprint === fingerprint).map((f) => f.runId)
    const occurrence = priorRuns.length + 1
    if (occurrence >= 2) deps.store.recordEvent({ runId: deps.run.id, type: 'fault-recurrence', data: { fault: faultType, fingerprint, occurrence, priorRuns } })

    // Snapshot the worktree HEAD before Deb may edit (repair/ticket) so the commit-gate attributes only
    // her changes and detects any self-commit (ADR-0007).
    const headBeforeRepair = await deps.git.headSha(deps.worktreePath)
    await deps.io.writeFaultContext(join(deps.runDir, `fault-${i}.json`), { fault: faultType, atom: atomIndex, message, fingerprint, occurrence, priorRuns })
    await deps.sessionHost.show(deps.debRef)
    await deps.sessionHost.sendInput(deps.debRef, buildDebTriageDispatch(join(deps.runDir, `fault-${i}.json`), join(deps.runDir, `triage-${i}.json`), occurrence))
    deps.store.recordEvent({ runId: deps.run.id, type: 'triage-dispatch', data: { fault: faultType, atom: atomIndex, occurrence } })
    await deps.refreshStatus('faulted', atomIndex, null, `fault: ${faultType}`)
    let verdict = await deps.io.awaitTriage(join(deps.runDir, `triage-${i}.json`), { timeoutMs: deps.timeouts.orchestrationMs, pollMs: deps.timeouts.pollMs, isAlive: deps.debAlive, signal: deps.signal })
    // Record the fingerprint on the triaged event so FUTURE runs match this occurrence (closes the loop).
    deps.store.recordEvent({ runId: deps.run.id, type: 'fault-triaged', data: { fault: faultType, atom: atomIndex, disposition: verdict.disposition, mode: verdict.mode, summary: verdict.summary, fingerprint, occurrence } })
    // REPAIR / ESCALATION (ADR-0016): on a cocoder-bug Deb may have edited files within her write-scope
    // for a scoped repair, or returned metadata for the runner to file a governed ticket. Repair edits
    // remain scope-gated; ticket creation rides the governed ticket spine and commits its exact file list.
    let gate: CommitGateResult | null = null
    const isRepair = verdict.disposition === 'cocoder-bug' && verdict.mode === 'repair'
    const isTicket = verdict.escalation === 'ticket' || verdict.escalation === 'recommend-priority'
    const hasTicketMetadata = verdict.ticketTitle !== undefined || verdict.ticketType !== undefined || verdict.ticketPriority !== undefined || verdict.ticketBody !== undefined
    if (deps.deb && ((isTicket && hasTicketMetadata) || (deps.deb.writeScope.length > 0 && (isRepair || isTicket)))) {
      const kind = isTicket ? 'escalation' : 'repair'
      const message = `deb-${kind}: ${faultType}${atomIndex !== null ? ` (atom ${atomIndex})` : ''} occurrence ${occurrence}${verdict.ticketId ? ` → ticket ${verdict.ticketId}` : ''} via CoCoder run ${deps.runReference}`
      const commitScope = deps.withPortableRunHistoryScope(deps.deb.writeScope)
      if (isTicket && hasTicketMetadata) {
        const create = await createTicket({
          ticketsDir: join(deps.worktreePath, 'cocoder', 'tickets'),
          repoPath: deps.worktreePath,
          title: verdict.ticketTitle ?? verdict.summary,
          type: verdict.ticketType ?? 'bug',
          priority: verdict.ticketPriority ?? 'none',
          description: ticketBody(verdict),
          created: today(deps.now),
          ...(verdict.ticketId ? { ticketId: verdict.ticketId } : {}),
        })
        const createdTicketId = create.created ? create.id : verdict.ticketId
        const createMessage = `deb-${kind}: ${faultType}${atomIndex !== null ? ` (atom ${atomIndex})` : ''} occurrence ${occurrence}${createdTicketId ? ` → ticket ${createdTicketId}` : ''} via CoCoder run ${deps.runReference}`
        const headNow = await deps.git.headSha(deps.worktreePath)
        const selfCommittedRepair = headNow !== headBeforeRepair
        if (create.created) {
          const receipt = await commitFiles(deps.git, deps.worktreePath, create.files, createMessage, COCODER_GOVERNANCE_AUTHOR)
          recordSuccessfulCommit(deps.store, { runId: deps.run.id, workItemId: null, message: createMessage, committedSha: receipt.committedSha, committedFiles: receipt.committedFiles, selfCommit: selfCommittedRepair ? { headBefore: headBeforeRepair, headNow } : null })
          if (receipt.error) deps.store.recordEvent({ runId: deps.run.id, type: 'deb-repair-commit-failed', data: { fault: faultType, error: receipt.error, files: create.files } })
          gate = { ...receipt, outOfLane: [], selfCommitted: selfCommittedRepair }
          verdict = { ...verdict, ticketId: create.id }
        } else {
          gate = { committed: false, committedSha: null, committedFiles: [], outOfLane: [], error: null, selfCommitted: selfCommittedRepair }
          if (createdTicketId) verdict = { ...verdict, ticketId: createdTicketId }
        }
      } else if (verdict.filesChanged && verdict.filesChanged.length > 0) {
        // HEAD/self-commit is detected BEFORE the commit (commitFiles itself moves HEAD); the standard
        // success-path recording (agent-self-commit + commit_link + commit) is then centralized in the
        // helper (WS3.3). selfCommit is CALLER context — a plain commitFiles receipt carries none.
        const headNow = await deps.git.headSha(deps.worktreePath)
        const selfCommittedRepair = headNow !== headBeforeRepair
        const { inScope, outOfScope } = partitionByScope(verdict.filesChanged, commitScope)
        const receipt = await commitFiles(deps.git, deps.worktreePath, inScope, message, COCODER_GOVERNANCE_AUTHOR)
        recordSuccessfulCommit(deps.store, { runId: deps.run.id, workItemId: null, message, committedSha: receipt.committedSha, committedFiles: receipt.committedFiles, selfCommit: selfCommittedRepair ? { headBefore: headBeforeRepair, headNow } : null })
        if (receipt.error) deps.store.recordEvent({ runId: deps.run.id, type: 'deb-repair-commit-failed', data: { fault: faultType, error: receipt.error, files: inScope } })
        if (outOfScope.length > 0) deps.store.recordEvent({ runId: deps.run.id, type: 'deb-repair-out-of-scope-held', data: { files: outOfScope } })
        // The manual deb-repair path and the gate now return the SAME shape (CommitGateResult =
        // CommitReceipt + selfCommitted), so this is no longer a hand-conversion between two shapes:
        // spread the spine receipt, add gate-only selfCommitted, and surface the HELD-BACK out-of-scope
        // files in `outOfLane` (commitFiles partitions nothing, so its receipt.outOfLane is []).
        gate = { ...receipt, outOfLane: outOfScope, selfCommitted: selfCommittedRepair }
      } else {
        gate = await runCommitGate({
          git: deps.git,
          store: deps.store,
          cwd: deps.worktreePath,
          runId: deps.run.id,
          workItemId: null,
          scope: commitScope,
          message,
          headBefore: headBeforeRepair,
          auditWriteBoundary: deps.auditWriteBoundary,
        })
      }
      deps.store.recordEvent({ runId: deps.run.id, type: 'deb-repair', data: { fault: faultType, atom: atomIndex, occurrence, escalation: verdict.escalation ?? null, ticketId: verdict.ticketId ?? null, committedSha: gate.committedSha, files: gate.committedFiles, outOfScope: gate.outOfLane } })
    }
    await deps.io.writeDisposition(deps.runDir, i, renderDisposition(faultType, atomIndex, verdict, gate, occurrence, deps.runBranch))
  } catch (err) {
    if (isStopRequestedError(err)) throw err
    deps.store.recordEvent({ runId: deps.run.id, type: 'triage-skipped', data: { fault: faultType, reason: err instanceof Error ? err.message : String(err) } })
  }
}
