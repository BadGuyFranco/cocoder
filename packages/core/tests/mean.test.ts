import { describe, expect, test } from 'vitest'
import { mean } from '../src/util/mean.js'

describe('mean', () => {
  test('returns 0 for an empty array', () => {
    expect(mean([])).toBe(0)
  })

  test('returns a single value unchanged', () => {
    expect(mean([5])).toBe(5)
  })

  test('returns the mean of several positive values', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
  })

  test('returns 0 for balanced negative and positive values', () => {
    expect(mean([-2, 2])).toBe(0)
  })

  test('returns a negative non-zero mean', () => {
    expect(mean([-4, -2, 3])).toBe(-1)
  })

  test('returns a non-integer mean', () => {
    expect(mean([1, 2])).toBe(1.5)
  })
})
