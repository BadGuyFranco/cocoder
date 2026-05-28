import './suppress-sqlite-warning.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadAssignments,
  loadPriority,
  makeGit,
  makeRunnerIO,
  openRunStore,
  resolvePersona,
  runRun,
  type RunnerDeps,
} from '@cocoder/core'
import { getAdapter, makeAdapterRegistry } from '@cocoder/adapters'
import { CmuxSessionHost } from '@cocoder/session-hosts'

// Standalone `cocoder run <priorityId>` (ADR-0004): the cli is the composition root — it opens
// the operational DB (acquiring the single-writer lock), wires the concrete drivers into core's
// ports, loads governance from the workspace's cocoder/ zone, and drives the runner.
async function main(): Promise<void> {
  const [cmd, priorityId] = process.argv.slice(2)
  if (cmd !== 'run' || !priorityId) {
    console.error('usage: cocoder run <priorityId>')
    process.exit(2)
  }

  const root = process.cwd() // dogfood: run from the CoCoder repo root
  const personasDir = join(root, 'cocoder', 'personas')
  const prioritiesDir = join(root, 'cocoder', 'priorities')
  const sharedStandards = readFileSync(join(personasDir, 'shared-standards.md'), 'utf8')
  const assignments = loadAssignments(join(personasDir, 'assignments.json'))

  const workspace = { id: 'cocoder', path: root, name: 'CoCoder' }
  const oscar = resolvePersona(personasDir, assignments, 'oscar')
  const bob = resolvePersona(personasDir, assignments, 'bob')
  const priority = loadPriority(prioritiesDir, priorityId)

  const store = openRunStore(join(root, 'local', 'cocoder.db'))
  const registry = makeAdapterRegistry()
  const deps: RunnerDeps = {
    store,
    sessionHost: new CmuxSessionHost(),
    git: makeGit(),
    getAdapter: (cli) => getAdapter(cli, registry),
    io: makeRunnerIO(),
    log: (m) => console.error(`[cocoder] ${m}`),
  }

  try {
    const result = await runRun(deps, {
      workspace,
      priority,
      oscar,
      bob,
      sharedStandards,
      runsRoot: join(root, 'local', 'runs'),
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
