// Client mode: runViaDaemon bootstraps a token, POSTs the launch with Bearer+CSRF, and polls the
// run to terminal — WITHOUT opening the DB. Tested against a tiny fake daemon (no @cocoder/daemon
// dependency, so the cli stays daemon-import-free).
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'vitest'
import { authoringPlayViaDaemon, requestDebRepairViaDaemon, runViaDaemon, supportCommitViaDaemon } from '../src/client.js'

const execFileAsync = promisify(execFile)

interface Captured {
  launchAuth?: string
  launchCsrf?: string | string[]
  launchBody?: any
  supportAuth?: string
  supportCsrf?: string | string[]
  debRepairAuth?: string
  debRepairCsrf?: string | string[]
  debRepairBody?: unknown
  authorAuth?: string
  authorCsrf?: string | string[]
  authorBody?: any
}

function fakeDaemon(): { server: Server; captured: Captured; ready: Promise<number> } {
  const captured: Captured = {}
  let polls = 0
  const server = createServer((req, res) => {
    const json = (obj: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (req.url === '/auth/session') return json({ bearerToken: 'tok', csrfToken: 'csrf' })
    if (req.method === 'POST' && req.url === '/runs') {
      captured.launchAuth = req.headers.authorization
      captured.launchCsrf = req.headers['x-oz-csrf-token']
      let body = ''
      req.on('data', (c) => (body += c))
      return req.on('end', () => {
        captured.launchBody = JSON.parse(body)
        res.writeHead(202, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ runId: 'run_xyz' }))
      })
    }
    if (req.method === 'GET' && req.url === '/runs/run_xyz') {
      polls += 1
      // First poll still running, then completed with a commit.
      return polls < 2
        ? json({ run: { status: 'running' }, commitLinks: [] })
        : json({ run: { status: 'completed' }, commitLinks: [{ commitSha: 'abc123' }] })
    }
    if (req.method === 'POST' && req.url === '/runs/run_xyz/support-commit') {
      captured.supportAuth = req.headers.authorization
      captured.supportCsrf = req.headers['x-oz-csrf-token']
      return json({
        ok: true,
        runId: 'run_xyz',
        commitSha: 'def456',
        committedPaths: ['cocoder/SESSION_LOG.md'],
        outOfLanePaths: [],
        liveOscar: true,
      })
    }
    if (req.method === 'POST' && req.url === '/workspaces/cocoder/oscar-deb-repairs') {
      captured.debRepairAuth = req.headers.authorization
      captured.debRepairCsrf = req.headers['x-oz-csrf-token']
      let body = ''
      req.on('data', (c) => (body += c))
      return req.on('end', () => {
        captured.debRepairBody = JSON.parse(body)
        json({
          ok: true,
          state: 'complete',
          outcome: 'applied',
          dialogueId: 'repair-1-abc',
          commitSha: 'repair123',
          committedPaths: ['packages/daemon/src/routes.ts'],
          outOfLanePaths: [],
        })
      })
    }
    if (req.method === 'POST' && req.url === '/workspaces/cocoder/authoring-plays/archive-priority') {
      captured.authorAuth = req.headers.authorization
      captured.authorCsrf = req.headers['x-oz-csrf-token']
      let body = ''
      req.on('data', (c) => (body += c))
      return req.on('end', () => {
        captured.authorBody = JSON.parse(body)
        json({
          ok: true,
          commitSha: 'abc999',
          committedPaths: ['cocoder/priorities/archive/demo.md', 'cocoder/priorities/order.json'],
          outOfLanePaths: [],
          exitCode: 0,
          turnLogPath: '/tmp/authoring.log',
        })
      })
    }
    res.writeHead(404)
    res.end()
  })
  const ready = new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })
  return { server, captured, ready }
}

