import { describe, expect, test } from 'vitest'
import { mergePersona, PersonaMergeError, type Persona } from '../src/index.js'

const base: Persona = {
  id: 'bob',
  label: 'Bob',
  role: 'Builder',
  writeScope: ['packages/**'],
  body: 'Base rules.',
}

describe('mergePersona', () => {
  test('returns a deep-equal persona for an empty delta without changing body bytes', () => {
    const merged = mergePersona(base, { id: 'bob' })

    expect(merged).toEqual(base)
    expect(merged).not.toBe(base)
    expect(merged.body).toBe(base.body)
  })

  test('appends a body-only delta with one separator', () => {
    const merged = mergePersona({ ...base, body: 'Base rules.\n\n' }, { id: 'bob', body: '\nDelta rules.' })

    expect(merged.body).toBe('Base rules.\n\n---\n\nDelta rules.')
  })

  test('overrides label and role', () => {
    const merged = mergePersona(base, { id: 'bob', label: 'Bobby', role: 'Architect' })

    expect(merged.label).toBe('Bobby')
    expect(merged.role).toBe('Architect')
  })

  test('unions write scope with stable de-duplication', () => {
    const merged = mergePersona(base, { id: 'bob', writeScope: ['cocoder/**', 'packages/**'] })

    expect(merged.writeScope).toEqual(['packages/**', 'cocoder/**'])
  })

  test('throws a typed error when ids do not match', () => {
    expect(() => mergePersona(base, { id: 'talia' })).toThrow(PersonaMergeError)
    expect(() => mergePersona(base, { id: 'talia' })).toThrow(/does not match/)
  })

  test('treats whitespace-only body as no body delta', () => {
    const merged = mergePersona(base, { id: 'bob', body: ' \n\t ' })

    expect(merged.body).toBe(base.body)
  })
})
