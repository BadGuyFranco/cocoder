#!/usr/bin/env node
// Live proof for daemon auto-reload. It uses an isolated temp install and port, launches the real
// daemon, lets a real run commit a daemon route, then waits for the daemon's own reload to serve it.
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { prepareProofInstall } from './proof-daemon-reload-fixture.mjs'

const execFileAsync = promisify(execFile)
const SCRIPT = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(SCRIPT), '..')
const WALL_CLOCK_MS = 180_000
const PROOF_ROUTE = '/proof/daemon-reload'

let tempRoot = ''
let port = 0
let failReason = null
let proofRunId = null
let proofBearerToken = null

const startedAt = Date.now()
const deadline = startedAt + WALL_CLOCK_MS

try {
  port = await freeProofPort()
  tempRoot = await mkdtemp(join(tmpdir(), 'cocoder-daemon-reload-proof-'))
  await prepareProofInstall(tempRoot, ROOT)
  await git(tempRoot, ['init', '-q', '-b', 'trunk'])
  await git(tempRoot, ['config', 'user.email', 'proof@cocoder.local'])
  await git(tempRoot, ['config', 'user.name', 'CoCoder Proof'])
  await git(tempRoot, ['add', '-A'])
  await git(tempRoot, ['commit', '-q', '-m', 'proof fixture initial'])

  const env = proofEnv(tempRoot, port)
  await runOz(tempRoot, env, 'start')
  const firstHealth = await waitForJson(`http://127.0.0.1:${port}/health`, { label: 'initial /health' })
  const bootSha = stringField(firstHealth, 'sha')
  if (!bootSha) throw new Error('initial /health did not include a sha')
  const session = await waitForJson(`http://127.0.0.1:${port}/auth/session`, { label: '/auth/session' })
  const bearerToken = stringField(session, 'bearerToken')
  const csrfToken = stringField(session, 'csrfToken')
  if (!bearerToken || !csrfToken) throw new Error('/auth/session did not return bearerToken and csrfToken')

  const launch = await postJson(`http://127.0.0.1:${port}/runs`, {
    workspaceId: 'cocoder',
    priorityId: 'daemon-reload-proof',
  }, bearerToken, csrfToken)
  if (launch.status !== 202) throw new Error(`POST /runs returned ${launch.status}: ${JSON.stringify(launch.body)}`)
  const runId = stringField(launch.body, 'runId')
  if (!runId) throw new Error(`POST /runs did not return a runId: ${JSON.stringify(launch.body)}`)
  proofRunId = runId
  proofBearerToken = bearerToken

  await waitForRunCompleted(runId, bearerToken)
  const proof = await waitForProofRoute(bootSha)
  const proofSha = stringField(proof.health, 'sha')
  console.log(`PROOF PASS: isolated daemon on :${port} reloaded from ${bootSha.slice(0, 8)} to ${proofSha?.slice(0, 8) ?? 'unknown'} and served ${PROOF_ROUTE} for ${runId}.`)
  process.exitCode = 0
} catch (err) {
  failReason = err instanceof Error ? err.message : String(err)
  process.exitCode = 1
} finally {
  if (failReason) {
    console.error(`PROOF FAIL: ${failReason}`)
    await printDiagnostics()
  }
  if (tempRoot) {
    try {
      if (port) await runOz(tempRoot, proofEnv(tempRoot, port), 'stop', { force: true, tolerateFailure: true })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  }
}

function proofEnv(home, ozPort) {
  return {
    ...process.env,
    COCODER_OZ_PORT: String(ozPort),
    OZ_OPEN: '0',
    PATH: `${join(home, 'fake-bin')}:${process.env.PATH ?? ''}`,
  }
}

async function runOz(home, env, command, opts = {}) {
  const result = await execFileAsync('bash', ['scripts/oz.sh', command], {
    cwd: home,
    env: opts.force ? { ...env, FORCE: '1' } : env,
    timeout: 30_000,
  }).catch((error) => {
    if (opts.tolerateFailure) return { stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
    throw new Error(`scripts/oz.sh ${command} failed: ${(error.stdout ?? '')}${(error.stderr ?? '')}`)
  })
  return `${result.stdout}${result.stderr}`
}

async function waitForRunCompleted(runId, bearerToken) {
  await waitFor(async () => {
    const response = await fetchJson(`http://127.0.0.1:${port}/runs/${runId}`, { bearerToken }).catch(() => null)
    const status = response?.status === 200 && response.body && typeof response.body === 'object'
      ? response.body.run?.status
      : null
    if (status === 'completed') return true
    if (status && status !== 'running') throw new Error(`run ${runId} ended with status ${status}`)
    return false
  }, `run ${runId} to complete`)
}

async function waitForProofRoute(bootSha) {
  let last = ''
  return await waitFor(async () => {
    const health = await fetchJson(`http://127.0.0.1:${port}/health`).catch((err) => {
      last = err.message
      return null
    })
    if (!health || health.status !== 200) return false
    const sha = stringField(health.body, 'sha')
    const proof = await fetchJson(`http://127.0.0.1:${port}${PROOF_ROUTE}`).catch((err) => {
      last = err.message
      return null
    })
    if (proof?.status === 200 && JSON.stringify(proof.body) === JSON.stringify({ ok: true, proof: 'daemon-reload' })) {
      if (sha === bootSha) throw new Error(`${PROOF_ROUTE} was served without a changed boot sha`)
      return { health: health.body, proof: proof.body }
    }
    if (proof) last = `${PROOF_ROUTE} returned ${proof.status}: ${JSON.stringify(proof.body)}`
    return false
  }, `${PROOF_ROUTE} after daemon reload; last=${last}`)
}

async function waitForJson(url, input) {
  return await waitFor(async () => {
    const response = await fetchJson(url).catch(() => null)
    return response?.status === 200 ? response.body : false
  }, input.label)
}

async function postJson(url, body, bearerToken, csrfToken) {
  return await fetchJson(url, {
    method: 'POST',
    bearerToken,
    csrfToken,
    body,
  })
}

async function fetchJson(url, opts = {}) {
  const headers = {}
  if (opts.bearerToken) headers.authorization = `Bearer ${opts.bearerToken}`
  if (opts.csrfToken) headers['x-oz-csrf-token'] = opts.csrfToken
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

async function waitFor(fn, label) {
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await sleep(500)
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function freeProofPort() {
  for (let p = 7900; p <= 7999; p += 1) {
    if (await portAvailable(p)) return p
  }
  throw new Error('no free proof port in 7900-7999')
}

function portAvailable(candidate) {
  return new Promise((resolvePort) => {
    const server = createServer()
    server.once('error', () => resolvePort(false))
    server.listen(candidate, '127.0.0.1', () => {
      server.close(() => resolvePort(true))
    })
  })
}

async function git(cwd, args) {
  await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })
}

function stringField(value, field) {
  return value && typeof value === 'object' && typeof value[field] === 'string' ? value[field] : null
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function printDiagnostics() {
  if (!tempRoot) return
  console.error(`Temp root: ${tempRoot}`)
  console.error(`Port: ${port || '(not allocated)'}`)
  try {
    if (proofRunId && proofBearerToken && port) {
      const detail = await fetchJson(`http://127.0.0.1:${port}/runs/${proofRunId}`, { bearerToken: proofBearerToken }).catch(() => null)
      if (detail) {
        console.error(`Run detail status: HTTP ${detail.status}`)
        const events = detail.body?.events
        if (Array.isArray(events)) {
          console.error('Last run events:')
          for (const event of events.slice(-12)) console.error(JSON.stringify({ type: event.type, data: event.data }))
        }
      }
    }
  } catch (err) {
    console.error(`Run diagnostics failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const audit = await readFile(join(tempRoot, 'local', 'oz-audit.log'), 'utf8')
    console.error('Last oz-audit.log lines:')
    for (const line of audit.trimEnd().split(/\r?\n/).slice(-12)) console.error(line)
  } catch (err) {
    console.error(`No audit diagnostics: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const route = await readFile(join(tempRoot, 'packages', 'daemon', 'src', 'server.ts'), 'utf8')
    console.error(`Proof route present in source: ${route.includes("pathname === '/proof/daemon-reload'")}`)
  } catch (err) {
    console.error(`Route source diagnostics failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const { stdout } = await execFileAsync('git', ['-C', tempRoot, 'log', '--oneline', '--name-only', '-5'], { maxBuffer: 1024 * 1024 })
    console.error('Temp git history:')
    console.error(stdout.trimEnd())
  } catch (err) {
    console.error(`Git diagnostics failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const log = await readFile(join(tempRoot, 'local', 'oz.log'), 'utf8')
    const lines = log.trimEnd().split(/\r?\n/).slice(-20)
    console.error('Last oz.log lines:')
    for (const line of lines) console.error(line)
  } catch (err) {
    console.error(`No oz.log diagnostics: ${err instanceof Error ? err.message : String(err)}`)
  }
}
