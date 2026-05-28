import { describe, expect, test } from 'vitest'
import { truncate } from '../src/util/truncate.js'

describe('truncate', () => {
  test('returns text shorter than max unchanged', () => {
    expect(truncate('abc', 5)).toBe('abc')
  })

  test('returns text exactly max length unchanged', () => {
    expect(truncate('abc', 3)).toBe('abc')
  })

  test('truncates longer text to exactly max chars with one ellipsis', () => {
    const result = truncate('abcdef', 4)

    expect(result).toHaveLength(4)
    expect(result).toBe('abc…')
    expect(result.startsWith('abc')).toBe(true)
    expect(result.endsWith('…')).toBe(true)
  })

  test('handles max of one', () => {
    expect(truncate('abc', 1)).toBe('…')
    expect(truncate('abc', 1)).toHaveLength(1)
    expect(truncate('', 1)).toBe('')
    expect(truncate('a', 1)).toBe('a')
  })

  test('throws RangeError when max is less than one', () => {
    expect(() => truncate('abc', 0)).toThrow(RangeError)
    expect(() => truncate('abc', -1)).toThrow('truncate: max must be >= 1')
  })
})
