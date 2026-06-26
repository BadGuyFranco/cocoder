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

  test('keeps prose delegate, founder-continue, and wrapup directives unchanged', () => {
    expect(parseDirective(JSON.stringify({ kind: 'delegate', task: 'do the thing' }))).toEqual({ kind: 'delegate', task: 'do the thing' })
    expect(parseDirective(JSON.stringify({ kind: 'ask-founder-continue', question: 'Should we keep the compatibility shim?' }))).toEqual({
      kind: 'ask-founder-continue',
      question: 'Should we keep the compatibility shim?',
    })
    expect(parseDirective(JSON.stringify({ kind: 'wrapup', pickup: 'resume here' }))).toEqual({ kind: 'wrapup', pickup: 'resume here' })
  })

  test('parses delegate writePaths', () => {
    expect(parseDirective(JSON.stringify({ kind: 'delegate', task: 'do the thing', writePaths: ['packages/core/src/foo.ts'] }))).toEqual({
      kind: 'delegate',
      task: 'do the thing',
      writePaths: ['packages/core/src/foo.ts'],
    })
  })

  test('rejects the removed Deb investigation directive kind', () => {
    expect(() => parseDirective(JSON.stringify({ kind: 'deb-investigate', blocker: 'Oscar cannot write the verify artifact because the runner named a missing path' }))).toThrow(
      'directive: "kind" must be "delegate", "ask-founder-continue", or "wrapup"',
    )
  })

  test('rejects malformed founder-continue directives loudly', () => {
    expect(() => parseDirective(JSON.stringify({ kind: 'ask-founder-continue', question: ' ' }))).toThrow(
      'directive: "ask-founder-continue" requires a non-empty "question"',
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

  test.each([
    ['empty array', []],
    ['non-string entry', ['packages/core/src/foo.ts', 3]],
    ['empty string entry', ['packages/core/src/foo.ts', ' ']],
  ])('rejects malformed delegate writePaths: %s', (_name, writePaths) => {
    expect(() => parseDirective(JSON.stringify({ kind: 'delegate', task: 'do the thing', writePaths }))).toThrow(
      'directive: "delegate" "writePaths" must be a non-empty string array',
    )
  })
})
