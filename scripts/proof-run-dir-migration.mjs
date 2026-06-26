#!/usr/bin/env node
// Proof harness — ADR-0027 legacy run-dir migration at daemon startup.
//
//   pnpm proof:run-dir-migration
//
// Uses only a throwaway install root, boots the real daemon createOzServer path, and proves a legacy
// flat local/runs/<runId> dir is moved to local/runs/<workspaceId>/<runId> during startup. Negative
// self-check:
//   PROOF_RUN_DIR_MIGRATION_INJECT_REGRESSION=unregistered pnpm proof:run-dir-migration

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = '@@PROOF_RUN_DIR_MIGRATION@@'

const probe = String.raw`
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { openRunStore } from '@cocoder/core'
import { createOzServer, OZ_CSRF_HEADER } from './packages/daemon/src/index.ts'

const marker = '@@PROOF_RUN_DIR_MIGRATION@@'
const out = (payload) => console.log(marker + JSON.stringify(payload))
async function exists(path) { try { await stat(path); return true } catch { return false } }

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
      writeDebStatus: async () => {}, writeDebTerminalSnapshot: async () => {}, readNudgeRequest: async () => null, writePickup: async (dir) => join(dir, 'pickup.md'),
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
  const temp = await mkdtemp(join(tmpdir(), 'cocoder-proof-run-dir-migration-'))
  let oz = null, store = null
  try {
    const install = join(temp, 'install')
    const workspace = join(temp, 'workspace')
    const local = join(install, 'local')
    const runsRoot = join(local, 'runs')
    await mkdir(local, { recursive: true })
    await mkdir(workspace, { recursive: true })

    let now = 1_800_000_000_000
    store = openRunStore(join(local, 'proof.db'), { now: () => now += 1_000 })
    store.upsertWorkspace({ id: 'cocoder', path: workspace, name: 'CoCoder' })

    const regressionMode = process.env.PROOF_RUN_DIR_MIGRATION_INJECT_REGRESSION ?? ''
    if (regressionMode !== '' && regressionMode !== 'unregistered') throw new Error('unknown PROOF_RUN_DIR_MIGRATION_INJECT_REGRESSION value: ' + regressionMode)
    const injected = regressionMode === 'unregistered'
    const run = injected ? { id: 'run_unregistered', workspaceId: 'cocoder' } : store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    if (!injected) store.setRunStatus(run.id, 'completed')

    const flatDir = join(runsRoot, run.id)
    const nestedDir = join(runsRoot, 'cocoder', run.id)
    const contents = JSON.stringify({ proof: 'legacy-flat-run-dir-migration', runId: run.id }) + '\n'
    await mkdir(flatDir, { recursive: true })
    await writeFile(join(flatDir, 'state.json'), contents, 'utf8')

    const controlled = controlledIO()
    oz = await createOzServer({
      cocoderHome: install,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(),
      getAdapter: () => okAdapter,
      io: controlled.io,
      runHeadless: async () => ({ exitCode: 0, output: '' }),
      restartDaemon: () => {},
    })

    const nestedFile = join(nestedDir, 'state.json')
    const flatFile = join(flatDir, 'state.json')
    const event = store.listEvents(run.id).find((item) => item.type === 'run-dir-migrated') ?? null
    const health = await call(oz, 'GET', '/health')
    const model = {
      tempRoot: temp, tempRootRemoved: false, injected,
      run: { id: run.id, workspaceId: run.workspaceId, registered: !injected },
      paths: {
        flatDir: relative(temp, flatDir), nestedDir: relative(temp, nestedDir),
        flatFile: relative(temp, flatFile), nestedFile: relative(temp, nestedFile),
      },
      files: {
        flatExists: await exists(flatFile),
        nestedExists: await exists(nestedFile),
        nestedContents: await readFile(nestedFile, 'utf8').catch(() => null),
      },
      event: event === null ? null : { type: event.type, data: event.data },
      health: { status: health.status, sha: health.json?.sha ?? null },
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
function verify(m) {
  assert(m.health.status === 200, `real daemon did not boot successfully: /health returned ${m.health.status}`)
  assert(m.files.nestedExists && m.files.nestedContents?.includes(m.run.id), `nested state file missing or wrong at ${m.paths.nestedFile}`)
  assert(!m.files.flatExists, `legacy flat state file still exists at ${m.paths.flatFile}`)
  assert(m.event?.type === 'run-dir-migrated', `run-dir-migrated event was not recorded for ${m.run.id}`)
  assert(m.event.data?.from?.endsWith(m.paths.flatDir) && m.event.data?.to?.endsWith(m.paths.nestedDir), `migration event paths did not match flat->nested: ${JSON.stringify(m.event.data)}`)
}
function report(m) {
  console.log('Proof — run-dir migration at daemon startup')
  console.log(`Temp install/workspace: ${m.tempRoot} (${m.tempRootRemoved ? 'removed after probe' : 'not removed'})`)
  if (m.injected) console.log('Regression injection: unregistered')
  console.log('\nOBJECTIVE -> EVIDENCE')
  console.log(`PASS Boot path: createOzServer responded /health ${m.health.status} for registered run ${m.run.id}.`)
  console.log(`PASS Flat -> nested move: ${m.paths.flatFile} removed, ${m.paths.nestedFile} exists with original contents.`)
  console.log(`PASS Event recorded: ${m.event.type} from ${m.event.data.from} to ${m.event.data.to}.`)
}

try {
  const model = await loadModel()
  verify(model)
  report(model)
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
