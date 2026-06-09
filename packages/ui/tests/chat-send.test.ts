// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type RequestListener, type Server } from 'node:http'
import { ozReply } from '../electron/chat.ts'

let server: Server | undefined

async function closeServer(): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
}

async function listen(handler: RequestListener): Promise<string> {
  server = createServer(handler)
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
}

async function closedBase(): Promise<string> {
  const base = await listen((_req, res) => res.end())
  await closeServer()
  return base
}

async function loadSender(env: { fixtures?: boolean; base?: string }) {
  vi.resetModules()
  if (env.fixtures) process.env.OZ_FIXTURES = '1'
  else delete process.env.OZ_FIXTURES
  if (env.base) process.env.OZ_DAEMON = env.base
  else delete process.env.OZ_DAEMON
  return import('../electron/chat-send.ts')
}

afterEach(async () => {
  await closeServer()
  delete process.env.OZ_FIXTURES
  delete process.env.OZ_DAEMON
})

describe('main-process Oz chat sender', () => {
  it('maps a fixture daemon reply into an Oz ChatMessage', async () => {
    const { sendChatMessage } = await loadSender({ fixtures: true })

    await expect(sendChatMessage('cocoder', 'status', 123)).resolves.toEqual({
      role: 'oz',
      text: 'Fixture Oz: status is available from the daemon chat endpoint.',
      at: 123,
    })
  })

  it('falls back to the offline stub only when the daemon is unreachable', async () => {
    const { sendChatMessage } = await loadSender({ base: await closedBase() })

    await expect(sendChatMessage('cocoder', 'status please', 456)).resolves.toEqual(ozReply('status please', 456))
  })

  it('surfaces daemon 4xx reply text instead of the stub or a generic error', async () => {
    const base = await listen((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/auth/session') return res.end(JSON.stringify({ bearerToken: 'tok', csrfToken: 'csrf' }))
      if (req.url === '/oz/messages' && req.method === 'POST') {
        res.statusCode = 400
        return res.end(JSON.stringify({ reply: 'Pick a workspace first, then use launch <priorityId>.', ok: false, command: 'unknown' }))
      }
      res.statusCode = 404
      return res.end(JSON.stringify({ error: 'not found' }))
    })
    const { sendChatMessage } = await loadSender({ base })

    const msg = await sendChatMessage('', 'launch demo', 789)

    expect(msg).toEqual({ role: 'oz', text: 'Pick a workspace first, then use launch <priorityId>.', at: 789 })
    expect(msg.text).not.toContain('wiring to POST /oz/messages')
    expect(msg.text).not.toContain('POST /oz/messages')
  })
})
