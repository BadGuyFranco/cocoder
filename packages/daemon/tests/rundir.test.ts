import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readRunDir } from '../src/rundir.js'

describe('readRunDir', () => {
  test('loads run detail artifacts from a nested workspace run dir', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-rundir-'))
    await mkdir(join(runsRoot, 'cocoder', 'run_nested'), { recursive: true })
    await writeFile(join(runsRoot, 'cocoder', 'run_nested', 'pickup.md'), '# Nested pickup')

    await expect(readRunDir(runsRoot, { workspaceId: 'cocoder', id: 'run_nested' })).resolves.toMatchObject({
      pickup: '# Nested pickup',
    })
  })

  test('loads run detail artifacts from a legacy flat run dir by id', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-rundir-'))
    await mkdir(join(runsRoot, 'run_legacy'), { recursive: true })
    await writeFile(join(runsRoot, 'run_legacy', 'record.md'), '# Legacy record')

    await expect(readRunDir(runsRoot, 'run_legacy')).resolves.toMatchObject({
      record: '# Legacy record',
    })
  })
})
