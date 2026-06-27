import './suppress-sqlite-warning.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_OZ_PORT,
  detectRunnerImpact,
  isPersonaEnabled,
  loadAssignments,
  listEffectivePlays,
  loadPriority,
  makeGit,
  makeRunnerIO,
  openRunStore,
  probeDaemon,
  resolveLocalRunDir,
  resolveMandatoryPlay,
  resolveEffectivePersona,
  resolvePlayAssignment,
  runRun,
  type ProbeOptions,
  type ProbeResult,
  type PreRunGovernanceCheck,
  type PersonaSources,
  type RunInput,
  type RunResult,
  type RunnerDeps,
} from '@cocoder/core'
import { getAdapter, makeAdapterRegistry } from '@cocoder/adapters'
import { basePersonasDir, basePlaysDir } from '@cocoder/personas'
import { CmuxSessionHost } from '@cocoder/session-hosts'
import { authoringPlayViaDaemon, closeTicketViaDaemon, confirmTicketCloseViaDaemon, migrateHistoryViaDaemon, requestDebRepairViaDaemon, resumeViaDaemon, runViaDaemon, startOzDaemon, supportCommitViaDaemon, teardownViaDaemon, type DebRepairEvidenceItem } from './client.js'
import { closeTicketViaCli } from './close-ticket.js'
import { createTicketViaCli } from './create-ticket.js'
import { latestModelFor } from './latest-model.js'
import { archivePriorityInvocation, createPriorityInvocation, createTicketInvocation, editPriorityInvocation } from './oz-args.js'
import { resolveRunTarget } from './run-target.js'

const log = (m: string): void => console.error(`[cocoder] ${m}`)
const out = (m: string): void => {
  process.stdout.write(`${m}\n`)
}
const runIndependentUsage = 'usage: cocoder run-independent <priorityId> [--resume <runId>] [--strict-dirt] [--allow-pre-run-integrity-errors] [--force]'
const usage = `usage: cocoder run <priorityId> [--resume <runId>] [--strict-dirt] [--allow-pre-run-integrity-errors]   |   ${runIndependentUsage}   |   cocoder oz start   |   cocoder oz author <playId> [--json <invocation-json>]   |   cocoder oz create-priority --id <id> --title <text> --objective <text> [--details-file <path> | --details-stdin]   |   cocoder oz edit-priority <id> [--objective <text>] [--mode <replace-body|append-section>] [--details-file <path> | --details-stdin]   |   cocoder oz close-ticket <id> [--resolution <text>] [--run <runId>]   |   cocoder oz confirm-ticket-close <runId> [--resolution <text>]   |   cocoder oz create-ticket --title <text> --type <type> --priority <priority> [--description <text> | --details-file <path> | --details-stdin] [--id <id>] [--run <runId>]   |   cocoder oz archive-priority <priorityId> [--workspace <workspaceId>] [--verdict <text>] [--findings <text>] [--reason <text>]   |   cocoder oz migrate-history <workspaceId>   |   cocoder oz request-deb-repair <workspaceId> --problem <text> [--run <runId>] [--evidence <json>]   |   cocoder oz commit-support <runId>   |   cocoder oz resume <runId>   |   cocoder oz teardown <runId> [--initiator <persona>]`
const requestDebRepairUsage = 'usage: cocoder oz request-deb-repair <workspaceId> --problem <text> [--run <runId>] [--evidence <json>]'
const closeTicketUsage = 'usage: cocoder oz close-ticket <id> [--resolution <text>] [--run <runId>]'
const confirmTicketCloseUsage = 'usage: cocoder oz confirm-ticket-close <runId> [--resolution <text>]'
const createTicketUsage = 'usage: cocoder oz create-ticket --title <text> --type <type> --priority <priority> [--description <text> | --details-file <path> | --details-stdin] [--id <id>] [--run <runId>]'
const createPriorityUsage = 'usage: cocoder oz create-priority --id <id> --title <text> --objective <text> [--details-file <path> | --details-stdin]'
const editPriorityUsage = 'usage: cocoder oz edit-priority <id> [--objective <text>] [--mode <replace-body|append-section>] [--details-file <path> | --details-stdin]'
const archivePriorityUsage = 'usage: cocoder oz archive-priority <priorityId> [--workspace <workspaceId>] [--verdict <text>] [--findings <text>] [--reason <text>]'

