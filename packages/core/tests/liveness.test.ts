import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, test } from 'vitest'
import { DEFAULT_OZ_PORT, probeDaemon } from '../src/index.js'

// Listen on an ephemeral loopback port and resolve the chosen port number.
function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })
}

describe('probeDaemon', () => {
  let server: Server | undefined
  afterEach(() => {
    server?.close()
    server = undefined
  })

  test('200 from /health → alive', async () => {
    server = createServer((req, res) => {
      res.statusCode = req.url === '/health' ? 200 : 404
      res.end()
    })
    const port = await listen(server)
    expect(await probeDaemon({ port })).toEqual({ alive: true, port })
  })

  test('non-200 on /health → not alive', async () => {
    server = createServer((_req, res) => {
      res.statusCode = 500
      res.end()
    })
    const port = await listen(server)
    expect((await probeDaemon({ port })).alive).toBe(false)
  })

  test('connection refused (no server) → not alive, never throws', async () => {
    // A port nothing is listening on (well above the default) → ECONNREFUSED.
    const res = await probeDaemon({ port: 59_999, timeoutMs: 200 })
    expect(res.alive).toBe(false)
  })

  test('defaults to DEFAULT_OZ_PORT', async () => {
    const res = await probeDaemon({ timeoutMs: 100 })
    expect(res.port).toBe(DEFAULT_OZ_PORT)
  })
})
