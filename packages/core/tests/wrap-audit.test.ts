// ADR-0041 §4 / ticket 0058 — the run-wrap audit assertion (atom D). Detect-don't-prevent made
// load-bearing: any commit that advanced HEAD during the run window but is ABSENT from the run's
// recorded ledger (commits.jsonl) is a raw bypass. The pure set-difference is the testable keystone;
// the run_234 shape is pinned here.
import { describe, expect, test } from 'vitest'
import { unledgeredWindowCommits } from '../src/index.js'

describe('unledgeredWindowCommits — window commits absent from the run ledger', () => {
  test('the run_234 raw-bypass shape: Deb\'s 549ab11 (fix) + bd5fdf5 (close) rode beside the spine', () => {
    // run_234 commits.jsonl recorded only 76652aa + f304c4c; 549ab11 and bd5fdf5 never entered the ledger.
    const window = ['549ab11', 'bd5fdf5', '76652aa', 'f304c4c']
    const ledger = ['76652aa', 'f304c4c']
    expect(unledgeredWindowCommits(window, ledger)).toEqual(['549ab11', 'bd5fdf5'])
  })

  test('a clean run — every window commit is in the ledger → no bypass', () => {
    expect(unledgeredWindowCommits(['a1', 'b2', 'c3'], ['c3', 'b2', 'a1'])).toEqual([])
  })

  test('an empty window → no bypass', () => {
    expect(unledgeredWindowCommits([], ['a1'])).toEqual([])
  })

  test('preserves window order and reports every unledgered sha', () => {
    expect(unledgeredWindowCommits(['x', 'y', 'z'], ['y'])).toEqual(['x', 'z'])
  })

  test('an empty ledger flags the entire window', () => {
    expect(unledgeredWindowCommits(['a1', 'b2'], [])).toEqual(['a1', 'b2'])
  })
})
