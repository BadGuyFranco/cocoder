import { describe, expect, test } from 'vitest'
import { blockerMarker, detectBuilderBlocker } from '../src/runner/blocker.js'

describe('detectBuilderBlocker', () => {
  test('ignores the echoed PROCEED dispatch even though it literally says "within your write-scope"', () => {
    // The exact run_231 false-positive frame: the runner's own dispatch echoed into Bob's pane. The old
    // prose-keyword detector classified this as an authority-scope-conflict; the marker detector cannot.
    const frame = `
› PROCEED — this is atom 0. Read your task from /Volumes/NAS LOCAL/
  CoCoder/local/runs/run_231/directive-0.json and implement it now
  within your write-scope. When you are fully done (tests/typecheck
  run), print your completion marker for atom 0 on its own line.

• Working (0s • esc to interrupt)
`
    expect(detectBuilderBlocker(frame, 0)).toBeNull()
  })

  test('ignores a bare un-prefixed dispatch line mentioning scope/authority (no terminal control chars)', () => {
    // Hardening the prose heuristic was whack-a-mole: a dispatch echo with no `›` prefix and no wrapping
    // still tripped it. The marker detector is structurally immune — there is no marker line here.
    const frame = 'implement it now within your write-scope; this needs authority to override the permission'
    expect(detectBuilderBlocker(frame, 0)).toBeNull()
  })

  test('ignores the standby BLOCKER template (the `#` placeholder, not a concrete atom number)', () => {
    const frame = 'Print a BLOCKER marker on its OWN line: <<<COCODER-ATOM-#-BLOCKED: <one-line reason>>>'
    expect(detectBuilderBlocker(frame, 0)).toBeNull()
  })

  test("captures Bob's authority blocker only from his standalone marker line", () => {
    const reason = 'The atom requires `cocoder/decisions/0040.md`, but its declared write scope is `packages/**`. I need an explicit one-file override.'
    const frame = `Looking at this now.\n<<<COCODER-ATOM-0-BLOCKED: ${reason}>>>\n`
    expect(detectBuilderBlocker(frame, 0)).toEqual({
      reply: reason,
      category: 'authority-scope-conflict',
      owner: 'runner-fault',
    })
  })

  test('captures a concrete blocker marker rendered with a UI bullet and soft-wrapped reason', () => {
    const frame = `
• <<<COCODER-ATOM-1-BLOCKED: pnpm typecheck fails in out-of-scope daemon test
  fixtures oz-awareness.test.ts and oz-chat.test.ts>>>
`
    expect(detectBuilderBlocker(frame, 1)).toEqual({
      reply: 'pnpm typecheck fails in out-of-scope daemon test fixtures oz-awareness.test.ts and oz-chat.test.ts',
      category: 'authority-scope-conflict',
      owner: 'runner-fault',
    })
  })

  test('ignores a concrete blocker marker mentioned mid-prose instead of at rendered line start', () => {
    const frame = 'I should print <<<COCODER-ATOM-1-BLOCKED: cannot proceed>>> only if I am truly blocked.'
    expect(detectBuilderBlocker(frame, 1)).toBeNull()
  })

  test('a non-authority reason is a generic reported-blocker', () => {
    const frame = `${blockerMarker(2)}`.replace('>>>', ': the upstream service is down, nothing to build against>>>')
    expect(detectBuilderBlocker(frame, 2)).toEqual({
      reply: 'the upstream service is down, nothing to build against',
      category: 'reported-blocker',
      owner: 'runner-fault',
    })
  })

  test('a blocker marker for a DIFFERENT atom does not match (per-atom uniqueness)', () => {
    const frame = '<<<COCODER-ATOM-1-BLOCKED: cannot proceed>>>'
    expect(detectBuilderBlocker(frame, 0)).toBeNull()
    expect(detectBuilderBlocker(frame, 1)).toMatchObject({ reply: 'cannot proceed' })
  })

  test('a reason-less marker still registers a blocker', () => {
    expect(detectBuilderBlocker(blockerMarker(3), 3)).toEqual({
      reply: 'builder reported a blocker (no reason given)',
      category: 'reported-blocker',
      owner: 'runner-fault',
    })
  })
})