type ProbeDaemonImpl = (opts?: ProbeOptions) => Promise<ProbeResult>
type RunRunImpl = (deps: RunnerDeps, input: RunInput) => Promise<RunResult>

export interface RunStandaloneOptions {
  readonly requireIndependentOfRunner?: boolean
  readonly forceDaemonLive?: boolean
  readonly probeDaemonImpl?: ProbeDaemonImpl
  readonly runnerDeps?: Partial<Pick<RunnerDeps, 'getAdapter' | 'io' | 'limits' | 'makeJudge' | 'runHeadless' | 'sessionHost' | 'timeouts'>>
  readonly runRunImpl?: RunRunImpl
}

export interface MainOptions {
  readonly probeDaemonImpl?: ProbeDaemonImpl
  readonly runStandaloneOptions?: Pick<RunStandaloneOptions, 'runnerDeps' | 'runRunImpl'>
}

function authorInvocationFromArgv(): unknown {
  const jsonIdx = process.argv.indexOf('--json')
  if (jsonIdx < 0) return {}
  const raw = process.argv[jsonIdx + 1]
  if (!raw) throw new Error('usage: cocoder oz author <playId> [--json <invocation-json>]')
  try {
    return JSON.parse(raw) as unknown
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`invalid --json invocation: ${detail}`)
  }
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function parseEvidence(raw: string | undefined, problem: string): readonly DebRepairEvidenceItem[] {
  if (!raw) return [{ kind: 'cli', ref: 'request-deb-repair', summary: problem }]
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`invalid --evidence JSON: ${detail}`)
  }
  if (!Array.isArray(parsed)) throw new Error('--evidence must be a JSON array')
  const evidence = parsed.map((item): DebRepairEvidenceItem => {
    if (typeof item !== 'object' || item === null) throw new Error('--evidence entries must be objects')
    const record = item as Record<string, unknown>
    if (typeof record.kind !== 'string' || record.kind.trim() === '') throw new Error('--evidence entries need a non-empty kind')
    if (typeof record.summary !== 'string' || record.summary.trim() === '') throw new Error('--evidence entries need a non-empty summary')
    return {
      kind: record.kind,
      ...(typeof record.ref === 'string' && record.ref.trim() ? { ref: record.ref } : {}),
      summary: record.summary,
    }
  })
  if (evidence.length === 0) throw new Error('--evidence must contain at least one entry')
  return evidence
}

function independentRunnerRefusal(priority: { readonly id: string; readonly independentOfRunner?: boolean }, impactReasons: readonly string[]): string | null {
  if (priority.independentOfRunner === true) return null
  const detail = impactReasons.length > 0 ? ` Detected runner impact: ${impactReasons.join('; ')}.` : ''
  return `Priority "${priority.id}" is not marked independent-of-runner: true; refusing run-independent.${detail} Mark the priority with \`independent-of-runner: true\` before using this daemon-free entrypoint.`
}

function daemonLiveStoreContentionMessage(port: number): string {
  return `cocoder: Oz daemon is live on :${port}; refusing run-independent against the live store. The daemon owns local/cocoder.db and this run would contend for SQLite's single-writer lock. Stop the daemon, or re-run with --force to proceed anyway.`
}

