// The thin runner (ADR-0004 "runner · launch composition"). Composes the Phase-1 spine:
// load → preflight → spawn Oscar → await delegation → spawn Bob → commit-gate → run record.
// All collaborators are injected (SessionHost, Git, RunStore, adapters, IO) so the
// orchestration is unit-testable without real cmux/CLIs.
import type { Adapter } from '../adapter/index.js'
import { runCommitGate } from '../commit-gate/index.js'
import type { Git } from '../commit-gate/index.js'
import type { Priority } from '../priorities/index.js'
import type { ResolvedPersona } from '../personas/index.js'
import type { Run, RunStatus, RunStore, Workspace } from '../store/index.js'
import { effectiveScope } from '../write-scope/index.js'
import type { SessionHost } from '../session-host/index.js'
import { join } from 'node:path'
import type { RunnerIO } from './io.js'
import { buildBuilderPrompt, buildOrchestratorPrompt, commitMessage } from './prompts.js'
import { renderRunRecord } from './record.js'

export interface RunnerDeps {
  readonly store: RunStore
  readonly sessionHost: SessionHost
  readonly git: Git
  readonly getAdapter: (cli: string) => Adapter
  readonly io: RunnerIO
  readonly timeouts?: { orchestrationMs?: number; buildMs?: number; pollMs?: number }
  readonly log?: (msg: string) => void
  /** Fired synchronously the instant the run row is created (before any await), so a fire-and-forget
   *  caller (the Oz daemon) learns the runId for its 202 response WITHOUT pre-creating a second row —
   *  runRun stays the single home of the createRun write (ADR-0003 / F6). */
  readonly onRunCreated?: (run: Run) => void
}

export interface RunInput {
  readonly workspace: Workspace
  readonly priority: Priority
  readonly oscar: ResolvedPersona
  readonly bob: ResolvedPersona
  readonly sharedStandards: string
  /** runs root; the run dir is <runsRoot>/<runId>. */
  readonly runsRoot: string
}

export interface RunResult {
  readonly runId: string
  readonly status: RunStatus
  readonly committedSha: string | null
  readonly committedFiles: readonly string[]
  readonly outOfScope: readonly string[]
  readonly selfCommitted: boolean
  readonly recordPath: string
}

export class PreflightError extends Error {
  constructor(persona: string, detail: string) {
    super(`preflight failed for "${persona}": ${detail}`)
    this.name = 'PreflightError'
  }
}

const DEFAULTS = { orchestrationMs: 300_000, buildMs: 900_000, pollMs: 1500 }

