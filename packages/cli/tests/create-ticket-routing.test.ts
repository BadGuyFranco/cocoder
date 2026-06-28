import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { composeTicketMarkdown } from '@cocoder/core'
import { main } from '../src/run.js'

const execFileAsync = promisify(execFile)
const dirs: string[] = []
let server: Server | undefined

afterEach(async () => {
  server?.close()
  server = undefined
  process.exitCode = undefined
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

interface FakeCreateDaemon {
  readonly server: Server
  readonly ready: Promise<number>
  readonly bodies: readonly unknown[]
}

function fakeCreateDaemon(status: number, payload: unknown): FakeCreateDaemon {
  const bodies: unknown[] = []
  const s = createServer((req, res) => {
    if (req.url === '/auth/session') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ bearerToken: 'tok', csrfToken: 'csrf' }))
    }
    if (req.method === 'POST' && req.url === '/workspaces/cocoder/tickets') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      return req.on('end', () => {
        bodies.push(JSON.parse(body) as unknown)
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      })
    }
    res.writeHead(404)
    res.end()
  })
  return {
    server: s,
    bodies,
    ready: new Promise<number>((resolve) =>
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address()
        resolve(typeof addr === 'object' && addr ? addr.port : 0)
      }),
    ),
  }
}

async function ticketRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'cocoder-create-routing-'))
  dirs.push(repo)
  const tickets = join(repo, 'cocoder', 'tickets')
  await mkdir(join(tickets, 'open'), { recursive: true })
  await writeFile(
    join(tickets, 'open', '0001-existing.md'),
    composeTicketMarkdown('0001', { title: 'Existing', type: 'task', priority: 'none', description: 'Already filed.' }, '2026-06-28'),
  )
  await writeFile(join(tickets, 'order.json'), `${JSON.stringify(['0001'], null, 2)}\n`)
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo })
  return repo
}

async function runCreateTicket(args: readonly string[], probePort: number | null): Promise<{ readonly repo: string; readonly stdout: string; readonly stderr: string }> {
  const previousArgv = process.argv
  const previousCwd = process.cwd()
  const repo = await ticketRepo()
  const stdout: string[] = []
  const stderr: string[] = []
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    stdout.push(String(chunk))
    return true
  })
  const stderrSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown): void => {
    stderr.push(String(message))
  })
  try {
    process.chdir(repo)
    process.argv = [process.execPath, 'cocoder', 'oz', 'create-ticket', ...args]
    await main({
      probeDaemonImpl: async () => probePort === null ? { alive: false, port: 7878 } : { alive: true, port: probePort },
    })
    return { repo, stdout: stdout.join(''), stderr: stderr.join('\n') }
  } finally {
    process.argv = previousArgv
    process.chdir(previousCwd)
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  }
}

describe('cocoder oz create-ticket routing', () => {
  test('routes to a live daemon and prints the created receipt', async () => {
    const daemon = fakeCreateDaemon(201, { ok: true, ticket: { id: '0012' }, committedSha: 'sha-daemon-create' })
    server = daemon.server
    const port = await daemon.ready

    const result = await runCreateTicket([
      '--title', 'Daemon Ticket',
      '--type', 'bug',
      '--priority', 'demo',
      '--reason', 'Founder chose demo for this live-daemon ticket.',
      '--description', 'Created through daemon.',
      '--id', '0012',
      '--run', 'run_5',
    ], port)

    expect(result.stderr).not.toContain('refusing an out-of-band ticket create')
    expect(result.stdout).toContain('created ticket 0012: sha-daemon-create')
    expect(daemon.bodies).toEqual([{
      title: 'Daemon Ticket',
      type: 'bug',
      description: 'Created through daemon.',
      priority: 'demo',
      bindingReason: 'Founder chose demo for this live-daemon ticket.',
      provenance: 'run_5',
      id: '0012',
    }])
  })

  test('routes to a live daemon and treats queued create as success', async () => {
    const daemon = fakeCreateDaemon(202, { ok: true, queued: true, queuedId: 'ticket-create-0013', reservedTicketId: '0013', status: 'queued' })
    server = daemon.server
    const port = await daemon.ready

    const result = await runCreateTicket(['--title', 'Queued Ticket', '--type', 'task', '--description', 'Create after run.'], port)

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('queued ticket create 0013: ticket-create-0013')
    expect(process.exitCode).toBeUndefined()
  })

  test('uses the direct governed create path when the daemon is down', async () => {
    const result = await runCreateTicket(['--title', 'Direct Ticket', '--type', 'task', '--description', 'Create directly.'], null)

    expect(result.stdout).toContain('created ticket 0002:')
    expect(result.stderr).toBe('')
    expect(process.exitCode).toBeUndefined()
    await expect(readFile(join(result.repo, 'cocoder', 'tickets', 'open', '0002-direct-ticket.md'), 'utf8')).resolves.toContain('title: Direct Ticket')
    await expect(execFileAsync('git', ['log', '-1', '--format=%s'], { cwd: result.repo })).resolves.toMatchObject({
      stdout: 'governance: create ticket 0002\n',
    })
  })
})
