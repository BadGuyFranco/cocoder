#!/usr/bin/env node
// Proof command: pnpm -w exec tsx scripts/proof-retention.mjs
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

const KEEP_LAST = 25
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const coreRequire = createRequire(join(repoRoot, 'packages/core/package.json'))
const { openRunStore, projectionCheckerFor, removeLocalRunDir, resolveRetentionConfig, rotateLogFile, runRetentionGc, writePortableRun } =
  await import(coreRequire.resolve('@cocoder/core'))

const failures = []
let tempRoot = null

try {
  tempRoot = mkdtempSync(join(tmpdir(), 'cocoder-proof-retention-'))
  assertSafeTempRoot(tempRoot)

  await runMainFixture(join(tempRoot, 'main'))
  await runRecurrenceFixture(join(tempRoot, 'recurrence'))
} catch (error) {
  fail('unexpected error', error instanceof Error ? error.stack ?? error.message : String(error))
} finally {
  if (tempRoot !== null) rmSync(tempRoot, { recursive: true, force: true })
}

if (tempRoot !== null && !existsSync(tempRoot)) pass('cleanup: temp root removed')
else fail('cleanup: temp root removed', tempRoot ?? '(not created)')

if (failures.length > 0) {
  console.log(`FAIL summary: ${failures.length} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('PASS summary: retention proof complete')
}

function assertSafeTempRoot(root) {
  const resolvedRoot = resolve(root)
  const resolvedTmp = resolve(tmpdir())
  const repoLocal = resolve(repoRoot, 'local')
  const underTmp = resolvedRoot.startsWith(ensureTrailingSep(resolvedTmp)) && resolvedRoot !== resolvedTmp
  const notRepoLocal = resolvedRoot !== repoLocal && !repoLocal.startsWith(ensureTrailingSep(resolvedRoot))

  if (!underTmp || !notRepoLocal) {
    throw new Error(`unsafe proof temp root: ${resolvedRoot}`)
  }
  pass(`safety: temp root isolated at ${resolvedRoot}`)
}

async function runMainFixture(root) {
  mkdirSync(root, { recursive: true })
  const fixture = openFixture(root)
  try {
    const running = await fixture.createRun({ workspaceId: 'workspace-a', createdAt: 1, status: 'running', projected: true })
    const awaiting = await fixture.createRun({ workspaceId: 'workspace-a', createdAt: 2, status: 'awaiting-founder', projected: true })
    const unprojected = await fixture.createRun({ workspaceId: 'workspace-a', createdAt: 3, status: 'completed', projected: false })
    const protectedTerminal = await fixture.createRun({ workspaceId: 'workspace-a', createdAt: 4, status: 'completed', projected: true })

    const bulkRuns = await createRuns(fixture, 30, (index) => terminalRun('workspace-a', 100 + index, true))
    const workspaceBRuns = await createRuns(fixture, 3, (index) => terminalRun('workspace-b', 200 + index, true))

    const config = resolveRetentionConfig({ enabled: true, keepLastNPerWorkspace: KEEP_LAST })
    const beforeBulkDirs = countExistingDirs(fixture.runsRoot, bulkRuns)
    const first = await fixture.runGc(config, new Set([protectedTerminal.id]))
    const afterBulkDirs = countExistingDirs(fixture.runsRoot, bulkRuns)

    check(first.failures.length === 0, 'bounded: first pass has no failures', JSON.stringify(first.failures))
    check(first.prunedRunIds.length === 5, 'bounded: prunes exactly 5 oldest workspace-a projected terminal runs')
    check(first.dirsRemoved === 5, 'bounded: removes exactly 5 local run dirs')
    checkBulkState(fixture, bulkRuns)
    console.log(`local runs dirs: ${afterBulkDirs} (was ${beforeBulkDirs})`)
    check(afterBulkDirs === 25 && beforeBulkDirs === 30, 'bounded: local runs dirs: 25 (was 30)')

    const secondFootprintBefore = fixture.footprint()
    const second = await fixture.runGc(config, new Set([protectedTerminal.id]))
    const secondFootprintAfter = fixture.footprint()
    check(second.failures.length === 0, 'idempotent: second pass has no failures', JSON.stringify(second.failures))
    check(second.prunedRunIds.length === 0, 'idempotent: second pass prunes zero further runs')
    check(secondFootprintAfter === secondFootprintBefore, 'idempotent: footprint unchanged')

    checkRunsExist(fixture, workspaceBRuns, 'fairness: workspace-b runs survive regardless of workspace-a volume')
    check(runExists(fixture, running), 'pending exclusion: running run row and dir survive')
    check(runExists(fixture, awaiting), 'pending exclusion: awaiting-founder run row and dir survive')
    check(
      first.skippedProtectedRunIds.includes(protectedTerminal.id),
      'protected exclusion: protected terminal run appears in skippedProtectedRunIds',
    )
    check(runExists(fixture, protectedTerminal), 'protected exclusion: protected terminal row and dir survive')
    check(runExists(fixture, unprojected), 'projection gating: unprojected terminal run row and dir survive')

    const walIsNumeric = first.wal !== null && ['busy', 'log', 'checkpointed'].every((key) => Number.isFinite(first.wal[key]))
    check(walIsNumeric, 'wal checkpoint: returns numeric checkpoint result', JSON.stringify(first.wal))
    check(fixture.logs.some((line) => line.includes('workspace-a: kept') && line.includes('workspace-b: kept')), 'surfaced: log contains per-workspace kept/total summary')
    check(fixture.logs.some((line) => line.includes('prune:') && bulkRuns.slice(0, 5).every((run) => line.includes(run.id))), 'surfaced: log contains prune list')
  } finally {
    fixture.close()
  }
}

async function runRecurrenceFixture(root) {
  mkdirSync(root, { recursive: true })
  const fixture = openFixture(root)
  try {
    const faultRun = await fixture.createRun({ ...terminalRun('workspace-a', 1, true), fault: true })
    await createRuns(fixture, 26, (index) => terminalRun('workspace-a', 100 + index, true))

    const result = await fixture.runGc(resolveRetentionConfig({ enabled: true, keepLastNPerWorkspace: KEEP_LAST }), new Set())
    const history = fixture.store.listFaultHistory('workspace-a')
    check(result.prunedRunIds.includes(faultRun.id), 'recurrence: fault-bearing terminal run is selected and pruned')
    check(result.storeRunRowsKept === 1, 'recurrence: fault-bearing run row is retained')
    check(fixture.store.getRun(faultRun.id) !== null, 'recurrence: retained run row remains readable')
    check(!fixture.hasRunDir(faultRun), 'recurrence: fault-bearing local run dir is removed')
    check(fixture.store.listSessions(faultRun.id).length === 0, 'recurrence: heavy session rows are pruned')
    check(fixture.store.listWorkItems(faultRun.id).length === 0, 'recurrence: heavy work item rows are pruned')
    check(fixture.store.listCommitLinks(faultRun.id).length === 0, 'recurrence: heavy commit rows are pruned')
    check(fixture.store.listEvents(faultRun.id).every((event) => event.type === 'fault-triaged'), 'recurrence: only fault events survive')
    check(history.some((fault) => fault.runId === faultRun.id && fault.fingerprint === 'proof-fingerprint'), 'recurrence: listFaultHistory still surfaces the retained fault')
  } finally {
    fixture.close()
  }
}

function openFixture(root) {
  const dbPath = join(root, 'cocoder.db')
  const runsRoot = join(root, 'runs')
  const repos = new Map([['workspace-a', join(root, 'workspace-a')], ['workspace-b', join(root, 'workspace-b')]])
  const logs = []
  let now = 0
  let displayNumber = 1
  const store = openRunStore(dbPath, { now: () => now })

  mkdirSync(runsRoot, { recursive: true })
  for (const [workspaceId, repoPath] of repos.entries()) {
    mkdirSync(repoPath, { recursive: true })
    store.upsertWorkspace({ id: workspaceId, path: repoPath, name: workspaceId })
  }

  return {
    store,
    runsRoot,
    logs,
    close: () => store.close(),
    hasRunDir: (run) => existsSync(localRunDir(runsRoot, run)),
    footprint: () => `${store.listRuns().length}:${countRunDirs(runsRoot)}`,
    createRun: async ({ workspaceId, createdAt, status, projected, fault = false }) => {
      now = createdAt
      const created = store.createRun({ workspaceId, priorityId: 'priority-proof' })
      if (status !== 'running') {
        now = createdAt + 1
        store.setRunStatus(created.id, status)
      }
      now = createdAt + 2
      const session = store.createSession({ runId: created.id, persona: 'bob', sessionRef: `${created.id}-session` })
      const item = store.createWorkItem({ runId: created.id, sourcePersona: 'oscar', targetPersona: 'bob', task: 'retention proof', writeScope: ['packages/**'] })
      store.recordCommitLink({
        runId: created.id,
        workItemId: item.id,
        commitSha: `${created.id.replace('_', '')}${session.id.replaceAll('_', '').slice(0, 6)}`.slice(0, 12),
        message: 'proof commit',
        files: ['packages/core/src/runner/retention.ts'],
      })
      store.recordEvent({ runId: created.id, type: 'proof-event', data: { ok: true } })
      if (fault) {
        store.recordEvent({ runId: created.id, type: 'fault-triaged', data: { fingerprint: 'proof-fingerprint', fault: 'proof-fault', disposition: 'retained' } })
      }

      const run = store.getRun(created.id)
      if (run === null) throw new Error(`created run missing: ${created.id}`)
      mkdirSync(localRunDir(runsRoot, run), { recursive: true })
      writeFileSync(join(localRunDir(runsRoot, run), 'scratch.txt'), `${run.id}\n`)

      if (projected) {
        const repoPath = repos.get(workspaceId)
        if (repoPath === undefined) throw new Error(`workspace repo missing: ${workspaceId}`)
        await writePortableRun(repoPath, { run: { id: run.id, displayNumber }, workspace: { id: workspaceId }, target: { kind: 'priority' }, priorityId: run.priorityId, playbookId: run.playbookId, ticketId: run.ticketId, status: run.status, createdAt: run.createdAt, endedAt: run.endedAt })
      }
      displayNumber += 1
      return run
    },
    runGc: (config, protectedRunIds) =>
      runRetentionGc(
        {
          listAllRuns: () => store.listRuns(),
          isProjectedToRepo: projectionCheckerFor((workspaceId) => repos.get(workspaceId) ?? null),
          pruneRunRows: (runId) => store.pruneRunRows(runId),
          removeRunDir: (runId) => removeLocalRunDir(runsRoot, runId),
          checkpointWal: () => store.checkpointWal(),
          rotateLogs: () => {
            const auditLog = join(root, 'oz-audit.log')
            writeFileSync(auditLog, 'retention proof log\n'.repeat(4), { flag: 'a' })
            rotateLogFile(auditLog, { maxBytes: 1, keep: 2 })
          },
          protectedRunIds,
          log: (message) => logs.push(message),
        },
        config,
      ),
  }
}

async function createRuns(fixture, count, buildInput) {
  const runs = []
  for (let index = 0; index < count; index += 1) runs.push(await fixture.createRun(buildInput(index)))
  return runs
}

function terminalRun(workspaceId, createdAt, projected) {
  return { workspaceId, createdAt, status: 'completed', projected }
}

function checkBulkState(fixture, bulkRuns) {
  const pruned = bulkRuns.slice(0, 5)
  const kept = bulkRuns.slice(5)
  check(pruned.every((run) => fixture.store.getRun(run.id) === null), 'bounded: old bulk store rows removed')
  check(pruned.every((run) => !fixture.hasRunDir(run)), 'bounded: old bulk local dirs removed')
  check(kept.every((run) => fixture.store.getRun(run.id) !== null), 'bounded: newest bulk store rows remain')
  check(kept.every((run) => fixture.hasRunDir(run)), 'bounded: newest bulk local dirs remain')
}

function checkRunsExist(fixture, runs, label) {
  check(runs.every((run) => runExists(fixture, run)), label)
}

function runExists(fixture, run) {
  return fixture.store.getRun(run.id) !== null && fixture.hasRunDir(run)
}

function countExistingDirs(runsRoot, runs) {
  return runs.filter((run) => existsSync(localRunDir(runsRoot, run))).length
}

function countRunDirs(runsRoot) {
  if (!existsSync(runsRoot)) return 0
  let count = 0
  for (const workspace of readdirSync(runsRoot)) {
    const workspaceDir = join(runsRoot, workspace)
    if (!statSync(workspaceDir).isDirectory()) continue
    count += readdirSync(workspaceDir).filter((entry) => statSync(join(workspaceDir, entry)).isDirectory()).length
  }
  return count
}

function localRunDir(runsRoot, run) {
  return join(runsRoot, run.workspaceId, run.id)
}

function ensureTrailingSep(path) {
  return path.endsWith(sep) ? path : `${path}${sep}`
}

function pass(label) {
  console.log(`PASS ${label}`)
}

function check(condition, label, detail = '') {
  if (condition) {
    pass(label)
    return
  }
  fail(label, detail)
}

function fail(label, detail = '') {
  const message = detail === '' ? `FAIL ${label}` : `FAIL ${label}: ${detail}`
  failures.push(message)
  console.log(message)
}
