import './suppress-sqlite-warning.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_OZ_PORT,
  isPersonaEnabled,
  loadAssignments,
  loadPlay,
  loadPriority,
  makeGit,
  makeRunnerIO,
  openRunStore,
  probeDaemon,
  resolveEffectivePersona,
  resolvePlayAssignment,
  runRun,
  type PersonaSources,
  type RunnerDeps,
} from '@cocoder/core'
import { getAdapter, makeAdapterRegistry } from '@cocoder/adapters'
import { basePersonasDir, basePlaysDir } from '@cocoder/personas'
import { CmuxSessionHost } from '@cocoder/session-hosts'
import { runViaDaemon, startOzDaemon, teardownViaDaemon } from './client.js'

const log = (m: string): void => console.error(`[cocoder] ${m}`)

// `cocoder run <priorityId>` (ADR-0004). The probe decides the writer: if a daemon is live it owns
// the DB writer + cmux connection, so the cli routes the launch through it (client mode) and never
// opens the DB. Otherwise the cli is the composition root and runs standalone, taking the lock.
async function main(): Promise<void> {
  const [cmd, arg1] = process.argv.slice(2)

  if (cmd === 'oz' && arg1 === 'start') {
    process.exit(await startOzDaemon(DEFAULT_OZ_PORT))
  }
  if (cmd === 'oz' && arg1 === 'teardown') {
    const runId = process.argv[4]
    if (!runId) {
      console.error('usage: cocoder oz teardown <runId>')
      process.exit(2)
    }
    const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
    if (!live.alive) {
      console.error('cocoder: no Oz daemon running — nothing to tear down')
      process.exit(1)
    }
    const { closed } = await teardownViaDaemon(`http://127.0.0.1:${live.port}`, runId)
    console.log(`torn down ${runId}: closed ${closed.length} pane(s)`)
    return
  }
  if (cmd !== 'run' || !arg1) {
    console.error('usage: cocoder run <priorityId> [--resume <runId>]   |   cocoder oz start   |   cocoder oz teardown <runId>')
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

  const live = await probeDaemon({ port: DEFAULT_OZ_PORT })
  if (live.alive) {
    log(`daemon live on :${live.port} → client mode (daemon owns the DB writer + cmux)`)
    const result = await runViaDaemon(`http://127.0.0.1:${live.port}`, 'cocoder', priorityId, { log, resumeFromRunId })
    console.log(`\nRun ${result.runId}: ${result.status}`)
    if (result.commits.length) console.log(`  committed: ${result.commits.join(', ')}`)
    process.exitCode = result.status === 'completed' ? 0 : 1
    return
  }
  log('no daemon → standalone mode (cli takes the SQLite write-lock)')
  await runStandalone(priorityId, resumeFromRunId)
}

// Standalone: the cli is the composition root — opens the operational DB (acquiring the
// single-writer lock), wires the concrete drivers into core's ports, loads governance, runs.
async function runStandalone(priorityId: string, resumeFromRunId?: string): Promise<void> {
  const root = process.cwd() // dogfood: run from the CoCoder repo root
  const personasDir = join(root, 'cocoder', 'personas')
  const prioritiesDir = join(root, 'cocoder', 'priorities')
  const runsRoot = join(root, 'local', 'runs')
  const baseDir = basePersonasDir()
  const sources: PersonaSources = { baseDir, deltaDir: join(personasDir, 'deltas'), repoPersonaDir: personasDir }
  const sharedStandards = readFileSync(join(baseDir, 'shared-standards.md'), 'utf8')
  const assignments = loadAssignments(join(personasDir, 'assignments.json'))

  const workspace = { id: 'cocoder', path: root, name: 'CoCoder' }
  const oscar = resolveEffectivePersona(sources, assignments, 'oscar')
  const bob = resolveEffectivePersona(sources, assignments, 'bob')
  const deb = isPersonaEnabled(assignments, 'deb') ? resolveEffectivePersona(sources, assignments, 'deb') : undefined
  const priority = loadPriority(prioritiesDir, priorityId)

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
      wrapPlay: loadPlay(basePlaysDir(), 'wrap-up'),
      wrapPlayAssignment: resolvePlayAssignment(assignments, 'oscar', 'wrap-up'),
      integrationVerifyPlay: loadPlay(basePlaysDir(), 'integration-verify'),
      integrationVerifyAssignment: resolvePlayAssignment(assignments, 'oscar', 'integration-verify'),
      mergeConflictPlay: loadPlay(basePlaysDir(), 'merge-conflict'),
      mergeConflictAssignment: resolvePlayAssignment(assignments, 'oscar', 'merge-conflict'),
      sharedStandards,
      runsRoot,
      pickup,
    })
    console.log(`\nRun ${result.runId}: ${result.status}`)
    if (result.committedSha) console.log(`  committed ${result.committedSha} (${result.committedFiles.length} file(s))`)
    if (result.outOfScope.length) console.log(`  out-of-scope held back: ${result.outOfScope.join(', ')}`)
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
