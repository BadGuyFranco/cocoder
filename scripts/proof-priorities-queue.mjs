#!/usr/bin/env node
// Proof harness — Oz dashboard priorities queue.
//
//   pnpm proof:queue
//
// Loads this install's real workspace registry, cocoder/priorities files, optional order.json, and
// local run store through the same daemon reader + UI adapter functions used by the dashboard data path.
// It never starts/stops the daemon, opens the app, launches a browser, or binds a server.
//
// Negative self-checks for maintainers:
//   PROOF_QUEUE_INJECT_REGRESSION=runs pnpm proof:queue
//   PROOF_QUEUE_INJECT_REGRESSION=misorder pnpm proof:queue

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE_ID = 'cocoder'
const ADHOC_ID = 'adhoc-session'

const probe = `
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openRunStore } from '@cocoder/core'
import { readPriorities } from './packages/daemon/src/priority-order.ts'
import { findWorkspace, workspaceFilePath } from './packages/daemon/src/registry.ts'
import { ADHOC_PRIORITY_ID, adaptPriorities, adaptRuns } from './packages/ui/src/renderer/adapter.ts'

const repoRoot = ${JSON.stringify(repoRoot)}
const workspaceId = ${JSON.stringify(WORKSPACE_ID)}
const priorityCap = 50_000

function fail(message) {
  console.log('@@PROOF_QUEUE@@' + JSON.stringify({ ok: false, message }))
  process.exit(0)
}

async function main() {
  const workspace = await findWorkspace(repoRoot, workspaceId)
  if (!workspace) fail(\`workspace "\${workspaceId}" was not found in the local registry\`)

  const workspaceFile = workspaceFilePath(repoRoot, workspaceId)
  const registrySource = existsSync(workspaceFile) ? workspaceFile : join(repoRoot, 'local', 'workspaces.json')
  const priorityDir = join(workspace.path, 'cocoder', 'priorities')
  const orderPath = join(priorityDir, 'order.json')
  let orderIds = []
  let orderExists = false
  try {
    const parsed = JSON.parse(await readFile(orderPath, 'utf8'))
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) fail(\`\${orderPath} is not a JSON string array\`)
    orderIds = parsed
    orderExists = true
  } catch (err) {
    if (err && typeof err === 'object' && err.code !== 'ENOENT') fail(\`could not read \${orderPath}: \${err.message ?? String(err)}\`)
  }

  const daemonPriorities = await readPriorities(priorityDir, priorityCap)
  const priorityNames = Object.fromEntries(daemonPriorities.map((priority) => [priority.id, priority.title]))
  const store = openRunStore(join(repoRoot, 'local', 'cocoder.db'))
  const rawRuns = store.listRuns({ workspaceId })
  store.close()
  const daemonRuns = rawRuns.map((run) => ({
    id: run.id,
    workspaceId: run.workspaceId,
    priorityId: run.priorityId,
    status: run.status,
    integrationStatus: run.integrationStatus,
    createdAt: run.createdAt,
    endedAt: run.endedAt,
  }))
  const runs = adaptRuns(daemonRuns, priorityNames)
  const priorities = adaptPriorities(daemonPriorities.map((priority) => ({
    id: priority.id,
    title: priority.title,
    scopeNarrowing: priority.scopeNarrowing,
    goal: priority.goal,
  })), runs)
  const primaryItems = [
    { kind: 'adhoc', id: ADHOC_PRIORITY_ID, label: 'Ad-hoc' },
    ...priorities.map((priority) => ({ kind: 'priority', id: priority.id, label: priority.name, runId: priority.runId ?? null, status: priority.status })),
  ]

  console.log('@@PROOF_QUEUE@@' + JSON.stringify({
    ok: true,
    workspace,
    registrySource,
    priorityDir,
    orderPath,
    orderExists,
    orderIds,
    daemonPriorities,
    rawRuns: daemonRuns,
    runs,
    priorities,
    primaryItems,
  }))
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
`

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function loadModel() {
  const { stdout } = await exec('pnpm', ['exec', 'tsx', '--eval', probe], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('@@PROOF_QUEUE@@'))
  if (!line) throw new Error('probe did not return a proof payload')
  const payload = JSON.parse(line.slice('@@PROOF_QUEUE@@'.length))
  if (!payload.ok) throw new Error(payload.message)
  return payload
}

