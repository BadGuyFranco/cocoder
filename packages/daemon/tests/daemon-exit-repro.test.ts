import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { request, type ClientRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { writeInstallFixture } from './helpers/daemon-reload-fixture.js'

const here = dirname(fileURLToPath(import.meta.url))
const daemonBin = join(here, '..', 'bin', 'oz.mjs')

interface HttpJson {
  readonly status: number
  readonly json: unknown
}

interface SseStream {
  readonly req: ClientRequest
  text(): string
}

interface ExitResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly elapsedMs: number
}

type DaemonProcess = ChildProcessByStdio<null, Readable, Readable>

describe('daemon process shutdown', () => {
  let home: string
  let child: DaemonProcess | undefined
  let childExited = false

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cocoder-daemon-exit-'))
    await writeInstallFixture(home, ['cocoder'])
  })

  afterEach(async () => {
    if (child && !childExited) {
      child.kill('SIGKILL')
      await waitForExit(child, 2_000).catch(() => {})
    }
    child = undefined
    childExited = false
    await rm(home, { recursive: true, force: true })
  })

  test('SIGTERM exits the real daemon with an open dashboard event stream', async () => {
    const port = await getFreePort()
    const daemon = spawn(process.execPath, [daemonBin, '--port', String(port)], {
      cwd: home,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = daemon
    const output = captureOutput(daemon)
    daemon.once('exit', () => {
      childExited = true
    })

    const startedAt = Date.now()
    await waitForHealth(port, 10_000, () => output())
    const bootMs = Date.now() - startedAt
    const session = await getJson(port, '/auth/session')
    expect(session.status).toBe(200)
    const token = readBearerToken(session.json)

    const stream = await openSse(port, token)
    await waitFor(() => stream.text().includes(': connected'), 2_000, 'SSE stream did not receive the connected frame')

    const sigtermAt = Date.now()
    daemon.kill('SIGTERM')
    const exit = await waitForExit(daemon, 5_000)
    childExited = true
    stream.req.destroy()

    await expectPortCanBind(port)
    console.info(`daemon-exit-repro timing: boot=${bootMs}ms sigterm-to-exit=${exit.elapsedMs}ms code=${exit.code ?? 'null'} signal=${exit.signal ?? 'null'}`)

    expect(Date.now() - sigtermAt).toBeLessThanOrEqual(5_000)
    expect(exit.code === 0 || exit.code === 1 || exit.signal !== null).toBe(true)
  }, 20_000)
})

function captureOutput(child: DaemonProcess): () => string {
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  return () => output
}

function readBearerToken(json: unknown): string {
  if (!json || typeof json !== 'object' || !('bearerToken' in json) || typeof json.bearerToken !== 'string') {
    throw new Error('GET /auth/session did not return a bearerToken')
  }
  return json.bearerToken
}

function getJson(port: number, path: string): Promise<HttpJson> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function openSse(port: number, token: string): Promise<SseStream> {
  return new Promise((resolve, reject) => {
    let settled = false
    let data = ''
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/oz/events',
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      },
      (res) => {
        settled = true
        expect(res.statusCode).toBe(200)
        expect(res.headers['content-type']).toBe('text/event-stream')
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        resolve({ req, text: () => data })
      },
    )
    req.on('error', (error) => {
      if (!settled) reject(error)
    })
    req.end()
  })
}

async function waitForHealth(port: number, timeoutMs: number, output: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const health = await getJson(port, '/health')
      if (health.status === 200) return
    } catch (error) {
      lastError = error
    }
    await sleep(50)
  }
  throw new Error(`daemon did not answer /health within ${timeoutMs}ms; lastError=${String(lastError)}; output=${output()}`)
}

function waitFor(predicate: () => boolean, timeoutMs: number, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(message))
      }
    }, 10)
  })
}

function waitForExit(child: DaemonProcess, timeoutMs: number): Promise<ExitResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`daemon process did not exit within ${timeoutMs}ms`))
    }, timeoutMs)
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup()
      resolve({ code, signal, elapsedMs: Date.now() - started })
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      child.off('exit', onExit)
    }
    child.once('exit', onExit)
  })
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('free-port probe did not bind to a TCP port')))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

function expectPortCanBind(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