describe('runViaDaemon (client mode)', () => {
  let server: Server | undefined
  afterEach(() => {
    server?.close()
    server = undefined
  })

  test('launches with Bearer + CSRF and polls to terminal', async () => {
    const d = fakeDaemon()
    server = d.server
    const port = await d.ready
    const result = await runViaDaemon(`http://127.0.0.1:${port}`, 'cocoder', 'demo', { pollMs: 5 })

    expect(result).toEqual({ runId: 'run_xyz', status: 'completed', commits: ['abc123'] })
    expect(d.captured.launchAuth).toBe('Bearer tok')
    expect(d.captured.launchCsrf).toBe('csrf')
    expect(d.captured.launchBody).toEqual({ workspaceId: 'cocoder', priorityId: 'demo' })
  })

  test('support-commit posts with Bearer + CSRF and returns the daemon receipt', async () => {
    const d = fakeDaemon()
    server = d.server
    const port = await d.ready

    const result = await supportCommitViaDaemon(`http://127.0.0.1:${port}`, 'run_xyz')

    expect(result).toMatchObject({
      ok: true,
      runId: 'run_xyz',
      commitSha: 'def456',
      committedPaths: ['cocoder/SESSION_LOG.md'],
      outOfLanePaths: [],
      liveOscar: true,
    })
    expect(d.captured.supportAuth).toBe('Bearer tok')
    expect(d.captured.supportCsrf).toBe('csrf')
  })

  test('request-deb-repair posts with Bearer + CSRF and returns the daemon receipt', async () => {
    const d = fakeDaemon()
    server = d.server
    const port = await d.ready

    const result = await requestDebRepairViaDaemon(`http://127.0.0.1:${port}`, 'cocoder', {
      problem: 'fix stale route',
      evidence: [{ kind: 'test', ref: 'client.test.ts', summary: 'Route is exposed.' }],
      sourceRunId: 'run_xyz',
    })

    expect(result).toMatchObject({
      ok: true,
      state: 'complete',
      outcome: 'applied',
      dialogueId: 'repair-1-abc',
      commitSha: 'repair123',
      committedPaths: ['packages/daemon/src/routes.ts'],
      outOfLanePaths: [],
    })
    expect(d.captured.debRepairAuth).toBe('Bearer tok')
    expect(d.captured.debRepairCsrf).toBe('csrf')
    expect(d.captured.debRepairBody).toEqual({
      problem: 'fix stale route',
      evidence: [{ kind: 'test', ref: 'client.test.ts', summary: 'Route is exposed.' }],
      sourceRunId: 'run_xyz',
    })
  })

  test('request-deb-repair CLI requires --problem', async () => {
    const cli = fileURLToPath(new URL('../bin/cocoder.mjs', import.meta.url))

    const run = execFileAsync(process.execPath, [cli, 'oz', 'request-deb-repair', 'cocoder']).catch((err: unknown) => err)

    await expect(run).resolves.toMatchObject({ code: 2, stderr: expect.stringContaining('usage: cocoder oz request-deb-repair <workspaceId> --problem <text>') })
  })

  test('authoring Play posts with Bearer + CSRF and returns the daemon receipt', async () => {
    const d = fakeDaemon()
    server = d.server
    const port = await d.ready

    const result = await authoringPlayViaDaemon(`http://127.0.0.1:${port}`, 'cocoder', 'archive-priority', { id: 'demo' })

    expect(result).toMatchObject({
      ok: true,
      commitSha: 'abc999',
      committedPaths: ['cocoder/priorities/archive/demo.md', 'cocoder/priorities/order.json'],
      outOfLanePaths: [],
      exitCode: 0,
    })
    expect(d.captured.authorAuth).toBe('Bearer tok')
    expect(d.captured.authorCsrf).toBe('csrf')
    expect(d.captured.authorBody).toEqual({ persona: 'oz', invocation: { id: 'demo' } })
  })

  test('throws a clear error when the daemon rejects the launch', async () => {
    const s = createServer((req, res) => {
      if (req.url === '/auth/session') {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ bearerToken: 't', csrfToken: 'c' }))
      }
      res.writeHead(409, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'a run is already in flight' }))
    })
    server = s
    const port = await new Promise<number>((resolve) =>
      s.listen(0, '127.0.0.1', () => {
        const a = s.address()
        resolve(typeof a === 'object' && a ? a.port : 0)
      }),
    )
    await expect(runViaDaemon(`http://127.0.0.1:${port}`, 'cocoder', 'demo', { pollMs: 5 })).rejects.toThrow(/409/)
  })
})
