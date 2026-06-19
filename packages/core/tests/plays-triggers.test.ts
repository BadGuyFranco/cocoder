import { describe, expect, test } from 'vitest'
import { resolveMandatoryPlay, type Play } from '../src/index.js'

const play = (overrides: Partial<Play> = {}): Play => ({
  id: 'wrap-up',
  label: 'Wrap-up',
  kind: 'headless',
  executionModel: 'prompt-only',
  triggerClass: 'lifecycle-triggered',
  purpose: 'Produce the founder-visible run closeout.',
  allowedCallers: ['runner wrap-up lifecycle'],
  writeScope: ['cocoder/SESSION_LOG.md'],
  body: 'Wrap the run.',
  ...overrides,
})

describe('mandatory Play trigger registry', () => {
  test('resolves the run-wrap trigger to the wrap-up Play', () => {
    const resolved = resolveMandatoryPlay('run-wrap', [play()])

    expect(resolved.id).toBe('wrap-up')
    expect(resolved.writeScope).toEqual(['cocoder/SESSION_LOG.md'])
  })

  test('throws when a mandatory trigger is bound to a non-mandatory Play', () => {
    expect(() =>
      resolveMandatoryPlay('run-wrap', [
        play({
          triggerClass: 'persona-requested',
        }),
      ]),
    ).toThrow(/mandatory Play trigger "run-wrap" is bound to non-mandatory Play "wrap-up"/)
  })

  test('throws when the bound Play is missing from the effective catalog', () => {
    expect(() => resolveMandatoryPlay('run-wrap', [])).toThrow(/mandatory Play trigger "run-wrap" is bound to missing Play "wrap-up"/)
  })
})
