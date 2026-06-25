import './suppress-sqlite-warning.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_OZ_PORT,
  isPersonaEnabled,
  loadAssignments,
  listEffectivePlays,
  loadPriority,
  makeGit,
  makeRunnerIO,
  openRunStore,
  probeDaemon,
  resolveMandatoryPlay,
  resolveEffectivePersona,
  resolvePlayAssignment,
  runRun,
  type PreRunGovernanceCheck,
  type PersonaSources,
  type RunnerDeps,
} from '@cocoder/core'
import { getAdapter, makeAdapterRegistry } from '@cocoder/adapters'
import { basePersonasDir, basePlaysDir } from '@cocoder/personas'
import { CmuxSessionHost } from '@cocoder/session-hosts'
import { authoringPlayViaDaemon, migrateHistoryViaDaemon, requestDebRepairViaDaemon, resumeViaDaemon, runViaDaemon, startOzDaemon, supportCommitViaDaemon, teardownViaDaemon, type DebRepairEvidenceItem } from './client.js'
import { closeTicketViaCli } from './close-ticket.js'
import { createPriorityInvocation } from './oz-args.js'

const log = (m: string): void => console.error(`[cocoder] ${m}`)
const out = (m: string): void => {
  process.stdout.write(`${m}\n`)
}
const usage = 'usage: cocoder run <priorityId> [--resume <runId>] [--strict-dirt] [--allow-pre-run-integrity-errors]   |   cocoder oz start   |   cocoder oz author <playId> [--json <invocation-json>]   |   cocoder oz create-priority --id <id> --title <text> --objective <text> [--details-file <path> | --details-stdin]   |   cocoder oz close-ticket <id> [--resolution <text>] [--run <runId>]   |   cocoder oz archive-priority <priorityId> [--workspace <workspaceId>] [--verdict <text>] [--findings <text>] [--reason <text>]   |   cocoder oz migrate-history <workspaceId>   |   cocoder oz request-deb-repair <workspaceId> --problem <text> [--run <runId>] [--evidence <json>]   |   cocoder oz commit-support <runId>   |   cocoder oz resume <runId>   |   cocoder oz teardown <runId> [--initiator <persona>]'
const requestDebRepairUsage = 'usage: cocoder oz request-deb-repair <workspaceId> --problem <text> [--run <runId>] [--evidence <json>]'
const closeTicketUsage = 'usage: cocoder oz close-ticket <id> [--resolution <text>] [--run <runId>]'
const createPriorityUsage = 'usage: cocoder oz create-priority --id <id> --title <text> --objective <text> [--details-file <path> | --details-stdin]'

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

