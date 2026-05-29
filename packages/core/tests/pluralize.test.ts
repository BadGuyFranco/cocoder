import { describe, expect, test } from 'vitest'
import { pluralize } from '../src/util/pluralize.js'

describe('pluralize', () => {
  test('returns singular when count is one', () => {
    expect(pluralize(1, 'file')).toBe('file')
  })

  test('returns default plural when count is zero', () => {
    expect(pluralize(0, 'file')).toBe('files')
  })

  test('returns default plural when count is two', () => {
    expect(pluralize(2, 'file')).toBe('files')
  })

  test('returns plural for negative counts', () => {
    expect(pluralize(-1, 'file')).toBe('files')
  })

  test('uses explicit plural override except when count is one', () => {
    expect(pluralize(2, 'person', 'people')).toBe('people')
    expect(pluralize(1, 'person', 'people')).toBe('person')
  })
})
