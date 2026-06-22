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
import { authoringPlayViaDaemon, migrateHistoryViaDaemon, runViaDaemon, startOzDaemon, supportCommitViaDaemon, teardownViaDaemon } from './client.js'

const log = (m: string): void => console.error(`[cocoder] ${m}`)
const usage = 'usage: cocoder run <priorityId> [--resume <runId>] [--strict-dirt] [--allow-pre-run-integrity-errors]   |   cocoder oz start   |   cocoder oz author <playId> [--json <invocation-json>]   |   cocoder oz archive-priority <priorityId> [--workspace <workspaceId>]   |   cocoder oz migrate-history <workspaceId>   |   cocoder oz commit-support <runId>   |   cocoder oz teardown <runId> [--initiator <persona>]'

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
    console.log(`torn down ${runId}: closed ${closed.length} pane(s)`)
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
      console.log(`committed support edits for ${runId}: ${result.commitSha}`)
      if (result.committedPaths.length) console.log(`  files: ${result.committedPaths.join(', ')}`)
      if (result.outOfLanePaths.length) console.log(`  out of lane, flagged not withheld: ${result.outOfLanePaths.join(', ')}`)
    } else {
      console.log(`no support edits pending for ${runId}`)
    }
    return
  }
  if (cmd === 'oz' && arg1 === 'archive-priority') {
    const priorityId = process.argv[4]
    if (!priorityId) {
      console.error('usage: cocoder oz archive-priority <priorityId> [--workspace <workspaceId>]')
      process.exit(2)
    }
    const workspaceIdx = process.argv.indexOf('--workspace')
    const workspaceId = workspaceIdx >= 0 ? process.argv[workspaceIdx + 1] : 'cocoder'
    if (workspaceIdx >= 0 && !workspaceId) {
      console.error('usage: cocoder oz archive-priority <priorityId> [--workspace <workspaceId>]')
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — cannot dispatch archive-priority')
      process.exit(1)
    }
    const result = await authoringPlayViaDaemon(`http://127.0.0.1:${live.port}`, workspaceId, 'archive-priority', { id: priorityId })
    if (result.commitSha) {
      console.log(`archived priority ${priorityId} for ${workspaceId}: ${result.commitSha}`)
      if (result.committedPaths.length) console.log(`  files: ${result.committedPaths.join(', ')}`)
      if (result.turnLogPath) console.log(`  turn log: ${result.turnLogPath}`)
    } else {
      console.log(`archive-priority completed for ${priorityId}, but no commit was created`)
      if (result.outOfLanePaths.length) console.log(`  held back outside the Play lane: ${result.outOfLanePaths.join(', ')}`)
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
      console.log(`committed authoring Play ${playId}: ${result.commitSha}`)
      if (result.committedPaths.length) console.log(`  files: ${result.committedPaths.join(', ')}`)
      if (result.outOfLanePaths.length) console.log(`  out of lane, flagged not withheld: ${result.outOfLanePaths.join(', ')}`)
      if (result.turnLogPath) console.log(`  turn log: ${result.turnLogPath}`)
    } else {
      console.log(`authoring Play ${playId} completed, but no commit was created`)
      if (result.outOfLanePaths.length) console.log(`  held back outside the Play lane: ${result.outOfLanePaths.join(', ')}`)
      if (result.turnLogPath) console.log(`  turn log: ${result.turnLogPath}`)
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
    console.log(`migrated portable history for ${workspaceId}: exported ${result.runsExported} run(s), ${result.sessionsExported} session(s)`)
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
    console.log(`\nRun ${result.runId}: ${result.status}`)
    if (result.commits.length) console.log(`  committed: ${result.commits.join(', ')}`)
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
    console.log(`\nRun ${result.runId}: ${result.status}`)
    if (result.committedSha) console.log(`  committed ${result.committedSha} (${result.committedFiles.length} file(s))`)
    if (result.outOfScope.length) console.log(`  committed out of lane (flagged, not withheld): ${result.outOfScope.join(', ')}`)
    if (result.selfCommitted) console.log('  note: agent made its own commit(s) (detected via HEAD snapshot)')
    console.log(`  record: ${result.recordPath}`)
    process.exitCode = result.status === 'completed' ? 0 : 1
  } finally {
    store.close()
  }
}

main().catch((err: unknown) => {
  console.error(`cocoder: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