// `cocoder run <priorityId>` (ADR-0004). The probe decides the writer: if a daemon is live it owns
// the DB writer + cmux connection, so the cli routes the launch through it (client mode) and never
// opens the DB. Otherwise the cli is the composition root and runs standalone, taking the lock.
async function main(): Promise<void> {
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
    // A control-plane close is a loop-DOWN operation: while a daemon is live, an out-of-band close can
    // race an active run for the same ticket (ADR-0041 D2/D3). Refuse and point at the in-loop path.
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (live.alive) {
      console.error(`cocoder: a daemon is live on :${live.port} — refusing an out-of-band ticket close (ADR-0041 D2/D3: it can race an active run). Let the run close its own target, or stop the loop first.`)
      process.exit(1)
    }
    const result = await closeTicketViaCli({
      repoPath: process.cwd(),
      ticketId,
      resolution: resolution ?? 'Closed via cocoder oz close-ticket.',
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
  if (cmd === 'oz' && arg1 === 'create-priority') {
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
    const priorityId = process.argv[4]
    if (!priorityId) {
      console.error('usage: cocoder oz archive-priority <priorityId> [--workspace <workspaceId>] [--verdict <text>] [--findings <text>] [--reason <text>]')
      process.exit(2)
    }
    const workspaceIdx = process.argv.indexOf('--workspace')
    const workspaceId = workspaceIdx >= 0 ? process.argv[workspaceIdx + 1] : 'cocoder'
    if (workspaceIdx >= 0 && !workspaceId) {
      console.error('usage: cocoder oz archive-priority <priorityId> [--workspace <workspaceId>] [--verdict <text>] [--findings <text>] [--reason <text>]')
      process.exit(2)
    }
    const archiveInvocation: Record<string, string> = { id: priorityId }
    for (const key of ['verdict', 'findings', 'reason'] as const) {
      const flag = `--${key}`
      const value = optionValue(flag)
      if (process.argv.includes(flag) && !value) {
        console.error('usage: cocoder oz archive-priority <priorityId> [--workspace <workspaceId>] [--verdict <text>] [--findings <text>] [--reason <text>]')
        process.exit(2)
      }
      if (value) archiveInvocation[key] = value
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — cannot dispatch archive-priority')
      process.exit(1)
    }
    const result = await authoringPlayViaDaemon(`http://127.0.0.1:${live.port}`, workspaceId, 'archive-priority', archiveInvocation)
    if (result.commitSha) {
      out(`archived priority ${priorityId} for ${workspaceId}: ${result.commitSha}`)
      if (result.committedPaths.length) out(`  files: ${result.committedPaths.join(', ')}`)
      if (result.turnLogPath) out(`  turn log: ${result.turnLogPath}`)
    } else {
      // A no-move archive now fails loudly upstream (non-2xx → the transport throws); reaching here with
      // no commit means the priority was already archived, so report that honestly rather than as a no-op.
      out(`priority ${priorityId} for ${workspaceId} was already archived; nothing to move${result.reason ? ` (${result.reason})` : ''}`)
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
  if (cmd !== 'run' || !arg1) {
    console.error(usage)
    process.exit(2)
  }
  const priorityId = arg1
  // Optional `--resume <runId>`: continue from that run's pickup brief (ADR-0013 / F8).
  const resumeIdx = process.argv.indexOf('--resume')
  const resumeFromRunId = resumeIdx >= 0 ? process.argv[resumeIdx + 1] : undefined
  if (resumeIdx >= 0 && !resumeFromRunId) {
    console.error('usage: cocoder run <priorityId> --resume <runId>')
    process.exit(2)
  }
  // Optional `--strict-dirt` (ADR-0029): refuse the launch on uncommitted founder WIP instead of the
  // default founder pre-run snapshot. For shared repos / CI that want a hard manual gate.
  const strictPreRunDirt = process.argv.includes('--strict-dirt')
  const allowPreRunIntegrityErrors = process.argv.includes('--allow-pre-run-integrity-errors')

  const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
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
  await runStandalone(priorityId, resumeFromRunId, strictPreRunDirt, allowPreRunIntegrityErrors)
}

// Standalone: the cli is the composition root — opens the operational DB (acquiring the
// single-writer lock), wires the concrete drivers into core's ports, loads governance, runs.
async function runStandalone(priorityId: string, resumeFromRunId?: string, strictPreRunDirt?: boolean, allowPreRunIntegrityErrors?: boolean): Promise<void> {
  const root = process.cwd() // dogfood: run from the CoCoder repo root
  const personasDir = join(root, 'cocoder', 'personas')
  const prioritiesDir = join(root, 'cocoder', 'priorities')
  const runsRoot = join(root, 'local', 'runs')
  const baseDir = basePersonasDir()
  const sources: PersonaSources = { baseDir, deltaDir: join(personasDir, 'deltas'), repoPersonaDir: personasDir }
  const playSources = { baseDir: basePlaysDir(), deltaDir: join(root, 'cocoder', 'plays', 'deltas'), repoPlayDir: join(root, 'cocoder', 'plays') }
  const sharedStandards = readFileSync(join(baseDir, 'shared-standards.md'), 'utf8')
  const assignments = loadAssignments(join(personasDir, 'assignments.json'))

  const workspace = { id: 'cocoder', path: root, name: 'CoCoder' }
  const oscar = resolveEffectivePersona(sources, assignments, 'oscar')
  const bob = resolveEffectivePersona(sources, assignments, 'bob')
  const deb = isPersonaEnabled(assignments, 'deb') ? resolveEffectivePersona(sources, assignments, 'deb') : undefined
  const priority = loadPriority(prioritiesDir, priorityId)
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
      pickup = readFileSync(join(runsRoot, resumeFromRunId, 'pickup.md'), 'utf8')
    } catch {
      console.error(`cocoder: cannot resume — no pickup brief for run "${resumeFromRunId}"`)
      process.exit(1)
    }
  }

  const store = openRunStore(join(root, 'local', 'cocoder.db'))
  const registry = makeAdapterRegistry()
  const deps: RunnerDeps = {
    store,
    sessionHost: new CmuxSessionHost(),
    git: makeGit(),
    getAdapter: (cli) => getAdapter(cli, registry),
    io: makeRunnerIO(),
    log,
  }

  try {
    const result = await runRun(deps, {
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

main().catch((err: unknown) => {
  console.error(`cocoder: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
