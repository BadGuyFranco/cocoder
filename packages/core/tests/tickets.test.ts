import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { nextTicketId } from '../src/index.js'

describe('ticket id allocation', () => {
  test('allocates after the highest four-digit ticket id across open and closed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    await mkdir(join(dir, 'closed'), { recursive: true })
    await writeFile(join(dir, 'open', '0003-open.md'), 'open')
    await writeFile(join(dir, 'closed', '0012-closed.md'), 'closed')
    await writeFile(join(dir, 'open', 'notes.md'), 'ignored')

    await expect(nextTicketId(dir)).resolves.toBe('0013')
  })

  test('starts at 0001 when ticket state directories are absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-empty-'))

    await expect(nextTicketId(dir)).resolves.toBe('0001')
  })
})
