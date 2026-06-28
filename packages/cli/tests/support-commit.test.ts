import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { supportCommitViaCli } from '../src/support-commit.js'
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

async function supportRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'cocoder-support-commit-'))
  dirs.push(repo)
  await mkdir(join(repo, 'cocoder', 'personas'), { recursive: true })
  await mkdir(join(repo, 'cocoder', 'priorities', 'archive'), { recursive: true })
  await mkdir(join(repo, 'docs'), { recursive: true })
  await mkdir(join(repo, 'packages', 'ui'), { recursive: true })
  await writeFile(join(repo, '.gitignore'), '/local/\n')
  await writeFile(join(repo, 'cocoder', 'personas', 'assignments.json'), JSON.stringify({ personas: { oscar: { cli: 'fake', model: 'fake-model' } } }))
  await writeFile(join(repo, 'cocoder', 'priorities', 'demo.md'), '---\nid: demo\ntitle: Demo\n---\n## Objective\nDemo.\n')
  await writeFile(join(repo, 'docs', 'support.md'), 'initial support\n')
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  await execFileAsync('git', ['add', '.'], { cwd: repo })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo })
  return repo
}

async function runMain(repo: string, args: readonly string[], daemonPort: number | null): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const previousArgv = process.argv
  const previousCwd = process.cwd()
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
    process.argv = [process.execPath, 'cocoder', ...args]
    await main({
      probeDaemonImpl: async () => daemonPort === null ? { alive: false, port: 7878 } : { alive: true, port: daemonPort },
    })
    return { stdout: stdout.join(''), stderr: stderr.join('\n') }
  } finally {
    process.argv = previousArgv
    process.chdir(previousCwd)
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  }
}

function unknownRunDaemon(): { readonly server: Server; readonly ready: Promise<number> } {
  const s = createServer((req, res) => {
    if (req.url === '/auth/session') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ bearerToken: 'tok', csrfToken: 'csrf' }))
    }
    if (req.method === 'POST' && req.url === '/runs/run_137/support-commit') {
      res.writeHead(404, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: 'unknown run' }))
    }
    res.writeHead(404)
    res.end()
  })
  return {
    server: s,
    ready: new Promise<number>((resolve) =>
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address()
        resolve(typeof addr === 'object' && addr ? addr.port : 0)
      }),
    ),
  }
}

describe('supportCommitViaCli', () => {
  test('commits daemon-free independent support edits with a real receipt', async () => {
    const repo = await supportRepo()
    await writeFile(join(repo, 'docs', 'support.md'), 'updated support\n')

    const result = await supportCommitViaCli({ repoPath: repo, runId: 'run_137' })

    expect(result).toMatchObject({ ok: true, committedPaths: ['docs/support.md'], outOfLanePaths: [] })
    expect(result.ok && result.commitSha).toMatch(/^[0-9a-f]{40}$/)
    await expect(execFileAsync('git', ['status', '--porcelain'], { cwd: repo })).resolves.toMatchObject({ stdout: '' })
    await expect(execFileAsync('git', ['show', '--name-only', '--format=%s', 'HEAD'], { cwd: repo })).resolves.toMatchObject({
      stdout: expect.stringContaining('oscar-post-wrap: support via CoCoder run run_137'),
    })
  })

  test('refuses archive-bypass edits in the standalone path', async () => {
    const repo = await supportRepo()
    await rename(join(repo, 'cocoder', 'priorities', 'demo.md'), join(repo, 'cocoder', 'priorities', 'archive', 'demo.md'))

    const result = await supportCommitViaCli({ repoPath: repo, runId: 'run_137' })

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('archive-priority demo') })
    expect(result.ok === false ? result.refusedPaths : []).toEqual(expect.arrayContaining(['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md']))
    await expect(execFileAsync('git', ['log', '-1', '--format=%s'], { cwd: repo })).resolves.toMatchObject({ stdout: 'initial\n' })
  })

  test('commits and flags out-of-lane support edits in the standalone path', async () => {
    const repo = await supportRepo()
    await writeFile(join(repo, 'docs', 'support.md'), 'updated support\n')
    await writeFile(join(repo, 'packages', 'ui', 'stray.ts'), 'export const stray = true\n')

    const result = await supportCommitViaCli({ repoPath: repo, runId: 'run_137' })

    expect(result).toMatchObject({
      ok: true,
      committedPaths: ['docs/support.md', 'packages/ui/stray.ts'],
      outOfLanePaths: ['packages/ui/stray.ts'],
    })
    await expect(execFileAsync('git', ['status', '--porcelain'], { cwd: repo })).resolves.toMatchObject({ stdout: '' })
  })
})

describe('cocoder oz commit-support fallback', () => {
  test('falls back to standalone commit when a live daemon does not know an independent run', async () => {
    const repo = await supportRepo()
    await writeFile(join(repo, 'docs', 'support.md'), 'updated support\n')
    const daemon = unknownRunDaemon()
    server = daemon.server
    const port = await daemon.ready

    const result = await runMain(repo, ['oz', 'commit-support', 'run_137'], port)

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('committed support edits for run_137:')
    expect(result.stdout).toContain('files: docs/support.md')
    await expect(execFileAsync('git', ['status', '--porcelain'], { cwd: repo })).resolves.toMatchObject({ stdout: '' })
  })

  test('uses standalone support commit directly when the daemon is down', async () => {
    const repo = await supportRepo()
    await writeFile(join(repo, 'docs', 'support.md'), 'updated support\n')

    const result = await runMain(repo, ['oz', 'commit-support', 'run_137'], null)

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('committed support edits for run_137:')
    expect(result.stdout).toContain('files: docs/support.md')
  })
})
