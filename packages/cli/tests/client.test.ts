// Client mode: runViaDaemon bootstraps a token, POSTs the launch with Bearer+CSRF, and polls the
// run to terminal — WITHOUT opening the DB. Tested against a tiny fake daemon (no @cocoder/daemon
// dependency, so the cli stays daemon-import-free).
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, test } from 'vitest'
import { runViaDaemon, supportCommitViaDaemon } from '../src/client.js'

interface Captured {
  launchAuth?: string
  launchCsrf?: string | string[]
  launchBody?: any
  supportAuth?: string
  supportCsrf?: string | string[]
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
