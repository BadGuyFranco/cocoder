import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadEffectivePersona } from '../src/index.js'

// ADR-0012 proof: base improvement propagates to an already-extended repo.
describe('persona base propagation', () => {
  test('re-reads base persona improvements while preserving repo delta', async () => {
    const root = await mkdtemp(join(tmpdir(), 'persona-propagation-'))
    const baseDir = join(root, 'base')
    const deltaDir = join(root, 'deltas')
    await Promise.all([mkdir(baseDir), mkdir(deltaDir)])

    await writeBase(baseDir, 'BASE-RULE-V1')
    await writeFile(
      join(deltaDir, 'oscar.md'),
      ['---', 'id: oscar', 'writeScope:', '  - cocoder/**', '---', 'REPO-EXTENSION'].join('\n'),
    )

    const before = loadEffectivePersona(baseDir, deltaDir, 'oscar')
    expect(before.body).toContain('BASE-RULE-V1')
    expect(before.body).toContain('REPO-EXTENSION')
    expect(before.writeScope).toEqual(['packages/**', 'cocoder/**'])

    await writeBase(baseDir, 'BASE-RULE-V2')

    const after = loadEffectivePersona(baseDir, deltaDir, 'oscar')
    expect(after.body).toContain('BASE-RULE-V2')
    expect(after.body).not.toContain('BASE-RULE-V1')
    expect(after.body).toContain('REPO-EXTENSION')
    expect(after.writeScope).toEqual(['packages/**', 'cocoder/**'])
  })
})

async function writeBase(baseDir: string, bodyLine: string): Promise<void> {
  await writeFile(
    join(baseDir, 'oscar.md'),
    ['---', 'id: oscar', 'label: Oscar', 'role: Orchestrator', 'writeScope:', '  - packages/**', '---', bodyLine].join('\n'),
  )
}