// `cocoder run <priorityId>` (ADR-0004). The probe decides the writer: if a daemon is live it owns
// the DB writer + cmux connection, so the cli routes the launch through it (client mode) and never
// opens the DB. Otherwise the cli is the composition root and runs standalone, taking the lock.
export async function main(options: MainOptions = {}): Promise<void> {
  const probeDaemonImpl = options.probeDaemonImpl ?? probeDaemon
  const [cmd, arg1] = process.argv.slice(2)

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.error(usage)
    process.exit(cmd ? 0 : 2)
  }
  if (cmd === 'oz' && arg1 === 'start') {
    process.exit(await startOzDaemon(DEFAULT_OZ_PORT))
  }
  if (cmd === 'oz' && arg1 === 'teardown') {
    const runId = process.argv[4]
    if (!runId) {
      console.error('usage: cocoder oz teardown <runId> [--initiator <persona>]')
      process.exit(2)
    }
    const initiatorIdx = process.argv.indexOf('--initiator')
    const initiatorPersona = initiatorIdx >= 0 ? process.argv[initiatorIdx + 1] : undefined
    if (initiatorIdx >= 0 && !initiatorPersona) {
      console.error('usage: cocoder oz teardown <runId> [--initiator <persona>]')
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — nothing to tear down')
      process.exit(1)
    }
    const { closed } = await teardownViaDaemon(`http://127.0.0.1:${live.port}`, runId, { initiatorPersona })
    out(`torn down ${runId}: closed ${closed.length} pane(s)`)
    return
  }
  if (cmd === 'oz' && arg1 === 'resume') {
    const runId = process.argv[4]
    if (!runId) {
      console.error('usage: cocoder oz resume <runId>')
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — cannot resume')
      process.exit(1)
    }
    await resumeViaDaemon(`http://127.0.0.1:${live.port}`, runId)
    out(`resuming ${runId}`)
    return
  }
  if (cmd === 'oz' && (arg1 === 'commit-support' || arg1 === 'support-commit')) {
    const runId = process.argv[4]
    if (!runId) {
      console.error('usage: cocoder oz commit-support <runId>')
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — cannot commit support edits')
      process.exit(1)
    }
    const result = await supportCommitViaDaemon(`http://127.0.0.1:${live.port}`, runId)
    if (result.commitSha) {
      out(`committed support edits for ${runId}: ${result.commitSha}`)
      if (result.committedPaths.length) out(`  files: ${result.committedPaths.join(', ')}`)
      if (result.outOfLanePaths.length) out(`  out of lane, flagged not withheld: ${result.outOfLanePaths.join(', ')}`)
    } else {
      out(`no support edits pending for ${runId}`)
    }
    return
  }
  if (cmd === 'oz' && arg1 === 'close-ticket') {
    const ticketId = process.argv[4]
    if (!ticketId) {
      console.error(closeTicketUsage)
      process.exit(2)
    }
    const resolution = optionValue('--resolution')
    const runId = optionValue('--run')
    if ((process.argv.includes('--resolution') && !resolution) || (process.argv.includes('--run') && !runId)) {
      console.error(closeTicketUsage)
      process.exit(2)
    }
    const closeResolution = resolution ?? 'Closed via cocoder oz close-ticket.'
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (live.alive) {
      const result = await closeTicketViaDaemon(`http://127.0.0.1:${live.port}`, 'cocoder', ticketId, closeResolution)
      if (result.queued) {
        out(`queued ticket close ${ticketId}: ${result.queuedId}`)
      } else if (result.closed) {
        out(`closed ticket ${ticketId}: ${result.commitSha ?? 'no commit'}`)
        if (result.committedPaths?.length) out(`  files: ${result.committedPaths.join(', ')}`)
      } else {
        out(`ticket ${ticketId} was not closed${result.reason ? ` (${result.reason})` : ''}`)
        process.exitCode = 1
      }
      return
    }
    const result = await closeTicketViaCli({
      repoPath: process.cwd(),
      ticketId,
      resolution: closeResolution,
      closedDate: new Date().toISOString().slice(0, 10),
      ...(runId ? { runId } : {}),
    })
    if (result.closed) {
      out(`closed ticket ${ticketId}: ${result.commitSha}`)
      if (result.files.length) out(`  files: ${result.files.join(', ')}`)
    } else if (result.reason === 'already-closed') {
      out(`ticket ${ticketId} is already closed${result.commitSha ? ` (reconciled stale order entry: ${result.commitSha})` : ''}`)
    } else {
      out(`ticket ${ticketId} not found among open tickets — nothing closed`)
      process.exitCode = 1
    }
    return
  }
  if (cmd === 'oz' && arg1 === 'confirm-ticket-close') {
    const runId = process.argv[4]
    if (!runId) {
      console.error(confirmTicketCloseUsage)
      process.exit(2)
    }
    const resolution = optionValue('--resolution')
    if (process.argv.includes('--resolution') && !resolution) {
      console.error(confirmTicketCloseUsage)
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — confirm-ticket-close requires the daemon because awaiting-founder run state is in memory')
      process.exitCode = 1
      return
    }
    const result = await confirmTicketCloseViaDaemon(`http://127.0.0.1:${live.port}`, runId, resolution)
    if (result.closed) {
      out(`closed ticket ${result.ticketId ?? runId}: ${result.commitSha ?? 'no commit'}`)
      if (result.committedPaths?.length) out(`  files: ${result.committedPaths.join(', ')}`)
    } else {
      out(`ticket close confirmation for ${runId} was refused${result.reason ? ` (${result.reason})` : result.error ? ` (${result.error})` : ''}`)
      process.exitCode = 1
    }
    return
  }
  if (cmd === 'oz' && arg1 === 'create-ticket') {
    if (process.argv[4] === '--help' || process.argv[4] === '-h') {
      console.error(createTicketUsage)
      process.exit(0)
    }
    let invocation: Record<string, string>
    try {
      invocation = createTicketInvocation(process.argv.slice(4), {
        readFileText: (path) => readFileSync(path, 'utf8'),
        readStdin: () => readFileSync(0, 'utf8'),
      })
    } catch (err) {
      console.error(`cocoder: ${err instanceof Error ? err.message : String(err)}`)
      console.error(createTicketUsage)
      process.exit(2)
    }
    const runId = optionValue('--run')
    if (process.argv.includes('--run') && !runId) {
      console.error(createTicketUsage)
      process.exit(2)
    }
    // A control-plane create is a loop-DOWN operation: while a daemon is live, an out-of-band create can
    // race an active run editing the same ticket queue (ADR-0041 D2/D3). Refuse and point at the in-loop path.
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (live.alive) {
      console.error(`cocoder: a daemon is live on :${live.port} — refusing an out-of-band ticket create (ADR-0041 D2/D3: it can race an active run). Let the run file its own ticket, or stop the loop first.`)
      process.exit(1)
    }
    const result = await createTicketViaCli({
      repoPath: process.cwd(),
      title: invocation.title,
      type: invocation.type,
      priority: invocation.priority,
      description: invocation.description,
      created: new Date().toISOString().slice(0, 10),
      ...(invocation.ticketId ? { ticketId: invocation.ticketId } : {}),
      ...(runId ? { runId } : {}),
    })
    if (result.created) {
      out(`created ticket ${result.id}: ${result.commitSha}`)
      if (result.files.length) out(`  files: ${result.files.join(', ')}`)
    } else {
      out(`ticket ${invocation.ticketId ?? '(next)'} already exists — nothing created`)
      process.exitCode = 1
    }
    return
  }
  if (cmd === 'oz' && arg1 === 'create-priority') {
    if (process.argv[4] === '--help' || process.argv[4] === '-h') {
      console.error(createPriorityUsage)
      process.exit(0)
    }
    let invocation: Record<string, string>
    try {
      invocation = createPriorityInvocation(process.argv.slice(4), {
        readFileText: (path) => readFileSync(path, 'utf8'),
        readStdin: () => readFileSync(0, 'utf8'),
      })
    } catch (err) {
      console.error(`cocoder: ${err instanceof Error ? err.message : String(err)}`)
      console.error(createPriorityUsage)
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — cannot create a priority')
      process.exit(1)
    }
    const result = await authoringPlayViaDaemon(`http://127.0.0.1:${live.port}`, 'cocoder', 'create-priority', invocation, 'oscar')
    if (result.commitSha) {
      out(`created priority ${invocation.id}: ${result.commitSha}`)
      if (result.committedPaths.length) out(`  files: ${result.committedPaths.join(', ')}`)
      if (result.turnLogPath) out(`  turn log: ${result.turnLogPath}`)
    } else {
      out(`create-priority for ${invocation.id} completed, but no commit was created`)
      if (result.outOfLanePaths.length) out(`  held back outside the Play lane: ${result.outOfLanePaths.join(', ')}`)
    }
    return
  }
  if (cmd === 'oz' && arg1 === 'edit-priority') {
    if (process.argv[4] === '--help' || process.argv[4] === '-h') {
      console.error(editPriorityUsage)
      process.exit(0)
    }
    let invocation: Record<string, string>
    try {
      invocation = editPriorityInvocation(process.argv.slice(4), {
        readFileText: (path) => readFileSync(path, 'utf8'),
        readStdin: () => readFileSync(0, 'utf8'),
      })
    } catch (err) {
      console.error(`cocoder: ${err instanceof Error ? err.message : String(err)}`)
      console.error(editPriorityUsage)
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — cannot edit a priority')
      process.exit(1)
    }
    const result = await authoringPlayViaDaemon(`http://127.0.0.1:${live.port}`, 'cocoder', 'edit-priority', invocation, 'oscar')
    if (result.commitSha) {
      out(`edited priority ${invocation.id}: ${result.commitSha}`)
      if (result.committedPaths.length) out(`  files: ${result.committedPaths.join(', ')}`)
      if (result.turnLogPath) out(`  turn log: ${result.turnLogPath}`)
    } else {
      out(`edit-priority for ${invocation.id} completed, but no commit was created`)
      if (result.outOfLanePaths.length) out(`  held back outside the Play lane: ${result.outOfLanePaths.join(', ')}`)
    }
    return
  }
  if (cmd === 'oz' && arg1 === 'request-deb-repair') {
    const workspaceId = process.argv[4]
    const problem = optionValue('--problem')
    const sourceRunId = optionValue('--run')
    const rawEvidence = optionValue('--evidence')
    if (!workspaceId || !problem || !problem.trim() || (process.argv.includes('--run') && !sourceRunId) || (process.argv.includes('--evidence') && !rawEvidence)) {
      console.error(requestDebRepairUsage)
      process.exit(2)
    }
    let evidence: readonly DebRepairEvidenceItem[]
    try {
      evidence = parseEvidence(rawEvidence, problem.trim())
    } catch (err) {
      console.error(`cocoder: ${err instanceof Error ? err.message : String(err)}`)
      console.error(requestDebRepairUsage)
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — cannot request Deb repair')
      process.exit(1)
    }
    const result = await requestDebRepairViaDaemon(`http://127.0.0.1:${live.port}`, workspaceId, {
      problem: problem.trim(),
      evidence,
      ...(sourceRunId ? { sourceRunId } : {}),
    })
    out(JSON.stringify(result, null, 2))
    return
  }
  if (cmd === 'oz' && arg1 === 'archive-priority') {
    if (process.argv[4] === '--help' || process.argv[4] === '-h') {
      console.error(archivePriorityUsage)
      process.exit(0)
    }
    let parsed: { readonly workspaceId: string; readonly invocation: Record<string, string> }
    try {
      parsed = archivePriorityInvocation(process.argv.slice(4))
    } catch (err) {
      console.error(`cocoder: ${err instanceof Error ? err.message : String(err)}`)
      console.error(archivePriorityUsage)
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — cannot dispatch archive-priority')
      process.exit(1)
    }
    const result = await authoringPlayViaDaemon(`http://127.0.0.1:${live.port}`, parsed.workspaceId, 'archive-priority', parsed.invocation)
    if (result.commitSha) {
      out(`archived priority ${parsed.invocation.id} for ${parsed.workspaceId}: ${result.commitSha}`)
      if (result.committedPaths.length) out(`  files: ${result.committedPaths.join(', ')}`)
      if (result.turnLogPath) out(`  turn log: ${result.turnLogPath}`)
    } else {
      // A no-move archive now fails loudly upstream (non-2xx → the transport throws); reaching here with
      // no commit means the priority was already archived, so report that honestly rather than as a no-op.
      out(`priority ${parsed.invocation.id} for ${parsed.workspaceId} was already archived; nothing to move${result.reason ? ` (${result.reason})` : ''}`)
    }
    return
  }
  if (cmd === 'oz' && arg1 === 'author') {
    const playId = process.argv[4]
    if (!playId) {
      console.error('usage: cocoder oz author <playId> [--json <invocation-json>]')
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — cannot dispatch authoring Play')
      process.exit(1)
    }
    const result = await authoringPlayViaDaemon(`http://127.0.0.1:${live.port}`, 'cocoder', playId, authorInvocationFromArgv(), 'oscar')
    if (result.commitSha) {
      out(`committed authoring Play ${playId}: ${result.commitSha}`)
      if (result.committedPaths.length) out(`  files: ${result.committedPaths.join(', ')}`)
      if (result.outOfLanePaths.length) out(`  out of lane, flagged not withheld: ${result.outOfLanePaths.join(', ')}`)
      if (result.turnLogPath) out(`  turn log: ${result.turnLogPath}`)
    } else {
      out(`authoring Play ${playId} completed, but no commit was created`)
      if (result.outOfLanePaths.length) out(`  held back outside the Play lane: ${result.outOfLanePaths.join(', ')}`)
      if (result.turnLogPath) out(`  turn log: ${result.turnLogPath}`)
    }
    return
  }
  if (cmd === 'oz' && arg1 === 'migrate-history') {
    const workspaceId = process.argv[4]
    if (!workspaceId) {
      console.error('usage: cocoder oz migrate-history <workspaceId>')
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — cannot migrate portable history')
      process.exit(1)
    }
    const result = await migrateHistoryViaDaemon(`http://127.0.0.1:${live.port}`, workspaceId)
    out(`migrated portable history for ${workspaceId}: exported ${result.runsExported} run(s), ${result.sessionsExported} session(s)`)
    return
  }
  if (cmd !== 'run' && cmd !== 'run-independent') {
    console.error(usage)
    process.exit(2)
  }
  if (!arg1) {
    console.error(cmd === 'run-independent' ? runIndependentUsage : usage)
    process.exit(2)
  }
  const priorityId = arg1
  // Optional `--resume <runId>`: continue from that run's pickup brief (ADR-0013 / F8).
  const resumeIdx = process.argv.indexOf('--resume')
  const resumeFromRunId = resumeIdx >= 0 ? process.argv[resumeIdx + 1] : undefined
  if (resumeIdx >= 0 && !resumeFromRunId) {
    console.error(cmd === 'run-independent' ? 'usage: cocoder run-independent <priorityId> --resume <runId> [--force]' : 'usage: cocoder run <priorityId> --resume <runId>')
    process.exit(2)
  }
  // Optional `--strict-dirt` (ADR-0029): refuse the launch on uncommitted founder WIP instead of the
  // default founder pre-run snapshot. For shared repos / CI that want a hard manual gate.
  const strictPreRunDirt = process.argv.includes('--strict-dirt')
  const allowPreRunIntegrityErrors = process.argv.includes('--allow-pre-run-integrity-errors')
  const forceDaemonLive = process.argv.includes('--force')

  if (cmd === 'run-independent') {
    await runStandalone(priorityId, resumeFromRunId, strictPreRunDirt, allowPreRunIntegrityErrors, {
      ...options.runStandaloneOptions,
      forceDaemonLive,
      probeDaemonImpl,
      requireIndependentOfRunner: true,
    })
    return
  }

  const live = await probeDaemonImpl({ port: DEFAULT_OZ_PORT })
  if (live.alive) {
    log(`daemon live on :${live.port} → client mode (daemon owns the DB writer + cmux)`)
    const result = await runViaDaemon(`http://127.0.0.1:${live.port}`, 'cocoder', priorityId, {
      log,
      resumeFromRunId,
      strictPreRunDirt,
      allowPreRunIntegrityErrors,
    })
    out(`\nRun ${result.runId}: ${result.status}`)
    if (result.commits.length) out(`  committed: ${result.commits.join(', ')}`)
    process.exitCode = result.status === 'completed' ? 0 : 1
    return
  }
  log('no daemon → standalone mode (cli takes the SQLite write-lock)')
  await runStandalone(priorityId, resumeFromRunId, strictPreRunDirt, allowPreRunIntegrityErrors, options.runStandaloneOptions)
}

