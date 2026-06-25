import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { listEffectivePlays, loadEffectivePlay, type PlaySources } from '../src/index.js'

const repoRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const sources = (): PlaySources => ({
  baseDir: join(repoRoot(), 'packages', 'personas', 'base', 'plays'),
  deltaDir: join(repoRoot(), 'cocoder', 'plays', 'deltas'),
  repoPlayDir: join(repoRoot(), 'cocoder', 'plays'),
})

const authoringPlayIds = ['archive-priority', 'create-priority', 'edit-priority'] as const

describe('priority authoring Plays', () => {
  test.each(authoringPlayIds)('%s loads as a headless governance authoring Play', (id) => {
    const play = loadEffectivePlay(sources().baseDir, sources().deltaDir, id)

    expect(play.id).toBe(id)
    expect(play.kind).toBe('headless')
    expect(play.writeScope).toContain('cocoder/priorities/**')
    expect(play.body.trim()).not.toBe('')
  })

  test('catalog lists all priority authoring Plays from the base Play directory', () => {
    const ids = listEffectivePlays(sources()).map((play) => play.id)

    expect(ids).toEqual(expect.arrayContaining([...authoringPlayIds]))
  })

  test('edit-priority instructs atom edits to preserve systematic execution order', () => {
    const play = loadEffectivePlay(sources().baseDir, sources().deltaDir, 'edit-priority')

    expect(play.body).toContain('If the edit adds or changes implementation atoms')
    expect(play.body).toContain('decision/taxonomy work before schema changes')
    expect(play.body).toMatch(/proof\/verification\s+last/)
    expect(play.body).toContain('independently delegable')
  })

  test('edit-priority documents verbatim detailed-body edit modes', () => {
    const play = loadEffectivePlay(sources().baseDir, sources().deltaDir, 'edit-priority')

    expect(play.body).toContain('replace-body')
    expect(play.body).toContain('append-section')
  })

  test.each(authoringPlayIds)('%s requires the elegance checkpoint before writing or finishing', (id) => {
    const play = loadEffectivePlay(sources().baseDir, sources().deltaDir, id)

    expect(play.body).toContain('elegance checkpoint')
  })

  test.each(['create-ticket', 'documentation'])('%s steps into the elegance checkpoint in its body', (id) => {
    const play = loadEffectivePlay(sources().baseDir, sources().deltaDir, id)

    expect(play.body).toContain('elegance checkpoint')
  })

  test('archive-priority owns archive disposition notes and archived-priority backfills', () => {
    const play = loadEffectivePlay(sources().baseDir, sources().deltaDir, 'archive-priority')

    expect(play.body).toContain('founder/Oscar disposition fields')
    expect(play.body).toContain('> **Archived YYYY-MM-DD (founder) — <verdict>.**')
    expect(play.body).toContain('backfill the disposition note')
    expect(play.body).toContain('already-archived priority')
  })

  test('archive-priority names the daemon-backed invocation lane and rejects skill/raw archive paths', () => {
    const play = loadEffectivePlay(sources().baseDir, sources().deltaDir, 'archive-priority')

    expect(play.body).toContain('This Play is the one archive process')
    expect(play.body).toContain('not a native harness Skill')
    expect(play.body).toContain('do not invoke `Skill(...)`')
    expect(play.body).toContain('do not archive by hand with a raw\nfile move or post-wrap support commit')
    expect(play.body).toContain('use exactly one `author` tool call with `play: "archive-priority"`')
    expect(play.body).toContain('pnpm --dir <install-root> exec cocoder oz archive-priority <priorityId>')
    expect(play.body).toContain('POST /workspaces/:id/authoring-plays/archive-priority')
    expect(play.body).toContain('do not try to archive by writing a builder\ndirective')
  })

  test('Architect Play System priority includes elegance checkpoint contract migration', async () => {
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(join(repoRoot(), 'cocoder', 'priorities', 'archive', 'hybrid-plays.md'), 'utf8')

    expect(text).toContain('required checkpoints such as the shared elegance checkpoint')
    expect(text).toContain('whether the\n   shared elegance checkpoint is required')
    expect(text).toContain('authoring Plays enforce the shared elegance checkpoint')
  })

  test('ADR-0010 requires wrapper-backed Plays to document executable lanes', async () => {
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(join(repoRoot(), 'cocoder', 'decisions', '0010-taxonomy-and-authoring.md'), 'utf8')

    expect(text).toContain('wrapper-backed Plays must document their executable')
    expect(text).toContain('the exact tool/API/CLI surface')
    expect(text).toContain('required fields, defaults supplied by wrappers')
    expect(text).toContain('bounded help and missing')
  })
})
