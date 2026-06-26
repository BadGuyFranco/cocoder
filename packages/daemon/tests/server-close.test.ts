import { mkdtemp, rm } from 'node:fs/promises'
import { request, type ClientRequest, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, type Git, type RunStore, type SessionHost } from '@cocoder/core'
import { createOzServer, type OzServer } from '../src/index.js'

const fakeGit = (): Git => ({
  async isGitRepo() {
    return true
  },
  async initRepo() {},
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
  async currentBranch() {
    return 'trunk'
  },
  async resetHard() {},
  async hasUpstream() {
    return false
  },
  async push() {
    return { ok: true, detail: '' }
  },
  async commitsSince() {
    return []
  },
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

interface SseStream {
  readonly req: ClientRequest
  readonly res: IncomingMessage
  text(): string
}

describe('Oz server close', () => {
  let home: string
  let store: RunStore
  let oz: OzServer | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cocoder-oz-close-'))
    store = openRunStore(':memory:')
    oz = await createOzServer({
      cocoderHome: home,
      port: 0,
      store,
      git: fakeGit(),
      sessionHost: fakeHost(),
      restartDaemon: () => {},
      buildDaemonForReload: async () => ({ exitCode: 0, output: 'ok' }),
    })
  })

  afterEach(async () => {
    await oz?.close()
    oz = undefined
    await rm(home, { recursive: true, force: true })
  })

  test('resolves while an SSE client connection is still open', async () => {
    const server = oz!
    const stream = await openSse(server)
    await waitFor(() => stream.text().includes(': connected'))

    await expect(withTimeout(server.close(), 500)).resolves.toBeUndefined()
    oz = undefined

    stream.req.destroy()
  })
})

function openSse(oz: OzServer): Promise<SseStream> {
  return new Promise((resolve, reject) => {
    let data = ''
    const req = request(
      {
        host: '127.0.0.1',
        port: oz.port,
        path: '/oz/events',
        method: 'GET',
        headers: { authorization: `Bearer ${oz.token}` },
      },
      (res) => {
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('error', () => {})
        resolve({ req, res, text: () => data })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
