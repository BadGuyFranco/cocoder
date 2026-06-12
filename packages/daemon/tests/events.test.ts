import { mkdtemp } from 'node:fs/promises'
import { request, type ClientRequest, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { type Git, type SessionHost } from '@cocoder/core'
import { createOzServer, type OzServer } from '../src/index.js'
import type { OzEvent } from '../src/context.js'

const fakeGit = (): Git => ({
  async headSha() {
    return 'h0'
  },
  async changedFiles() {
    return []
  },
  async addAndCommit() {
    return 'sha'
  },
  async show() {
    return ''
  },
  async restoreToHead() {},
  async worktreeAdd() {},
  async worktreeRemove() {},
  async listWorktrees() {
    return []
  },
  async isAncestor() {
    return true
  },
  async mergeFastForwardOnly() {
    return 'h0'
  },
  async unmergedCommits() {
    return []
  },
  async mergeInto() {
    return 'clean' as const
  },
  async conflictedFiles() {
    return []
  },
  async completeMerge() {
    return 'h0'
  },
  async abortMerge() {},
  async currentBranch() {
    return 'trunk'
  },
  async resetHard() {},
})

const fakeHost = (): SessionHost => ({
  async spawn() {
    return { id: 'surface:1', driver: 'fake' }
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
  async sendInput() {},
  async show() {},
  async kill() {},
  async closeSurface() {},
})

interface JsonResp {
  readonly status: number
  readonly json: unknown
}

function getJson(port: number, headers: Record<string, string> = {}): Promise<JsonResp> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/oz/events', method: 'GET', headers }, (res) => {
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

interface SseStream {
  readonly req: ClientRequest
  readonly res: IncomingMessage
  text(): string
  waitForText(needle: string): Promise<string>
  close(): void
}

function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
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
        reject(new Error('timed out waiting for condition'))
      }
    }, 10)
  })
}

function openSse(oz: OzServer, headers: Record<string, string> = { authorization: `Bearer ${oz.token}` }): Promise<SseStream> {
  return new Promise((resolve, reject) => {
    let data = ''
    const req = request({ host: '127.0.0.1', port: oz.port, path: '/oz/events', method: 'GET', headers }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        data += chunk
      })
      resolve({
        req,
        res,
        text: () => data,
        waitForText: async (needle) => {
          await waitFor(() => data.includes(needle))
          return data
        },
        close: () => {
          req.destroy()
        },
      })
    })
    req.on('error', reject)
    req.end()
  })
}

describe('Oz event stream', () => {
  let oz: OzServer | undefined

  afterEach(async () => {
    await oz?.close()
    oz = undefined
  })

  async function start(): Promise<OzServer> {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-oz-events-'))
    oz = await createOzServer({ cocoderHome: home, port: 0, git: fakeGit(), sessionHost: fakeHost() })
    return oz
  }

  test('GET /oz/events requires a valid bearer token but not CSRF', async () => {
    const server = await start()

    expect(await getJson(server.port)).toEqual({ status: 401, json: { error: 'missing bearer token' } })
    expect(await getJson(server.port, { authorization: 'Bearer wrong' })).toEqual({ status: 401, json: { error: 'missing bearer token' } })

    const stream = await openSse(server)
    try {
      expect(stream.res.statusCode).toBe(200)
      expect(stream.res.headers['content-type']).toBe('text/event-stream')
      await stream.waitForText(': connected')
    } finally {
      stream.close()
    }
  })

  test('streams bus events as named SSE frames with JSON data', async () => {
    const server = await start()
    const stream = await openSse(server)
    try {
      await stream.waitForText('retry: 5000\n: connected\n\n')
      const event: OzEvent = {
        type: 'run-created',
        runId: 'run_123',
        workspaceId: 'cocoder',
        ts: '2026-06-12T00:00:00.000Z',
      }

      server.ctx.events.emit(event)

      const body = await stream.waitForText('event: run-created')
      expect(body).toContain(`data: ${JSON.stringify(event)}\n\n`)
    } finally {
      stream.close()
    }
  })

  test('removes the event subscriber after client disconnect', async () => {
    const server = await start()
    const before = server.ctx.events.size()
    const stream = await openSse(server)

    await stream.waitForText(': connected')
    expect(server.ctx.events.size()).toBe(before + 1)

    stream.close()

    await waitFor(() => server.ctx.events.size() === before)
  })
})
