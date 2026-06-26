import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { detectRunnerImpact, loadPriority, RUN_CRITICAL_GLOBS } from '../src/index.js'
import type { Priority } from '../src/index.js'

const basePriority: Priority = {
  id: 'demo',
  title: 'Demo',
  scopeNarrowing: null,
  goal: 'Do the small thing.',
  objective: null,
}
const storeScope = RUN_CRITICAL_GLOBS[2]!

function priorityMarkdown(id: string, frontmatter: readonly string[] = []): string {
  return ['---', `id: ${id}`, `title: ${id}`, ...frontmatter, '---', 'Do the small thing.'].join('\n')
}

describe('detectRunnerImpact', () => {
  test('fires when priority scope touches run-critical machinery', () => {
    const result = detectRunnerImpact({ ...basePriority, scopeNarrowing: [storeScope] })

    expect(result.impacts).toBe(true)
    expect(result.reasons).toContain(`scopeNarrowing "${storeScope}" intersects run-critical machinery "${storeScope}"`)
  })

  test('fires when priority is marked destructive without machinery scope', () => {
    const result = detectRunnerImpact({ ...basePriority, destructive: true })

    expect(result).toEqual({ impacts: true, reasons: ['priority is marked destructive'] })
  })

  test('does not fire for ordinary non-runner scopes', () => {
    expect(detectRunnerImpact({ ...basePriority, scopeNarrowing: ['packages/web/**'] })).toEqual({ impacts: false, reasons: [] })
    expect(detectRunnerImpact({ ...basePriority, scopeNarrowing: ['docs/**'] })).toEqual({ impacts: false, reasons: [] })
  })

  test('notes when an impacting priority is already marked independent of runner', () => {
    const result = detectRunnerImpact({
      ...basePriority,
      independentOfRunner: true,
      scopeNarrowing: [storeScope],
    })

    expect(result.impacts).toBe(true)
    expect(result.reasons).toContain('priority is already marked independent-of-runner')
  })
})

describe('priority runner-impact markers', () => {
  test('round-trips independent-of-runner and destructive markers with false defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runner-impact-priorities-'))
    await writeFile(join(dir, 'marked.md'), priorityMarkdown('marked', ['independent-of-runner: true', 'destructive: true']), 'utf8')
    await writeFile(join(dir, 'bare.md'), priorityMarkdown('bare'), 'utf8')

    expect(loadPriority(dir, 'marked')).toMatchObject({ independentOfRunner: true, destructive: true })
    expect(loadPriority(dir, 'bare')).toMatchObject({ independentOfRunner: false, destructive: false })
  })
})