export async function runRun(deps: RunnerDeps, input: RunInput): Promise<RunResult> {
  const { store, sessionHost, git, getAdapter, io } = deps
  const t = { ...DEFAULTS, ...deps.timeouts }
  const log = deps.log ?? (() => {})
  const { workspace, priority, oscar, bob, sharedStandards, runsRoot } = input

  store.upsertWorkspace(workspace)
  const run = store.createRun({ workspaceId: workspace.id, priorityId: priority.id })
  deps.onRunCreated?.(run) // synchronous, before the first await — the daemon captures runId here
  const runDir = join(runsRoot, run.id)
  await io.ensureRunDir(runDir)
  store.recordEvent({ runId: run.id, type: 'run-start', data: { priority: priority.id, runDir } })
  log(`run ${run.id} started (priority ${priority.id})`)

  // Preflight both CLIs — fail fast with a clear reason (kills the F10 mid-run class).
  for (const p of [oscar, bob]) {
    const pf = await getAdapter(p.cli).preflight(p.model)
    store.recordEvent({ runId: run.id, type: 'preflight', data: { persona: p.id, cli: p.cli, ok: pf.ok, checks: pf.checks } })
    if (!pf.ok) {
      store.setRunStatus(run.id, 'failed')
      const failed = pf.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ')
      throw new PreflightError(p.id, failed)
    }
  }

  const headBefore = await git.headSha(workspace.path)

  // 1) Spawn Oscar (orchestrator). Read-only; produces delegation.json.
  const delegationPath = join(runDir, 'delegation.json')
  const oscarAdapter = getAdapter(oscar.cli)
  const oscarCmd = oscarAdapter.build({
    prompt: buildOrchestratorPrompt({
      sharedStandards,
      oscarBody: oscar.body,
      priorityTitle: priority.title,
      priorityGoal: priority.goal,
      delegationPath,
      builderLabel: bob.label,
      builderCli: bob.cli,
    }),
    model: oscar.model,
    cwd: workspace.path,
    outPath: join(runDir, 'oscar.out'),
  })
  const oscarRef = await sessionHost.spawn({
    persona: oscar.id,
    command: oscarCmd.command,
    args: oscarCmd.args,
    cwd: workspace.path,
    stdoutPath: oscarCmd.stdoutPath,
    stderrPath: join(runDir, 'oscar.err'),
  })
  const oscarSession = store.createSession({ runId: run.id, persona: oscar.id, sessionRef: oscarRef.id })
  store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: oscar.id, ref: oscarRef.id } })
  await sessionHost.show(oscarRef)
  log(`oscar spawned (${oscarRef.id}); awaiting delegation`)

  // 2) Await Oscar's delegation (timeout → terminal failure, not a hang).
  let delegation
  try {
    delegation = await io.awaitDelegation(delegationPath, { timeoutMs: t.orchestrationMs, pollMs: t.pollMs })
  } catch (err) {
    store.recordEvent({ runId: run.id, type: 'delegation-timeout', data: { message: String(err) } })
    store.setRunStatus(run.id, 'failed')
    throw err
  }
  // Oscar's job is done once it produced the file; let it finish (non-fatal if it lingers).
  try {
    const ex = await sessionHost.waitForExit(oscarRef, { timeoutMs: 60_000 })
    store.setSessionExit(oscarSession.id, ex.code)
  } catch {
    /* Oscar didn't exit promptly; the delegation is in hand, proceed. */
  }

  const scope = effectiveScope(bob.writeScope, priority.scopeNarrowing)
  const workItem = store.createWorkItem({
    runId: run.id,
    sourcePersona: oscar.id,
    targetPersona: bob.id,
    task: delegation.task,
    writeScope: scope,
  })
  store.recordEvent({ runId: run.id, type: 'delegation', data: { workItemId: workItem.id, task: delegation.task } })
  log(`delegation received → work item ${workItem.id}`)

  // 3) Spawn Bob (builder) with the task + injected write-scope.
  const bobAdapter = getAdapter(bob.cli)
  const bobCmd = bobAdapter.build({
    prompt: buildBuilderPrompt({ sharedStandards, bobBody: bob.body, task: delegation.task, scope }),
    model: bob.model,
    cwd: workspace.path,
    outPath: join(runDir, 'bob.out'),
  })
  const bobRef = await sessionHost.spawn({
    persona: bob.id,
    command: bobCmd.command,
    args: bobCmd.args,
    cwd: workspace.path,
    stdoutPath: bobCmd.stdoutPath,
    stderrPath: join(runDir, 'bob.err'),
  })
  const bobSession = store.createSession({ runId: run.id, persona: bob.id, sessionRef: bobRef.id })
  store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: bob.id, ref: bobRef.id } })
  await sessionHost.show(bobRef)
  log(`bob spawned (${bobRef.id}); building`)

  const bobExit = await sessionHost.waitForExit(bobRef, { timeoutMs: t.buildMs })
  store.setSessionExit(bobSession.id, bobExit.code)
  store.setWorkItemStatus(workItem.id, 'done')
  store.recordEvent({ runId: run.id, type: 'builder-exit', data: { code: bobExit.code } })
  log(`bob finished (exit ${bobExit.code}); running commit-gate`)

  // 4) Commit-gate (ADR-0007): commit in-scope, surface out-of-scope, record commit_link.
  const gate = await runCommitGate({
    git,
    store,
    cwd: workspace.path,
    runId: run.id,
    workItemId: workItem.id,
    scope,
    message: commitMessage(priority.id, run.id),
    headBefore,
  })

  // 5) Finalize + write the run record (write-once projection).
  const status: RunStatus = gate.outOfScope.length > 0 ? 'pending-scope-decision' : 'completed'
  store.setRunStatus(run.id, status)
  store.recordEvent({
    runId: run.id,
    type: 'run-end',
    data: { status, committedSha: gate.committedSha, outOfScope: gate.outOfScope, selfCommitted: gate.selfCommitted },
  })
  const recordPath = await io.writeRunRecord(runDir, renderRunRecord(store, run.id, { workspace, priority }))
  log(`run ${run.id} ${status}; record at ${recordPath}`)

  return {
    runId: run.id,
    status,
    committedSha: gate.committedSha,
    committedFiles: gate.committedFiles,
    outOfScope: gate.outOfScope,
    selfCommitted: gate.selfCommitted,
    recordPath,
  }
}
