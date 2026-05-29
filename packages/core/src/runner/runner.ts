// The thin runner (ADR-0004 "runner · launch composition"). Composes the Phase-1 spine:
// load → preflight → spawn Oscar → await delegation → spawn Bob → await builder-done →
// Oscar verify-gate (ADR-0011) → commit-gate → run record.
// The verify-gate is the load-bearing one: the commit runs ONLY on Oscar's `pass`, because the
// orchestrator is the quality gate and there is no human backstop.
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
import { spawnObserver } from './observer.js'
import { buildBuilderStandbyPrompt, buildBuilderDispatch, buildOrchestratorPrompt, buildVerifyDispatch, commitMessage } from './prompts.js'
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
  readonly deb?: ResolvedPersona
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

export class MissingObjectiveError extends Error {
  constructor(priorityId: string) {
    super(`priority "${priorityId}" has no Objective — refusing to launch`)
    this.name = 'MissingObjectiveError'
  }
}

export class VerificationFailedError extends Error {
  constructor(reason: string | null) {
    super(`orchestrator rejected the builder's work: ${reason ?? 'no reason given'}`)
    this.name = 'VerificationFailedError'
  }
}

// Interactive sessions are human-steered (the founder reads/answers the agent in its pane), so the
// artifact may take many minutes — these are generous BACKSTOPS, not tight headless budgets. A dead
// pane is caught immediately by the isAlive fast-fail, so the only thing a timeout guards against is
// a run abandoned with a still-alive pane. Default 4h, matching CoBuilder's watcher.
const DEFAULTS = { orchestrationMs: 14_400_000, buildMs: 14_400_000, pollMs: 1500 }

