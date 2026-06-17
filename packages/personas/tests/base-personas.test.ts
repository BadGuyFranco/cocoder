import { statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { basePersonasDir, basePlaysDir, basePrioritiesDir } from '../src/index.js'

const BASE_PERSONA_FILES = ['bob.md', 'deb.md', 'oscar.md', 'oz.md', 'quinn.md', 'talia.md', 'shared-standards.md'] as const
const FRONTMATTER_PERSONA_FILES = ['bob.md', 'deb.md', 'oscar.md', 'oz.md', 'quinn.md', 'talia.md'] as const
const NEW_BASE_PLAY_FILES = ['documentation.md', 'code-review.md', 'electron-test.md'] as const
const READ_ONLY_BASE_PLAY_FILES = ['code-review.md', 'electron-test.md'] as const

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
    expect(text).toContain('Default to direct repair when told about an orchestration issue')
    expect(text).toContain('Use a full Oscar/Bob/Deb run only when')
    expect(text).toContain('Make orchestration repairs stick')
    expect(text).toContain('Do not leave a low-risk orchestration fix as an')
    expect(text).toContain('Repair evidence')
  })

  test('shared standards require owner-mapped durable orchestration changes', () => {
    const text = readFileSync(join(basePersonasDir(), 'shared-standards.md'), 'utf8')

    expect(text).toContain('Durable orchestration changes')
    expect(text).toContain('do an owner map before editing')
    expect(text).toContain('A prompt-only change is incomplete')
    expect(text).toContain('commit the verified in-scope fix yourself')
    expect(text).toContain('high risk of breaking')
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

  test('loads and validates the generic content and user-simulation plays', () => {
    for (const file of NEW_BASE_PLAY_FILES) {
      const id = file.slice(0, -3)
      const text = readFileSync(join(basePlaysDir(), file), 'utf8')
      const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()

      expect(frontmatterValue(text, 'id')).toBe(id)
      expect(frontmatterValue(text, 'label')?.length).toBeGreaterThan(0)
      expect(frontmatterValue(text, 'kind')).toBe('headless')
      expect(body.length).toBeGreaterThan(0)
      expect(body).not.toMatch(/cocoder/i)
      expect(body).not.toContain('Oz')
    }
  })

  test('read-only base plays declare an empty write scope', () => {
    for (const file of READ_ONLY_BASE_PLAY_FILES) {
      const text = readFileSync(join(basePlaysDir(), file), 'utf8')

      expect(frontmatterList(text, 'writeScope')).toEqual([])
      expect(frontmatterValue(text, 'writeScope')).toBe('[]')
    }
  })

  test('wrap-up leads with a scannable Run Handoff whose "Your move" is one runnable action (F18)', () => {
    const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')

    expect(text).toContain('Run Handoff')
    expect(text).toContain('► Your move')
    expect(text).toContain('exactly ONE **runnable** action')
    expect(text).toContain('could a solo non-developer DO it from this one line')
    expect(text).toMatch(/never "awaiting questions"/)
  })

  // ADR-0022 proof #2: the wrap-up Play is the SINGLE owner of the founder closeout format.
  // Pin the Run Handoff fields + the detail sections so no surface can silently drift a parallel shape.
  test('wrap-up Play pins the canonical Run Handoff + detail contract (single owner)', () => {
    const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')
    // The handoff block answers "what do I do next?" at a glance.
    for (const field of ['Priority worked', 'Disposition', 'This run', 'Held back', 'Next priority', '► Your move']) {
      expect(text).toContain(field)
    }
    // The detail sections it solely owns follow the handoff.
    for (const s of ['Summary', 'Archive Estimate', 'Founder Options']) {
      expect(text).toContain(`- \`${s}\``)
    }
  })

  // ADR-0022 proof #2: Oscar must defer to the wrap-up Play's contract, not restate a parallel format.
  test('oscar defers to the wrap-up Play as the closeout-brief owner', () => {
    const text = readFileSync(join(basePersonasDir(), 'oscar.md'), 'utf8')
    expect(text).toContain("wrap-up Play's closeout-brief contract")
    expect(text).not.toContain('Report back to the founder in the standardized format')
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
