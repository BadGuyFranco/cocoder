// The dashboard shell + assets are served (open, no Bearer) so a browser can load before bootstrap.
import { mkdtemp } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openRunStore, type SessionHost } from '@cocoder/core'
import { createOzServer, type OzServer } from '../src/index.js'

const fakeHost = (): SessionHost =>
  ({
    async spawn() {
      return { id: 'x', driver: 'fake' }
    },
    async readScreen() {
      return ''
    },
    async status() {
      return { state: 'exited', code: 0 }
    },
    async waitForExit() {
      return { state: 'exited', code: 0 }
    },
    async show() {},
    async kill() {},
  }) as SessionHost

interface Resp {
  status: number
  contentType: string | undefined
  text: string
}
const raw = (oz: OzServer, path: string): Promise<Resp> =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: oz.port, path, method: 'GET' }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, contentType: res.headers['content-type'], text: data }))
    })
    req.on('error', reject)
    req.end()
  })

describe('Oz static dashboard', () => {
  let oz: OzServer | undefined
  afterEach(async () => {
    await oz?.close()
    oz = undefined
  })
  const start = async (): Promise<OzServer> => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-oz-static-'))
    oz = await createOzServer({ cocoderHome: home, port: 0, store: openRunStore(':memory:'), sessionHost: fakeHost() })
    return oz
  }

  test('GET / serves the dashboard shell without a Bearer token', async () => {
    const r = await raw(await start(), '/')
    expect(r.status).toBe(200)
    expect(r.contentType).toContain('text/html')
    expect(r.text).toContain('<title>Oz')
  })

  test('GET /app.js and /style.css are served (open assets)', async () => {
    const a = await raw(await start(), '/app.js')
    expect(a.status).toBe(200)
    expect(a.contentType).toContain('text/javascript')
    const c = await raw(oz!, '/style.css')
    expect(c.contentType).toContain('text/css')
  })

  test('a non-asset path still requires Bearer (falls through to the gate)', async () => {
    const r = await raw(await start(), '/workspaces')
    expect(r.status).toBe(401) // no .css/.js/.html ext → not static → bearer-gated
  })
})