export async function runRun(deps: RunnerDeps, input: RunInput): Promise<RunResult> {
  if (input.priority.objective === null) throw new MissingObjectiveError(input.priority.id)

  const { store, sessionHost, git, getAdapter, io } = deps
  const t = { ...DEFAULTS, ...deps.timeouts }
  const log = deps.log ?? (() => {})
  const { workspace, priority, oscar, bob, deb, sharedStandards, runsRoot } = input

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

  const delegationPath = join(runDir, 'delegation.json')
  const builderDonePath = join(runDir, 'builder-done.json')
  const verifyPath = join(runDir, 'verify.json')
  const scope = effectiveScope(bob.writeScope, priority.scopeNarrowing) // known at launch (no delegation needed)

  // 1) Spawn the load-bearing personas up front (v1-style concurrent spawn): Oscar with its full
  //    prompt, Bob on standby in a split pane beside it. Bob's CLI cold-start overlaps Oscar's work,
  //    and the founder sees the run staffed immediately. Optional observers join best-effort below.
  const oscarCmd = getAdapter(oscar.cli).build({
    prompt: buildOrchestratorPrompt({
      sharedStandards,
      oscarBody: oscar.body,
      priorityTitle: priority.title,
      priorityGoal: priority.goal,
      delegationPath,
      verifyPath,
      builderLabel: bob.label,
      builderCli: bob.cli,
      runId: run.id,
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
    group: run.id,
    label: oscar.label,
  })
  store.createSession({ runId: run.id, persona: oscar.id, sessionRef: oscarRef.id })
  store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: oscar.id, ref: oscarRef.id } })

  const bobCmd = getAdapter(bob.cli).build({
    prompt: buildBuilderStandbyPrompt({ sharedStandards, bobBody: bob.body, scope, delegationPath, donePath: builderDonePath }),
    model: bob.model,
    cwd: workspace.path,
    outPath: join(runDir, 'bob.out'),
  })
  const bobRef = await sessionHost.spawn({
    persona: bob.id,
    command: bobCmd.command,
    args: bobCmd.args,
    cwd: workspace.path,
    group: run.id, // same workspace as Oscar → splits in beside it (warm, on standby)
    label: bob.label,
  })
  store.createSession({ runId: run.id, persona: bob.id, sessionRef: bobRef.id })
  store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: bob.id, ref: bobRef.id } })
  const debRef = deb
    ? await spawnObserver({ store, sessionHost, getAdapter, run, workspace, priority, deb, sharedStandards, runDir })
    : null
  await sessionHost.show(oscarRef) // focus Oscar — it's the one working first
  log(`oscar + bob spawned (${oscarRef.id}, ${bobRef.id}); awaiting delegation, bob on standby`)

  // 2) Await Oscar's delegation. Fail fast if its session dies (cmux died); on failure, tear down
  //    the idle standby Bob so it isn't left orphaned.
  let delegation
  try {
    delegation = await io.awaitDelegation(delegationPath, {
      timeoutMs: t.orchestrationMs,
      pollMs: t.pollMs,
      isAlive: async () => (await sessionHost.status(oscarRef)).state === 'running',
    })
  } catch (err) {
    await sessionHost.kill(bobRef).catch(() => {})
    if (debRef) await sessionHost.kill(debRef).catch(() => {})
    store.recordEvent({ runId: run.id, type: 'delegation-timeout', data: { message: String(err) } })
    store.setRunStatus(run.id, 'failed')
    throw err
  }

  const workItem = store.createWorkItem({
    runId: run.id,
    sourcePersona: oscar.id,
    targetPersona: bob.id,
    task: delegation.task,
    writeScope: scope,
  })
  store.recordEvent({ runId: run.id, type: 'delegation', data: { workItemId: workItem.id, task: delegation.task } })
  log(`delegation received → work item ${workItem.id}; dispatching to bob`)

  // 3) Dispatch the task into Bob's warm standby pane (v1 send-keys model), then watch for done.
  await sessionHost.show(bobRef)
  await sessionHost.sendInput(bobRef, buildBuilderDispatch(delegationPath))
  store.recordEvent({ runId: run.id, type: 'builder-dispatch', data: { ref: bobRef.id } })

  try {
    const done = await io.awaitBuilderDone(builderDonePath, {
      timeoutMs: t.buildMs,
      pollMs: t.pollMs,
      isAlive: async () => (await sessionHost.status(bobRef)).state === 'running',
    })
    store.recordEvent({ runId: run.id, type: 'builder-done', data: { summary: done.summary } })
  } catch (err) {
    store.recordEvent({ runId: run.id, type: 'builder-failed', data: { message: String(err) } })
    store.setRunStatus(run.id, 'failed')
    throw err
  }
  store.setWorkItemStatus(workItem.id, 'done')
  log('bob signalled done; dispatching to oscar for verification')

  // 4) Oscar verification gate (ADR-0011): the orchestrator is the quality gate — there is no human
  //    backstop. Dispatch the verify request into Oscar's still-alive pane and block on its verdict.
  //    The commit-gate runs ONLY on `pass`; a `fail` aborts with nothing committed.
  await sessionHost.show(oscarRef)
  await sessionHost.sendInput(oscarRef, buildVerifyDispatch(delegationPath, verifyPath))
  store.recordEvent({ runId: run.id, type: 'verify-dispatch', data: { ref: oscarRef.id } })
  let verdict
  try {
    verdict = await io.awaitVerification(verifyPath, {
      timeoutMs: t.orchestrationMs,
      pollMs: t.pollMs,
      isAlive: async () => (await sessionHost.status(oscarRef)).state === 'running',
    })
  } catch (err) {
    store.recordEvent({ runId: run.id, type: 'verify-failed', data: { message: String(err) } })
    store.setRunStatus(run.id, 'failed')
    throw err
  }
  if (verdict.verdict === 'fail') {
    store.recordEvent({ runId: run.id, type: 'verify-rejected', data: { reason: verdict.reason } })
    store.setRunStatus(run.id, 'failed')
    throw new VerificationFailedError(verdict.reason)
  }
  store.recordEvent({ runId: run.id, type: 'verify-pass', data: { reason: verdict.reason } })
  log('oscar verified the diff; running commit-gate')

  // 5) Commit-gate (ADR-0007): commit in-scope, surface out-of-scope, record commit_link.
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

  // 6) Finalize + write the run record (write-once projection).
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
