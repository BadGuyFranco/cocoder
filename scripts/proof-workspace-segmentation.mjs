#!/usr/bin/env node
// Proof harness — workspace segmentation.
//
//   pnpm proof:workspace-segmentation
//
// Uses only throwaway install/workspace roots, drives real core portable APIs and daemon routes, and
// prints an objective -> evidence map. Negative self-check:
//   PROOF_WORKSPACE_SEGMENTATION_INJECT_REGRESSION=display-number pnpm proof:workspace-segmentation

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = '@@PROOF_WORKSPACE_SEGMENTATION@@'

const probe = String.raw`
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { groupLabel, migrateWorkspacePortableHistory, openRunStore, readPortableRunById, recordPortableRunCreation } from '@cocoder/core'
import { createOzServer, OZ_CSRF_HEADER } from './packages/daemon/src/index.ts'

const marker = '@@PROOF_WORKSPACE_SEGMENTATION@@'
const json = (path) => readFile(path, 'utf8').then(JSON.parse)
const out = (payload) => console.log(marker + JSON.stringify(payload))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function exists(path) { try { await stat(path); return true } catch { return false } }
async function waitFor(name, fn) { for (let i = 0; i < 80; i += 1) { if (await fn()) return; await sleep(10) } throw new Error('timed out waiting for ' + name) }
async function tree(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((err) => err?.code === 'ENOENT' ? [] : Promise.reject(err))
  const rows = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) rows.push(...await tree(root, path))
    else if (entry.isFile()) rows.push({ path: relative(root, path), contents: await readFile(path, 'utf8') })
  }
  return rows
}

async function writeWorkspace(root, label) {
  const id = label.toLowerCase()
  const files = [
    ['cocoder/priorities/demo.md', ['---', 'id: demo', 'title: Demo', '---', '## Objective', 'Do the thing.', ''].join('\n')],
    ['cocoder/tickets/INDEX.md', ['# Tickets - Index', '', '## Open', '', '| ID | Title | Type | Priority | Owner |', '|---|---|---|---|---|', '| [0001](./open/0001-proof.md) | Proof ticket | task | none | proof |', ''].join('\n')],
    ['cocoder/tickets/open/0001-proof.md', ['---', 'id: 0001', 'title: Proof ticket', 'type: task', 'status: Open', 'priority: none', 'owner: proof', 'created: 2026-06-18', '---', '', '# 0001 - Proof ticket', ''].join('\n')],
    ['cocoder/personas/oscar.md', ['---', 'id: oscar', 'label: Orchestrator', 'role: orchestrator', 'writeScope: []', '---', 'Oscar', ''].join('\n')],
    ['cocoder/personas/bob.md', ['---', 'id: bob', 'label: Builder', 'role: builder', 'writeScope:', '  - packages/**', '---', 'Bob', ''].join('\n')],
    ['cocoder/personas/assignments.json', JSON.stringify({ personas: { oscar: { cli: 'claude', model: '' }, bob: { cli: 'codex', model: '' } } }, null, 2) + '\n'],
    ['packages/.gitkeep', ''],
  ]
  for (const [file, contents] of files) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), contents, 'utf8')
  }
  return { id, name: label + ' Workspace', path: root }
}

function fakeGit() {
  let n = 0
  return {
    headSha: async () => 'h0', changedFiles: async () => [], addAndCommit: async () => 'sha-proof-' + ++n,
    restoreToHead: async () => {}, show: async () => 'diff', worktreeAdd: async () => {}, worktreeRemove: async () => {},
    listWorktrees: async () => [], isAncestor: async () => true, mergeFastForwardOnly: async () => 'merged',
    unmergedCommits: async () => [], mergeInto: async () => 'clean', conflictedFiles: async () => [],
    completeMerge: async () => {}, abortMerge: async () => {}, currentBranch: async () => 'trunk', resetHard: async () => {},
    hasUpstream: async () => false, push: async () => ({ ok: true, detail: 'not pushed in proof' }),
  }
}

const okAdapter = {
  id: 'proof', runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'proof adapter' },
  headlessCapable: false, build: () => ({ command: 'proof', args: [] }),
  preflight: async () => ({ ok: true, checks: [{ name: 'installed', ok: true, detail: 'proof' }] }),
  listModels: async () => ({ canEnumerate: false, models: [], detail: 'proof adapter' }),
}
function fakeHost() {
  let n = 0
  return {
    spawn: async () => ({ id: 'surface:' + ++n, driver: 'fake' }), readScreen: async () => '',
    status: async () => ({ state: 'exited', code: 0 }), waitForExit: async () => ({ state: 'exited', code: 0 }),
    sendInput: async () => {}, show: async () => {}, kill: async () => {}, closeSurface: async () => {}, closeWorkspace: async () => {},
  }
}
function controlledIO() {
  let release = () => {}
  const released = new Promise((resolve) => { release = resolve })
  return {
    io: {
      ensureRunDir: (dir) => mkdir(dir, { recursive: true }), awaitDirective: async () => { await released; return { kind: 'wrapup', pickup: 'nothing further this run' } },
      awaitVerification: async () => ({ verdict: 'pass', reason: 'verified' }), awaitTriage: async () => ({ disposition: 'one-off', summary: 'n/a', mode: 'propose' }),
      writeFaultContext: (path, ctx) => writeFile(path, JSON.stringify(ctx, null, 2), 'utf8'), writeDisposition: async (dir, i) => join(dir, 'disposition-' + i + '.md'),
      writeDebStatus: async () => {}, readNudgeRequest: async () => null, writePickup: async (dir) => join(dir, 'pickup.md'),
      writeRunArtifact: async (dir, file, contents) => { await mkdir(dir, { recursive: true }); const path = join(dir, file); await writeFile(path, contents, 'utf8'); return path },
      writeRunRecord: async (dir) => join(dir, 'record.md'),
    },
    release,
  }
}
function call(oz, method, path, body) {
  const headers = { authorization: 'Bearer ' + oz.token, [OZ_CSRF_HEADER]: oz.csrfToken }
  if (body) headers['content-type'] = 'application/json'
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: oz.port, path, method, headers }, (res) => {
      let data = ''; res.on('data', (chunk) => { data += chunk }); res.on('end', () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }))
    })
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined)
  })
}

async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'cocoder-proof-workspace-segmentation-'))
  let oz = null, store = null
  try {
    const install = join(temp, 'install'), roots = { alpha: join(temp, 'alpha'), beta: join(temp, 'beta'), backfill: join(temp, 'backfill') }
    await mkdir(join(install, 'local'), { recursive: true })
    const alpha = await writeWorkspace(roots.alpha, 'Alpha'), beta = await writeWorkspace(roots.beta, 'Beta'), backfill = await writeWorkspace(roots.backfill, 'Backfill')
    await writeFile(join(install, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [alpha, beta, backfill] }, null, 2) + '\n', 'utf8')

    let now = 1_800_000_000_000
    store = openRunStore(join(install, 'local', 'proof.db'), { now: () => now += 1_000 })
    for (const ws of [alpha, beta, backfill]) store.upsertWorkspace(ws)

    const aSeed = store.createRun({ workspaceId: alpha.id, priorityId: 'demo' }), bSeed = store.createRun({ workspaceId: beta.id, priorityId: 'demo' })
    const aDisplay = await recordPortableRunCreation({ primaryRoot: alpha.path, workspace: alpha, run: aSeed })
    const bDisplay = await recordPortableRunCreation({ primaryRoot: beta.path, workspace: beta, run: bSeed })
    const aSeedFile = await readPortableRunById(alpha.path, aSeed.id), bSeedFile = await readPortableRunById(beta.path, bSeed.id)
    const aCounters = await json(join(alpha.path, 'cocoder', 'counters.json')), bCounters = await json(join(beta.path, 'cocoder', 'counters.json'))

    const backRun = store.createRun({ workspaceId: backfill.id, priorityId: 'demo' })
    const session = store.createSession({ runId: backRun.id, persona: 'oscar', sessionRef: 'surface:backfill' }); store.setSessionExit(session.id, 0)
    const item = store.createWorkItem({ runId: backRun.id, sourcePersona: 'oscar', targetPersona: 'bob', task: 'prove backfill', writeScope: ['packages/**'] })
    store.setWorkItemStatus(item.id, 'done')
    store.recordCommitLink({ runId: backRun.id, workItemId: item.id, commitSha: 'sha-backfill', message: 'proof commit', files: ['packages/proof.ts'] })
    store.recordEvent({ runId: backRun.id, type: 'proof-event', data: { ok: true } }); store.setRunStatus(backRun.id, 'completed')
    const migrated = await migrateWorkspacePortableHistory({ primaryRoot: backfill.path, workspace: backfill, store })
    const firstTree = await tree(join(backfill.path, 'cocoder'))
    const migratedAgain = await migrateWorkspacePortableHistory({ primaryRoot: backfill.path, workspace: backfill, store })
    const backFile = await readPortableRunById(backfill.path, backRun.id), backDir = join(backfill.path, 'cocoder', 'runs', '1-' + backRun.id)
    const fileExists = Object.fromEntries(await Promise.all(['run.json', 'sessions.jsonl', 'work-items.jsonl', 'commits.jsonl', 'events.jsonl'].map(async (f) => [f, await exists(join(backDir, f))])))
    const empty = openRunStore(':memory:'), emptyDbHasRun = empty.getRun(backRun.id) !== null; empty.close()

    const controlled = controlledIO()
    oz = await createOzServer({ cocoderHome: install, port: 0, store, git: fakeGit(), sessionHost: fakeHost(), getAdapter: () => okAdapter, io: controlled.io, runHeadless: async () => ({ exitCode: 0, output: 'wrap closeout' }), restartDaemon: () => {} })
    const events = [], unsub = oz.ctx.events.subscribe((event) => events.push(event))
    let aLaunch, bLaunch, duplicate, aDetail, bDetail, aLock = false, bLock = false
    try {
      ;[aLaunch, bLaunch] = await Promise.all([call(oz, 'POST', '/runs', { workspaceId: alpha.id, priorityId: 'demo' }), call(oz, 'POST', '/runs', { workspaceId: beta.id, priorityId: 'demo' })])
      aLock = oz.ctx.inFlight.get(alpha.id) === aLaunch.json?.runId; bLock = oz.ctx.inFlight.get(beta.id) === bLaunch.json?.runId
      duplicate = await call(oz, 'POST', '/runs', { workspaceId: alpha.id, priorityId: 'demo' })
      await waitFor('run-start events', () => store.listEvents(aLaunch.json.runId).some((e) => e.type === 'run-start') && store.listEvents(bLaunch.json.runId).some((e) => e.type === 'run-start'))
      controlled.release()
      await waitFor('settled runs', () => !oz.ctx.inFlight.has(alpha.id) && !oz.ctx.inFlight.has(beta.id))
      aDetail = await call(oz, 'GET', '/runs/' + aLaunch.json.runId); bDetail = await call(oz, 'GET', '/runs/' + bLaunch.json.runId)
    } finally { unsub() }

    const aPortable = await readPortableRunById(alpha.path, aLaunch.json.runId), bPortable = await readPortableRunById(beta.path, bLaunch.json.runId)
    const aRunDir = join(install, 'local', 'runs', aLaunch.json.runId), bRunDir = join(install, 'local', 'runs', bLaunch.json.runId)
    const model = {
      tempRoot: temp, tempRootRemoved: false,
      obj3: { aRun: aSeed.id, bRun: bSeed.id, aDisplay, bDisplay, aPortableDisplay: aSeedFile?.run.displayNumber ?? null, bPortableDisplay: bSeedFile?.run.displayNumber ?? null, aNext: aCounters.nextRunDisplayNumber, bNext: bCounters.nextRunDisplayNumber, aCounter: relative(temp, join(alpha.path, 'cocoder', 'counters.json')), bCounter: relative(temp, join(beta.path, 'cocoder', 'counters.json')), aGov: [relative(temp, join(alpha.path, 'cocoder', 'priorities', 'demo.md')), relative(temp, join(alpha.path, 'cocoder', 'tickets', 'open', '0001-proof.md'))], bGov: [relative(temp, join(beta.path, 'cocoder', 'priorities', 'demo.md')), relative(temp, join(beta.path, 'cocoder', 'tickets', 'open', '0001-proof.md'))] },
      obj4: { run: backRun.id, dir: relative(temp, backDir), migrated, migratedAgain, treeUnchanged: JSON.stringify(firstTree) === JSON.stringify(await tree(join(backfill.path, 'cocoder'))), fileExists, status: backFile?.status ?? null, display: backFile?.run.displayNumber ?? null },
      obj5: { run: backRun.id, emptyDbHasRun, portableRun: backFile?.run.id ?? null, priority: backFile?.priorityId ?? null, target: backFile?.target.kind ?? null, status: backFile?.status ?? null },
      obj6: { aStatus: aLaunch.status, bStatus: bLaunch.status, dupStatus: duplicate.status, aRun: aLaunch.json?.runId ?? null, bRun: bLaunch.json?.runId ?? null, aLock, bLock, aDir: relative(temp, aRunDir), bDir: relative(temp, bRunDir), aDirExists: await exists(aRunDir), bDirExists: await exists(bRunDir), aWorkspace: aPortable?.workspace.id ?? null, bWorkspace: bPortable?.workspace.id ?? null, aDisplay: aPortable?.run.displayNumber ?? null, bDisplay: bPortable?.run.displayNumber ?? null, aDetail: aDetail.status, bDetail: bDetail.status, aRunStatus: aDetail.json?.run?.status ?? null, bRunStatus: bDetail.json?.run?.status ?? null, aCross: await exists(join(alpha.path, 'cocoder', 'runs', (bPortable?.run.displayNumber ?? 0) + '-' + bLaunch.json.runId, 'run.json')), bCross: await exists(join(beta.path, 'cocoder', 'runs', (aPortable?.run.displayNumber ?? 0) + '-' + aLaunch.json.runId, 'run.json')), events: events.map((e) => ({ type: e.type, workspaceId: e.workspaceId, runId: e.runId, status: e.status })) },
      obj7: { label: groupLabel({ workspaceName: alpha.name, target: { type: 'ticket', slug: '0001-proof' }, runId: 'run_42' }), workspace: alpha.name, type: 'ticket', slug: '0001-proof', run: '#42' },
    }
    await oz.close(); oz = null; store = null; out({ ok: true, model })
  } finally {
    try { if (oz) await oz.close(); else if (store) store.close() } finally { await rm(temp, { recursive: true, force: true }) }
  }
}
main().catch((err) => out({ ok: false, message: err instanceof Error ? err.message : String(err) }))
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
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(MARKER))
  if (!line) throw new Error('probe did not return a proof payload')
  const payload = JSON.parse(line.slice(MARKER.length))
  if (!payload.ok) throw new Error(payload.message)
  return { ...payload.model, tempRootRemoved: true }
}
function inject(model) {
  const mode = process.env.PROOF_WORKSPACE_SEGMENTATION_INJECT_REGRESSION ?? ''
  if (mode === '') return { mode, model }
  if (mode === 'display-number') return { mode, model: { ...model, obj3: { ...model.obj3, bDisplay: 2 } } }
  throw new Error(`unknown PROOF_WORKSPACE_SEGMENTATION_INJECT_REGRESSION value: ${mode}`)
}
function verify(m) {
  assert(m.obj3.aDisplay === 1 && m.obj3.bDisplay === 1, `beta display number is ${m.obj3.bDisplay}, not 1`)
  assert(m.obj3.aPortableDisplay === 1 && m.obj3.bPortableDisplay === 1, 'portable seed run.json display numbers did not round-trip')
  assert(m.obj3.aNext === 2 && m.obj3.bNext === 2 && m.obj3.aCounter !== m.obj3.bCounter, 'workspace counters are not independent')
  assert(m.obj4.migrated.runsExported === 1 && m.obj4.migrated.sessionsExported === 1, 'first migration did not export one run and one session')
  assert(m.obj4.migratedAgain.runsExported === 0 && m.obj4.migratedAgain.sessionsExported === 0 && m.obj4.treeUnchanged, 'second migration was not idempotent')
  for (const [file, present] of Object.entries(m.obj4.fileExists)) assert(present, `missing portable history file: ${file}`)
  assert(m.obj4.status === 'completed' && m.obj4.display === 1, 'backfilled portable run did not read back completed with display #1')
  assert(!m.obj5.emptyDbHasRun && m.obj5.portableRun === m.obj5.run && m.obj5.priority === 'demo' && m.obj5.target === 'priority' && m.obj5.status === 'completed', 'portable run.json did not prove DB-independent identity/target/status')
  assert(m.obj6.aStatus === 202 && m.obj6.bStatus === 202 && m.obj6.dupStatus === 409, 'daemon launch statuses did not prove workspace-scoped locking')
  assert(m.obj6.aRun && m.obj6.bRun && m.obj6.aRun !== m.obj6.bRun && m.obj6.aLock && m.obj6.bLock, 'independent in-flight locks were not held')
  assert(m.obj6.aDir !== m.obj6.bDir && m.obj6.aDirExists && m.obj6.bDirExists, 'daemon run dirs were not separate')
  assert(m.obj6.aWorkspace === 'alpha' && m.obj6.bWorkspace === 'beta' && m.obj6.aDisplay === 2 && m.obj6.bDisplay === 2, 'portable daemon run trees were not workspace-local')
  assert(m.obj6.aDetail === 200 && m.obj6.bDetail === 200 && m.obj6.aRunStatus === 'completed' && m.obj6.bRunStatus === 'completed', 'daemon read routes did not return completed details')
  assert(!m.obj6.aCross && !m.obj6.bCross, 'portable run trees cross-contaminated')
  assert(m.obj7.label.includes(m.obj7.workspace) && m.obj7.label.includes(m.obj7.type) && m.obj7.label.includes(m.obj7.slug) && m.obj7.label.includes(m.obj7.run), 'groupLabel omitted required identity parts')
}
function report(m, mode) {
  console.log('Proof — workspace segmentation')
  console.log(`Temp install/workspaces: ${m.tempRoot} (${m.tempRootRemoved ? 'removed after probe' : 'not removed'})`)
  if (mode) console.log(`Regression injection: ${mode}`)
  console.log('\nOBJECTIVE -> EVIDENCE')
  console.log(`PASS Obj 3 + 8: alpha run ${m.obj3.aRun} display #${m.obj3.aDisplay} from ${m.obj3.aCounter}; beta run ${m.obj3.bRun} display #${m.obj3.bDisplay} from ${m.obj3.bCounter}. Priorities/tickets are workspace-local: ${m.obj3.aGov.join(', ')}; ${m.obj3.bGov.join(', ')}.`)
  console.log(`PASS Obj 4: DB-only run ${m.obj4.run} backfilled to ${m.obj4.dir}/{run.json,sessions.jsonl,work-items.jsonl,commits.jsonl,events.jsonl}; first migration exported ${m.obj4.migrated.runsExported}/${m.obj4.migrated.sessionsExported}, second exported ${m.obj4.migratedAgain.runsExported}/${m.obj4.migratedAgain.sessionsExported}, tree unchanged.`)
  console.log(`PASS Obj 5: portable run.json round-tripped run ${m.obj5.portableRun} target ${m.obj5.target}:${m.obj5.priority} status ${m.obj5.status} while empty DB lookup returned ${m.obj5.emptyDbHasRun}.`)
  console.log(`PASS Obj 6: daemon held locks for ${m.obj6.aRun}/${m.obj6.bRun}, duplicate same-workspace launch returned ${m.obj6.dupStatus}, separate run dirs ${m.obj6.aDir} and ${m.obj6.bDir}, daemon GET /runs/:id returned ${m.obj6.aRunStatus}/${m.obj6.bRunStatus}, portable displays #${m.obj6.aDisplay}/#${m.obj6.bDisplay} with no cross-contamination.`)
  console.log(`PASS Obj 7: groupLabel() => "${m.obj7.label}" contains workspace "${m.obj7.workspace}", target "${m.obj7.type}:${m.obj7.slug}", and run identity "${m.obj7.run}".`)
  console.log('FOUNDER-EYEBALL Obj 1: visual Oz/workspace split, wider panel, and Oz controls live in packages/ui/app/sections/dashboard/Dashboard.tsx plus the terminal/Oz chat area; inspect that dashboard view. Machine-checkable portions were covered in run_136 UI tests: packages/ui/tests/app.test.tsx, packages/ui/tests/live-app.test.tsx, packages/ui/tests/dashboard-awaiting.test.tsx.')
  console.log('FOUNDER-EYEBALL Obj 2: chat target picker and global Oz behavior live in packages/ui/app/sections/dashboard/OzChat.tsx and packages/ui/app/App.tsx; inspect the dashboard chat target picker. Machine-checkable portions were covered in run_136 UI tests: packages/ui/tests/ozchat.test.tsx, packages/ui/tests/live-app.test.tsx.')
}

try {
  const { mode, model } = inject(await loadModel())
  verify(model)
  report(model, mode)
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
