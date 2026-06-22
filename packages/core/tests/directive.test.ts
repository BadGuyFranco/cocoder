import { describe, expect, test } from 'vitest'
import { MalformedLoopDirectiveError, parseDirective } from '../src/runner/index.js'

describe('parseDirective', () => {
  test('parses a loop delegate directive and applies maxIterations default', () => {
    expect(
      parseDirective(
        JSON.stringify({
          kind: 'delegate',
          task: 'fix it',
          loop: {
            goal: 'Make the criterion green',
            criterion: 'pnpm test exits 0',
            wallClockMs: 45 * 60 * 1000,
            writeBoundary: ['packages/core/src/runner/directive.ts'],
          },
        }),
      ),
    ).toEqual({
      kind: 'delegate',
      task: 'fix it',
      loop: {
        goal: 'Make the criterion green',
        criterion: 'pnpm test exits 0',
        maxIterations: 5,
        wallClockMs: 45 * 60 * 1000,
        writeBoundary: ['packages/core/src/runner/directive.ts'],
      },
    })
  })

  test('keeps prose delegate and wrapup directives unchanged', () => {
    expect(parseDirective(JSON.stringify({ kind: 'delegate', task: 'do the thing' }))).toEqual({ kind: 'delegate', task: 'do the thing' })
    expect(parseDirective(JSON.stringify({ kind: 'wrapup', pickup: 'resume here' }))).toEqual({ kind: 'wrapup', pickup: 'resume here' })
  })

  test('rejects the removed Deb investigation directive kind', () => {
    expect(() => parseDirective(JSON.stringify({ kind: 'deb-investigate', blocker: 'Oscar cannot write the verify artifact because the runner named a missing path' }))).toThrow(
      'directive: "kind" must be "delegate" or "wrapup"',
    )
  })

  test.each([
    ['missing wallClockMs', { goal: 'g', criterion: 'c' }],
    ['empty criterion', { goal: 'g', criterion: ' ', wallClockMs: 1000 }],
    ['bad maxIterations type', { goal: 'g', criterion: 'c', maxIterations: '5', wallClockMs: 1000 }],
    ['non-positive wallClockMs', { goal: 'g', criterion: 'c', wallClockMs: 0 }],
    ['bad writeBoundary type', { goal: 'g', criterion: 'c', wallClockMs: 1000, writeBoundary: ['ok', ' '] }],
  ])('rejects malformed loop directives loudly: %s', (_name, loop) => {
    expect(() => parseDirective(JSON.stringify({ kind: 'delegate', task: 'do the thing', loop }))).toThrow(MalformedLoopDirectiveError)
  })
})
