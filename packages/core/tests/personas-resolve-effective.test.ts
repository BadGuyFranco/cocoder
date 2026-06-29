import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { loadPersona, resolveEffectivePersona, type Assignments, type PersonaSources } from '../src/index.js'

const realBasePersonasDir = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'personas', 'base')

describe('resolveEffectivePersona', () => {
  test('resolves Oz with a normal assignment from the shipped base definition', async () => {
    const sources = await makeSources()
    const resolved = resolveEffectivePersona(
      { ...sources, baseDir: realBasePersonasDir() },
      { personas: { oz: { cli: 'codex', model: 'gpt-5' } } },
      'oz',
    )

    expect(resolved).toMatchObject({
      id: 'oz',
      label: 'Oz',
      role: 'Tier-3 control-plane persona — founder-facing orchestration agent for run lifecycle and oversight.',
      writeScope: [],
      cli: 'codex',
      model: 'gpt-5',
    })
  })

  test('attaches assignment to the base definition when no delta exists', async () => {
    const sources = await makeSources()
    await writePersona(sources.baseDir, { id: 'bob', label: 'Bob', role: 'Builder', scope: ['packages/**'], body: 'Base rules.' })

    const resolved = resolveEffectivePersona(sources, assignmentsFor('bob'), 'bob')
    const base = loadPersona(sources.baseDir, 'bob')

    expect(resolved).toEqual({ ...base, cli: 'codex', model: 'gpt-5' })
    expect('tier' in resolved).toBe(false)
    expect(resolved.body).toBe(base.body)
  })

  test('propagates assignment tier when present', async () => {
    const sources = await makeSources()
    await writePersona(sources.baseDir, { id: 'bob', label: 'Bob', role: 'Builder', scope: ['packages/**'], body: 'Base rules.' })

    const resolved = resolveEffectivePersona(sources, { personas: { bob: { cli: 'codex', model: '', tier: 'strong' } } }, 'bob')

    expect(resolved).toMatchObject({ id: 'bob', cli: 'codex', model: '', tier: 'strong' })
  })

  test('attaches assignment to a base definition merged with a repo delta', async () => {
    const sources = await makeSources()
    await writePersona(sources.baseDir, { id: 'bob', label: 'Bob', role: 'Builder', scope: ['packages/**'], body: 'Base rules.' })
    await writeFile(
      join(sources.deltaDir, 'bob.md'),
      ['---', 'id: bob', 'writeScope:', '  - cocoder/**', '---', 'Repo rules.'].join('\n'),
    )

    const resolved = resolveEffectivePersona(sources, assignmentsFor('bob'), 'bob')

    expect(resolved).toMatchObject({ id: 'bob', label: 'Bob', role: 'Builder', cli: 'codex', model: 'gpt-5' })
    expect(resolved.writeScope).toEqual(['packages/**', 'cocoder/**'])
    expect(resolved.body).toBe('Base rules.\n\n---\n\nRepo rules.')
  })

  test('attaches assignment to a repo-only persona when no base file exists', async () => {
    const sources = await makeSources()
    await writePersona(sources.repoPersonaDir, {
      id: 'phil',
      label: 'Phil',
      role: 'Extension builder',
      scope: ['plugins/**'],
      body: 'Repo-only rules.',
    })

    const resolved = resolveEffectivePersona(sources, assignmentsFor('phil'), 'phil')

    expect(resolved).toEqual({
      id: 'phil',
      label: 'Phil',
      role: 'Extension builder',
      writeScope: ['plugins/**'],
      body: 'Repo-only rules.',
      cli: 'codex',
      model: 'gpt-5',
    })
  })

  test('throws when the persona has no assignment', async () => {
    const sources = await makeSources()
    await writePersona(sources.baseDir, { id: 'bob', label: 'Bob', role: 'Builder', scope: ['packages/**'], body: 'Base rules.' })

    expect(() => resolveEffectivePersona(sources, { personas: {} }, 'bob')).toThrow(
      'persona "bob" has no assignment in assignments.json (not a live persona)',
    )
  })
})

async function makeSources(): Promise<PersonaSources> {
  const root = await mkdtemp(join(tmpdir(), 'resolve-effective-personas-'))
  const baseDir = join(root, 'base')
  const deltaDir = join(root, 'deltas')
  const repoPersonaDir = join(root, 'repo')
  await Promise.all([mkdir(baseDir), mkdir(deltaDir), mkdir(repoPersonaDir)])
  return { baseDir, deltaDir, repoPersonaDir }
}

function assignmentsFor(id: string): Assignments {
  return { personas: { [id]: { cli: 'codex', model: 'gpt-5' } } }
}

async function writePersona(
  dir: string,
  input: {
    readonly id: string
    readonly label: string
    readonly role: string
    readonly scope: readonly string[]
    readonly body: string
  },
): Promise<void> {
  await writeFile(
    join(dir, `${input.id}.md`),
    [
      '---',
      `id: ${input.id}`,
      `label: ${input.label}`,
      `role: ${input.role}`,
      'writeScope:',
      ...input.scope.map((entry) => `  - ${entry}`),
      '---',
      input.body,
    ].join('\n'),
  )
}
