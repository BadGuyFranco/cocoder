// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

describe('Oz event stream parser', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('reassembles partial chunks, ignores comments/retry, supports multi-line data, and skips bad JSON', async () => {
    const { SseParser } = await import('../src/main/events-stream.ts')
    const frames: unknown[] = []
    const parser = new SseParser((frame) => frames.push(frame))

    parser.push('retry: 5000\n: connected\n\n')
    parser.push('event: run-created\ndata: {"type":"run-created",')
    parser.push('\ndata: "runId":"run_1","ts":"2026-06-12T00:00:00.000Z"}\n\n')
    parser.push('event: bad\ndata: {nope}\n\n')
    parser.push(': heartbeat\n\n')
    parser.push('event: run-set')
    parser.push('tled\ndata: {"type":"run-settled","ts":"2026-06-12T00:00:01.000Z"}\n\n')

    expect(frames).toEqual([
      {
        event: 'run-created',
        data: { type: 'run-created', runId: 'run_1', ts: '2026-06-12T00:00:00.000Z' },
      },
      {
        event: 'run-settled',
        data: { type: 'run-settled', ts: '2026-06-12T00:00:01.000Z' },
      },
    ])
  })
})

describe('Oz event stream connector', () => {
  let server: Server | undefined
  const originalDaemon = process.env.OZ_DAEMON
  const originalFixtures = process.env.OZ_FIXTURES

  beforeEach(() => {
    vi.resetModules()
    delete process.env.OZ_FIXTURES
  })

  afterEach(async () => {
    process.env.OZ_DAEMON = originalDaemon
    process.env.OZ_FIXTURES = originalFixtures
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve()
        return
      }
      server.close(() => resolve())
      server = undefined
    })
  })

  it('reconnects after the stream drops and forwards sanitized events', async () => {
    let eventHits = 0
    const sent: unknown[] = []
    server = createServer((req, res) => {
      if (req.url === '/auth/session') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ bearerToken: 'tok', csrfToken: 'csrf' }))
        return
      }
      if (req.url === '/oz/events') {
        eventHits += 1
        expect(req.headers.authorization).toBe('Bearer tok')
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        })
        res.write('retry: 5000\n: connected\n\n')
        if (eventHits === 1) {
          res.end()
          return
        }
        res.write('event: run-created\n')
        res.write('data: {"type":"run-created","runId":"run_1","workspaceId":"cocoder","ts":"2026-06-12T00:00:00.000Z","token":"secret"}\n\n')
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    process.env.OZ_DAEMON = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`

    const { startOzEventStream } = await import('../src/main/events-stream.ts')
    const stream = startOzEventStream({
      backoffMs: 10,
      getWindows: () => [{ webContents: { send: (_channel, event) => sent.push(event) } }],
    })
    try {
      await vi.waitFor(() => expect(eventHits).toBeGreaterThanOrEqual(2), { timeout: 1000 })
      await vi.waitFor(() => expect(sent).toEqual([
        { type: 'run-created', runId: 'run_1', workspaceId: 'cocoder', ts: '2026-06-12T00:00:00.000Z' },
      ]), { timeout: 1000 })
    } finally {
      stream.stop()
    }
  })

  it('does not connect in fixtures mode', async () => {
    const { startOzEventStream } = await import('../src/main/events-stream.ts')
    let fetches = 0

    const stream = startOzEventStream({
      fixtures: () => true,
      fetchImpl: (async () => {
        fetches += 1
        throw new Error('should not fetch')
      }) as typeof fetch,
    })

    stream.stop()
    expect(fetches).toBe(0)
  })
})
