// Ports the v1 oz-security-*.test.mjs INTENTIONS (C-S1..C-S4 + C-D1) to node:http. Gate edge cases
// (missing Host/Origin) are unit-tested against the pure functions — a real http client always sets
// Host — while the realistic flows are integration-tested against a wired ephemeral server.
import { mkdtemp, stat } from 'node:fs/promises'
import { request } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createOzServer, OZ_CSRF_HEADER, ozTokenPath, type OzServer } from '../src/index.js'
import { checkBearer, checkCsrf, checkHost, checkOrigin } from '../src/security.js'

const reqLike = (headers: Record<string, string>, method = 'POST'): IncomingMessage =>
  ({ headers, method }) as unknown as IncomingMessage

describe('security gates (pure)', () => {
  test('C-S3 Host: missing or adversarial hostname → 403 invalid host; loopback ok', () => {
    expect(checkHost(reqLike({}))).toMatchObject({ ok: false, status: 403, error: 'invalid host' })
    expect(checkHost(reqLike({ host: 'evil.example' }))).toMatchObject({ error: 'invalid host' })
    expect(checkHost(reqLike({ host: '127.0.0.1:7878' })).ok).toBe(true)
    expect(checkHost(reqLike({ host: 'localhost:55012' })).ok).toBe(true)
  })

  test('C-S3 Origin: absent allowed; adversarial/malformed → 403 invalid origin; loopback ok', () => {
    expect(checkOrigin(reqLike({})).ok).toBe(true) // absent → allowed (curl/node bootstrap)
    expect(checkOrigin(reqLike({ origin: 'http://evil.example' }))).toMatchObject({ error: 'invalid origin' })
    expect(checkOrigin(reqLike({ origin: 'not a url' }))).toMatchObject({ error: 'invalid origin' })
    expect(checkOrigin(reqLike({ origin: 'http://127.0.0.1:7878' })).ok).toBe(true)
  })

  test('C-S2 Bearer / C-S4 CSRF: constant-time match, else reject', () => {
    expect(checkBearer(reqLike({}), 'tok')).toMatchObject({ status: 401, error: 'missing bearer token' })
    expect(checkBearer(reqLike({ authorization: 'Bearer wrong' }), 'tok').ok).toBe(false)
    expect(checkBearer(reqLike({ authorization: 'Bearer tok' }), 'tok').ok).toBe(true)
    expect(checkCsrf(reqLike({}), 'csrf')).toMatchObject({ status: 403, error: 'missing or invalid csrf token' })
    expect(checkCsrf(reqLike({ [OZ_CSRF_HEADER]: 'csrf' }), 'csrf').ok).toBe(true)
  })
})

describe('Oz server security (wired, ephemeral port)', () => {
  let oz: OzServer | undefined
  afterEach(async () => {
    await oz?.close()
    oz = undefined
  })

  const start = async (): Promise<OzServer> => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-oz-sec-'))
    oz = await createOzServer({ cocoderHome: home, port: 0 })
    return oz
  }

  interface Resp {
    status: number
    json: any
  }
  const http = (port: number, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: unknown }): Promise<Resp> =>
    new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path ?? '/', headers: opts.headers ?? {} },
        (res) => {
          let data = ''
          res.on('data', (c) => (data += c))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }))
        },
      )
      req.on('error', reject)
      req.end(opts.body ? JSON.stringify(opts.body) : undefined)
    })

  test('C-S2: GET /health needs no Bearer and returns {ok:true}', async () => {
    const { port } = await start()
    expect(await http(port, { path: '/health' })).toEqual({ status: 200, json: { ok: true } })
  })

  test('C-S2: oz-token file is created mode 0600', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-oz-tok-'))
    oz = await createOzServer({ cocoderHome: home, port: 0 })
    const st = await stat(ozTokenPath(home))
    expect(st.mode & 0o777).toBe(0o600)
  })

  test('C-D1: GET /auth/session returns the bearer + csrf tokens to a loopback caller', async () => {
    const { port, token, csrfToken } = await start()
    const r = await http(port, { path: '/auth/session' })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ bearerToken: token, csrfToken })
  })

  test('C-D1: /auth/session rejects an adversarial Origin even on GET', async () => {
    const { port } = await start()
    const r = await http(port, { path: '/auth/session', headers: { origin: 'http://evil.example' } })
    expect(r).toMatchObject({ status: 403, json: { error: 'invalid origin' } })
  })

  test('C-S3: adversarial Host is rejected before Bearer (403 invalid host)', async () => {
    const { port } = await start()
    const r = await http(port, { method: 'POST', path: '/runs', headers: { host: 'evil.example' } })
    expect(r).toMatchObject({ status: 403, json: { error: 'invalid host' } })
  })

  test('C-S2: POST without Bearer → 401', async () => {
    const { port } = await start()
    const r = await http(port, { method: 'POST', path: '/runs' })
    expect(r.status).toBe(401)
  })

  test('C-S4: valid Bearer but missing CSRF on a mutation → 403', async () => {
    const { port, token } = await start()
    const r = await http(port, { method: 'POST', path: '/runs', headers: { authorization: `Bearer ${token}` } })
    expect(r).toMatchObject({ status: 403, json: { error: 'missing or invalid csrf token' } })
  })

  test('C-S4: valid Bearer + valid CSRF passes the gate (reaches the handler — 400 on empty body, not 401/403)', async () => {
    const { port, token, csrfToken } = await start()
    const r = await http(port, {
      method: 'POST',
      path: '/runs',
      headers: { authorization: `Bearer ${token}`, [OZ_CSRF_HEADER]: csrfToken },
    })
    // The gate passed (not 401/403); POST /runs now exists and rejects the missing workspaceId/priorityId.
    expect(r.status).toBe(400)
    expect([401, 403]).not.toContain(r.status)
  })
})
