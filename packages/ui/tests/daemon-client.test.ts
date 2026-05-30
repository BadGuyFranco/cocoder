// @vitest-environment node
// Main-process security posture: against a stub daemon, assert the client does the /auth/session
// handshake, sends Bearer on every request + x-oz-csrf-token on mutations, and sends NO Origin header
// (a non-loopback Origin would self-403 against packages/daemon/src/security.ts checkOrigin).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage } from 'node:http'

const seen: { method: string; url: string; headers: IncomingMessage['headers'] }[] = []
let server: Server
let base = ''

beforeAll(async () => {
  delete process.env.OZ_FIXTURES
  server = createServer((req, res) => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/auth/session') return res.end(JSON.stringify({ bearerToken: 'tok', csrfToken: 'csrf' }))
    if (req.url === '/runs' && req.method === 'POST') {
      res.statusCode = 202
      return res.end(JSON.stringify({ runId: 'run_x' }))
    }
    res.end(JSON.stringify({ workspaces: [] }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  process.env.OZ_DAEMON = base
})

afterAll(() => server.close())

describe('daemon client security headers', () => {
  it('sends Bearer + loopback Host and no Origin on a GET', async () => {
    const { daemonGet } = await import('../electron/daemon-client.ts')
    const r = await daemonGet('/workspaces')
    expect(r.ok).toBe(true)
    const get = seen.find((s) => s.url === '/workspaces')!
    expect(get.headers.authorization).toBe('Bearer tok')
    expect(get.headers.origin).toBeUndefined()
    expect(String(get.headers.host).startsWith('127.0.0.1')).toBe(true)
  })

  it('echoes x-oz-csrf-token on a mutation and surfaces 202 as ok', async () => {
    const { daemonPost } = await import('../electron/daemon-client.ts')
    const r = await daemonPost('/runs', { workspaceId: 'cocoder', priorityId: 'adhoc-session' })
    expect(r.ok).toBe(true)
    expect(r.status).toBe(202)
    const post = seen.find((s) => s.url === '/runs' && s.method === 'POST')!
    expect(post.headers['x-oz-csrf-token']).toBe('csrf')
    expect(post.headers.authorization).toBe('Bearer tok')
    expect(post.headers.origin).toBeUndefined()
  })
})
