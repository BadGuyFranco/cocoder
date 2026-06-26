import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function repoWithPriority(marked: boolean): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'cocoder-run-independent-'))
  dirs.push(repo)
  await mkdir(join(repo, 'cocoder', 'priorities'), { recursive: true })
  await writeFile(
    join(repo, 'cocoder', 'priorities', 'demo.md'),
    [
      '---',
      'id: demo',
      'title: Demo',
      ...(marked ? ['independent-of-runner: true'] : []),
      '---',
      '## Objective',
      'Do the thing.',
      '',
    ].join('\n'),
  )
  return repo
}

describe('cocoder run-independent', () => {
  test('refuses a priority that is not explicitly marked independent-of-runner', async () => {
    const repo = await repoWithPriority(false)
    const cli = fileURLToPath(new URL('../bin/cocoder.mjs', import.meta.url))

    const run = execFileAsync(process.execPath, [cli, 'run-independent', 'demo'], { cwd: repo }).catch((err: unknown) => err)

    await expect(run).resolves.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('not marked independent-of-runner: true'),
    })
  })
})
