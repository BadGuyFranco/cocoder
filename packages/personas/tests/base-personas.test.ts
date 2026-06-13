import { statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { basePersonasDir, basePlaysDir, basePrioritiesDir } from '../src/index.js'

const BASE_PERSONA_FILES = ['oscar.md', 'bob.md', 'deb.md', 'shared-standards.md'] as const
const FRONTMATTER_PERSONA_FILES = ['oscar.md', 'bob.md', 'deb.md'] as const

const frontmatterValue = (text: string, key: string): string | null => {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return match?.[1]?.replace(/^["']|["']$/g, '') ?? null
}

const frontmatterList = (text: string, key: string): string[] => {
  const match = text.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`, 'm'))
  return match?.[1]?.split(/\r?\n/).filter(Boolean).map((line) => line.replace(/^\s*-\s+/, '')) ?? []
}

describe('basePersonasDir', () => {
  test('resolves to the shipped base persona directory', () => {
    const dir = basePersonasDir()

    expect(statSync(dir).isDirectory()).toBe(true)
  })

  test('contains the shipped base persona files', () => {
    const dir = basePersonasDir()

    for (const file of BASE_PERSONA_FILES) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text.length).toBeGreaterThan(0)
    }
  })

  test('keeps persona definition files frontmatter-backed', () => {
    const dir = basePersonasDir()

    for (const file of FRONTMATTER_PERSONA_FILES) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text.split(/\r?\n/, 1)[0]).toBe('---')
    }
  })

  test('Deb base scope covers the governance surfaces incl. tickets (ADR-0016 recurrence escalation)', () => {
    const text = readFileSync(join(basePersonasDir(), 'deb.md'), 'utf8')
    const scope = frontmatterList(text, 'writeScope')
    expect(scope).toEqual(expect.arrayContaining(['cocoder/priorities/**', 'cocoder/decisions/**', 'cocoder/personas/**', 'cocoder/tickets/**']))
    expect(text).toContain('Make orchestration repairs stick')
    expect(text).toContain('Repair evidence')
  })

  test('shared standards require owner-mapped durable orchestration changes', () => {
    const text = readFileSync(join(basePersonasDir(), 'shared-standards.md'), 'utf8')

    expect(text).toContain('Durable orchestration changes')
    expect(text).toContain('do an owner map before editing')
    expect(text).toContain('A prompt-only change is incomplete')
  })

  test('Oscar base scope covers support artifacts the runner can commit at wrap', () => {
    const scope = frontmatterList(readFileSync(join(basePersonasDir(), 'oscar.md'), 'utf8'), 'writeScope')
    expect(scope).toEqual(expect.arrayContaining(['cocoder/priorities/**', 'cocoder/tickets/**', 'docs/**', 'ARCHITECTURE.md']))
  })
})

describe('basePlaysDir', () => {
  test('resolves to the shipped base plays directory', () => {
    const dir = basePlaysDir()

    expect(statSync(dir).isDirectory()).toBe(true)
  })

  test('loads and validates the seeded wrap-up play', () => {
    const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()

    expect(frontmatterValue(text, 'id')).toBe('wrap-up')
    expect(frontmatterValue(text, 'kind')).toBe('headless')
    expect(body.length).toBeGreaterThan(0)
    expect(frontmatterList(text, 'writeScope').length).toBeGreaterThan(0)
  })

  test('wrap-up requires a concrete next action for founder handoff', () => {
    const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')

    expect(text).toContain('Name exactly one `Next Action`')
    expect(text).toContain('specific enough for the founder to act on without another clarification turn')
    expect(text).toMatch(/Do not use "awaiting\s+questions"/)
    expect(text).toContain('- `Next Action`')
  })
})

describe('basePrioritiesDir', () => {
  test('resolves to the shipped base priorities directory', () => {
    const dir = basePrioritiesDir()

    expect(statSync(dir).isDirectory()).toBe(true)
  })

  test('ships a product-generic ad-hoc session template', () => {
    const dir = basePrioritiesDir()
    const text = readFileSync(join(dir, 'adhoc-session.md'), 'utf8')

    expect(frontmatterValue(text, 'id')).toBe('adhoc-session')
    expect(frontmatterValue(text, 'title')).toBe('Session without a named priority')
    expect(text).toContain('## Objective')
    expect(text).not.toMatch(/CoBuilder|CoCoder|dogfood/i)
  })
})
