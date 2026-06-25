// ADR-0041 §3.1 — the interference rail (atom A). Founder decision 2026-06-25: the CONSERVATIVE
// gray-zone resolution — a live Deb change interferes iff it touches ANY non-.md surface. The
// runner-tree and target-overlap distinctions of the widened variant collapse: every code touch
// interferes regardless of where it lands, so the predicate is a pure file-domain test over the
// change set, independent of the active run and of Deb's "is this minor?" judgment.
import { describe, expect, test } from 'vitest'
import { interferes, isInstructionSurface } from '../src/index.js'

describe('isInstructionSurface — the single .md classifier the rail is built on', () => {
  test('an .md file is an instruction surface', () => {
    expect(isInstructionSurface('cocoder/decisions/0041-orchestration.md')).toBe(true)
    expect(isInstructionSurface('packages/personas/base/deb.md')).toBe(true)
    expect(isInstructionSurface('cocoder/PLAYBOOK.md')).toBe(true)
  })
  test('case-insensitive on the extension', () => {
    expect(isInstructionSurface('README.MD')).toBe(true)
  })
  test('any non-.md path is NOT an instruction surface (code)', () => {
    expect(isInstructionSurface('packages/core/src/runner/runner.ts')).toBe(false)
    expect(isInstructionSurface('cocoder/tickets/order.json')).toBe(false)
    expect(isInstructionSurface('packages/ui/src/App.tsx')).toBe(false)
  })
  test('default-when-unsure → code: a blank or extensionless path is not an instruction surface', () => {
    expect(isInstructionSurface('')).toBe(false)
    expect(isInstructionSurface('   ')).toBe(false)
    expect(isInstructionSurface('Makefile')).toBe(false)
  })
})

describe('interferes — true iff the change set touches any non-.md surface (conservative rail)', () => {
  test('only .md/instruction edits → does NOT interfere (Deb may self-fix live)', () => {
    expect(interferes(['cocoder/decisions/0041-orchestration.md'])).toBe(false)
    expect(interferes(['packages/personas/base/deb.md', 'cocoder/failure-catalog.md', 'docs/guide.md'])).toBe(false)
  })

  test('a runner-tree file → interferes', () => {
    expect(interferes(['packages/core/src/runner/runner.ts'])).toBe(true)
  })

  test('the run_234 keystone: Deb\'s 0054 fix touched the runner → interferes (never hers to land live)', () => {
    expect(interferes(['packages/core/src/runner/runner.ts', 'packages/core/src/runner/status.ts'])).toBe(true)
  })

  test('an isolated guard in an unrelated, non-runner, non-target code file → interferes (the conservative gray-zone resolution)', () => {
    expect(interferes(['packages/core/src/util/clock.ts'])).toBe(true)
  })

  test('a non-.md governance file (order.json) → interferes', () => {
    expect(interferes(['cocoder/tickets/order.json'])).toBe(true)
  })

  test('a mix of .md and a single code file → interferes (one code touch is enough)', () => {
    expect(interferes(['cocoder/decisions/0041-orchestration.md', 'packages/core/src/runner/status.ts'])).toBe(true)
  })

  test('an empty change set → does NOT interfere (nothing to interfere)', () => {
    expect(interferes([])).toBe(false)
  })

  test('default-when-unsure → interfering: an unclassifiable (extensionless) path interferes', () => {
    expect(interferes(['scripts/oz'])).toBe(true)
  })
})
