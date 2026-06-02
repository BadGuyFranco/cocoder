// faultFingerprint — the coarse cross-run recurrence key (ADR-0016 §recurrence). It must collapse
// run-specific noise (run ids, worktree paths, shas, counts) so "the same fault" matches across runs,
// without over-matching genuinely different failures.
import { describe, expect, test } from 'vitest'
import { faultFingerprint } from '../src/index.js'

describe('faultFingerprint', () => {
  test('two directive-timeouts from different runs share a fingerprint (run id / path / ms vary)', () => {
    const a = faultFingerprint('directive-timeout', 'no valid directive at /Volumes/x/local/runs/run_38/directive-0.json within 14400000ms')
    const b = faultFingerprint('directive-timeout', 'no valid directive at /Users/y/local/runs/run_42/directive-3.json within 9000000ms')
    expect(a).toBe(b)
  })

  test('a bare git sha and atom number are normalized away', () => {
    const a = faultFingerprint('builder-failed', 'builder dead on atom 0 (head abc1234def5)')
    const b = faultFingerprint('builder-failed', 'builder dead on atom 7 (head 99ee00ff11a)')
    expect(a).toBe(b)
  })

  test('different fault type → different fingerprint', () => {
    expect(faultFingerprint('directive-timeout', 'x')).not.toBe(faultFingerprint('verify-failed', 'x'))
  })

  test('genuinely different messages → different fingerprints (no over-match)', () => {
    const a = faultFingerprint('builder-failed', 'builder dead on atom 0')
    const b = faultFingerprint('builder-failed', 'typecheck error: cannot find module foo')
    expect(a).not.toBe(b)
  })

  test('is stable + prefixed by the fault type', () => {
    expect(faultFingerprint('verify-failed', 'session exited before a verdict')).toMatch(/^verify-failed\|/)
  })
})
