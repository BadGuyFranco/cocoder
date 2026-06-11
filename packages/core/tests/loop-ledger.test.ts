import { describe, expect, test } from 'vitest'
import { parseLoopLedger } from '../src/runner/loop-ledger.js'

describe('parseLoopLedger', () => {
  test('keeps valid iteration lines and skips malformed lines', () => {
    expect(
      parseLoopLedger(
        [
          '{"iteration":1,"result":"red","failed":"test failed","changed":"edited x","inScope":true}',
          'not json',
          '{"iteration":2,"result":"red","failed":"missing inScope","changed":"edited y"}',
          '{"iteration":3,"result":"green","failed":"","changed":"all green","inScope":true}',
        ].join('\n'),
      ),
    ).toEqual([
      { iteration: 1, result: 'red', failed: 'test failed', changed: 'edited x', inScope: true },
      { iteration: 3, result: 'green', failed: '', changed: 'all green', inScope: true },
    ])
  })
})