function expectedPriorityIds(model) {
  return model.daemonPriorities
    .filter((priority) => priority.id !== ADHOC_ID)
    .map((priority) => priority.id)
}

function applyRegressionInjection(model) {
  const mode = process.env.PROOF_QUEUE_INJECT_REGRESSION ?? ''
  if (mode === '') return { mode, model }
  if (mode === 'runs') {
    return {
      mode,
      model: {
        ...model,
        primaryItems: [
          ...model.runs.filter((run) => run.status === 'blocked' || run.status === 'not-landed').slice(0, 2).map((run) => ({ kind: 'run', id: run.id, label: run.title })),
          ...model.primaryItems,
        ],
      },
    }
  }
  if (mode === 'misorder') {
    const adhoc = model.primaryItems.find((item) => item.kind === 'adhoc')
    const priorities = model.primaryItems.filter((item) => item.kind === 'priority').toReversed()
    return { mode, model: { ...model, primaryItems: adhoc ? [adhoc, ...priorities] : priorities } }
  }
  throw new Error(`unknown PROOF_QUEUE_INJECT_REGRESSION value: ${mode}`)
}

function verify(model) {
  assert(model.primaryItems.length > 0, 'primary queue is empty')
  const runItems = model.primaryItems.filter((item) => item.kind === 'run')
  assert(runItems.length === 0, `run emitted as a primary queue item: ${runItems.map((item) => item.id).join(', ')}`)
  assert(model.primaryItems[0]?.kind === 'adhoc', 'ad-hoc row is not pinned first')
  assert(model.primaryItems[0]?.id === ADHOC_ID, `first primary item is ${model.primaryItems[0]?.id ?? 'missing'}, not ${ADHOC_ID}`)

  const priorityItems = model.primaryItems.filter((item) => item.kind === 'priority')
  assert(priorityItems.length > 0, 'no priorities were emitted after the pinned ad-hoc row')
  const runIds = new Set(model.runs.map((run) => run.id))
  const runIdCollisions = priorityItems.filter((item) => runIds.has(item.id)).map((item) => item.id)
  assert(runIdCollisions.length === 0, `priority queue item id collides with run id(s): ${runIdCollisions.join(', ')}`)

  const actualIds = priorityItems.map((item) => item.id)
  const expectedIds = expectedPriorityIds(model)
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), `priority order mismatch: expected ${expectedIds.join(' -> ')}, got ${actualIds.join(' -> ')}`)

  if (model.orderExists) {
    const knownManifestIds = model.orderIds.filter((id) => expectedIds.includes(id) && id !== ADHOC_ID)
    const actualManifestPrefix = actualIds.slice(0, knownManifestIds.length)
    assert(JSON.stringify(actualManifestPrefix) === JSON.stringify(knownManifestIds), `order.json was not honored: expected manifest prefix ${knownManifestIds.join(' -> ')}, got ${actualManifestPrefix.join(' -> ')}`)
  }
}

function printReport(model, injectionMode) {
  console.log('Proof — Oz dashboard priorities queue')
  console.log(`Workspace: ${model.workspace.id} (${model.workspace.path})`)
  console.log(`Workspace registry source: ${model.registrySource}`)
  console.log(`Priorities source path: ${model.priorityDir}`)
  console.log(`Order manifest: ${model.orderPath} ${model.orderExists ? `(${model.orderIds.length} ids)` : '(absent; daemon fallback order)'}`)
  if (injectionMode) console.log(`Regression injection: ${injectionMode}`)
  console.log('')
  console.log('Primary column queue model:')
  for (const [index, item] of model.primaryItems.entries()) {
    if (item.kind === 'adhoc') {
      console.log(`  ${String(index + 1).padStart(2, '0')}. [pinned] ${item.label}`)
    } else {
      const attached = item.runId ? ` (inline run: ${item.runId}, ${item.status})` : ''
      console.log(`  ${String(index + 1).padStart(2, '0')}. ${item.label} [${item.id}]${attached}`)
    }
  }
  console.log('')
  console.log(`Runs read from store: ${model.runs.length}; primary queue run items: ${model.primaryItems.filter((item) => item.kind === 'run').length}`)
  console.log(`PASS: primary column is Ad-hoc + ${model.primaryItems.filter((item) => item.kind === 'priority').length} ordered priorities; no runs are primary queue items.`)
}

try {
  const loaded = await loadModel()
  const { mode, model } = applyRegressionInjection(loaded)
  verify(model)
  printReport(model, mode)
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
