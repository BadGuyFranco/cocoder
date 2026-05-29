import { describe, expect, test } from 'vitest'
import { clamp } from '../src/util/clamp.js'

describe('clamp', () => {
  test('returns min when value is below min', () => {
    expect(clamp(1, 2, 5)).toBe(2)
  })

  test('returns max when value is above max', () => {
    expect(clamp(6, 2, 5)).toBe(5)
  })

  test('returns value unchanged when value is within range', () => {
    expect(clamp(3, 2, 5)).toBe(3)
  })

  test('returns value unchanged when value equals each bound', () => {
    expect(clamp(2, 2, 5)).toBe(2)
    expect(clamp(5, 2, 5)).toBe(5)
  })

  test('throws RangeError when min is greater than max', () => {
    expect(() => clamp(3, 5, 2)).toThrow(RangeError)
    expect(() => clamp(3, 5, 2)).toThrow('clamp: min must be <= max')
  })
})
