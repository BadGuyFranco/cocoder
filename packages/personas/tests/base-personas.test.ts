import { statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { basePersonasDir, basePlaysDir } from '../src/index.js'

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
})