// Standalone: the cli is the composition root — opens the operational DB (acquiring the
// single-writer lock), wires the concrete drivers into core's ports, loads governance, runs.
export async function runStandalone(
  priorityId: string,
  resumeFromRunId?: string,
  strictPreRunDirt?: boolean,
  allowPreRunIntegrityErrors?: boolean,
  options: RunStandaloneOptions = {},
): Promise<void> {
  const root = process.cwd() // dogfood: run from the CoCoder repo root
  const personasDir = join(root, 'cocoder', 'personas')
  const prioritiesDir = join(root, 'cocoder', 'priorities')
  const priority = loadPriority(prioritiesDir, priorityId)
  if (options.requireIndependentOfRunner) {
    const refusal = independentRunnerRefusal(priority, detectRunnerImpact(priority).reasons)
    if (refusal) {
      console.error(`cocoder: ${refusal}`)
      process.exit(1)
    }
    log('run-independent → standalone direct mode (runner bypassed)')
  }
  const runTarget = await resolveRunTarget({ root, priority, requireIndependentOfRunner: options.requireIndependentOfRunner === true })
  if (runTarget.isolated) log(`run-independent (destructive) → isolated scratch target at ${runTarget.scratchRoot} (live store/runs untouched)`)
  if (options.requireIndependentOfRunner === true && !runTarget.isolated) {
    const live = await (options.probeDaemonImpl ?? probeDaemon)({ port: DEFAULT_OZ_PORT })
    if (live.alive) {
      const message = daemonLiveStoreContentionMessage(live.port)
      if (!options.forceDaemonLive) {
        console.error(message)
        process.exit(1)
      }
      log(`WARNING: ${message.replace(/^cocoder: /, '')}`)
    }
  }
  const runsRoot = runTarget.runsRoot
  const baseDir = basePersonasDir()
  const sources: PersonaSources = { baseDir, deltaDir: join(personasDir, 'deltas'), repoPersonaDir: personasDir }
  const playSources = { baseDir: basePlaysDir(), deltaDir: join(root, 'cocoder', 'plays', 'deltas'), repoPlayDir: join(root, 'cocoder', 'plays') }
  const sharedStandards = readFileSync(join(baseDir, 'shared-standards.md'), 'utf8')
  const assignments = loadAssignments(join(personasDir, 'assignments.json'))
  const registry = makeAdapterRegistry()
  const injectedRunnerDeps = options.runnerDeps
  const getAdapterImpl = injectedRunnerDeps?.getAdapter ?? ((cli: string) => getAdapter(cli, registry))

  const workspace = { id: 'cocoder', path: root, name: 'CoCoder' }
  const assignedOscar = resolveEffectivePersona(sources, assignments, 'oscar')
  const oscar = options.requireIndependentOfRunner
    ? { ...assignedOscar, model: await latestModelFor(getAdapterImpl(assignedOscar.cli)) }
    : assignedOscar
  if (options.requireIndependentOfRunner) log(`run-independent → Oscar model resolved to ${oscar.model}`)
  const bob = resolveEffectivePersona(sources, assignments, 'bob')
  const deb = isPersonaEnabled(assignments, 'deb') ? resolveEffectivePersona(sources, assignments, 'deb') : undefined
  const wrapPlay = resolveMandatoryPlay('run-wrap', listEffectivePlays(playSources))
  const preRunGovernanceChecks: PreRunGovernanceCheck[] = [
    {
      label: `priority "${priorityId}"`,
      path: join(prioritiesDir, `${priorityId}.md`),
      check: () => {
        loadPriority(prioritiesDir, priorityId)
      },
    },
    {
      label: 'oscar persona',
      path: join(baseDir, 'oscar.md'),
      check: () => {
        resolveEffectivePersona(sources, assignments, 'oscar')
      },
    },
    {
      label: 'bob persona',
      path: join(baseDir, 'bob.md'),
      check: () => {
        resolveEffectivePersona(sources, assignments, 'bob')
      },
    },
    {
      label: 'wrap-up Play',
      path: playSources.baseDir,
      check: () => {
        resolveMandatoryPlay('run-wrap', listEffectivePlays(playSources))
      },
    },
  ]
  if (deb) {
    preRunGovernanceChecks.push({
      label: 'deb persona',
      path: join(baseDir, 'deb.md'),
      check: () => {
        resolveEffectivePersona(sources, assignments, 'deb')
      },
    })
  }

  // Resume: continue from a prior run's pickup brief (ADR-0013 / F8).
  let pickup: string | null = null
  if (resumeFromRunId) {
    try {
      const resumeRunDir = resolveLocalRunDir(runsRoot, resumeFromRunId)
      if (resumeRunDir === null) throw new Error('missing pickup run dir')
      pickup = readFileSync(join(resumeRunDir, 'pickup.md'), 'utf8')
    } catch {
      console.error(`cocoder: cannot resume — no pickup brief for run "${resumeFromRunId}"`)
      process.exit(1)
    }
  }

  const store = openRunStore(runTarget.dbPath)
  const runRunImpl = options.runRunImpl ?? runRun
  const deps: RunnerDeps = {
    store,
    sessionHost: injectedRunnerDeps?.sessionHost ?? new CmuxSessionHost(),
    git: makeGit(),
    getAdapter: getAdapterImpl,
    io: injectedRunnerDeps?.io ?? makeRunnerIO(),
    log,
    ...(injectedRunnerDeps?.limits === undefined ? {} : { limits: injectedRunnerDeps.limits }),
    ...(injectedRunnerDeps?.makeJudge === undefined ? {} : { makeJudge: injectedRunnerDeps.makeJudge }),
    ...(injectedRunnerDeps?.runHeadless === undefined ? {} : { runHeadless: injectedRunnerDeps.runHeadless }),
    ...(injectedRunnerDeps?.timeouts === undefined ? {} : { timeouts: injectedRunnerDeps.timeouts }),
  }

  try {
    const result = await runRunImpl(deps, {
      workspace,
      priority,
      oscar,
      bob,
      deb,
      playSources,
      wrapPlay,
      wrapPlayAssignment: resolvePlayAssignment(assignments, 'oscar', wrapPlay.id),
      sharedStandards,
      runsRoot,
      pickup,
      strictPreRunDirt,
      allowPreRunIntegrityErrors,
      preRunGovernanceChecks,
    })
    out(`\nRun ${result.runId}: ${result.status}`)
    if (result.committedSha) out(`  committed ${result.committedSha} (${result.committedFiles.length} file(s))`)
    if (result.outOfScope.length) out(`  committed out of lane (flagged, not withheld): ${result.outOfScope.join(', ')}`)
    if (result.selfCommitted) out('  note: agent made its own commit(s) (detected via HEAD snapshot)')
    out(`  record: ${result.recordPath}`)
    process.exitCode = result.status === 'completed' ? 0 : 1
  } finally {
    store.close()
  }
}
