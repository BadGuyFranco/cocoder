import { describe, expect, test } from 'vitest'
import { buildBuilderDispatch } from '../src/index.js'

describe('buildBuilderDispatch', () => {
  test('keeps non-loop dispatch text unchanged', () => {
    expect(buildBuilderDispatch('/runs/run_1/directive-2.json', 2)).toBe(
      'PROCEED — this is atom 2. Read your task from /runs/run_1/directive-2.json and implement it now within your write-scope. When you are fully done (tests/typecheck run), print your completion marker for atom 2 on its own line, exactly as your standby instructions describe.',
    )
  })

  test('adds the loop ledger contract only for loop atoms', () => {
    const text = buildBuilderDispatch('/runs/run_1/directive-2.json', 2, '/runs/run_1/loop-ledger-2.jsonl')
    expect(text).toContain('/runs/run_1/loop-ledger-2.jsonl')
    expect(text).toContain('"result":"green"|"red"')
  })
})
