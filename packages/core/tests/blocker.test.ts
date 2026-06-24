import { describe, expect, test } from 'vitest'
import { detectBuilderBlocker } from '../src/runner/blocker.js'

describe('detectBuilderBlocker', () => {
  test('ignores wrapped user prompt text in a live terminal frame', () => {
    const frame = `
› PROCEED — this is atom 0. Read your task from /Volumes/NAS LOCAL/
  CoCoder/local/runs/run_231/directive-0.json and implement it now
  within your write-scope. When you are fully done (tests/typecheck
  run), print your completion marker for atom 0 on its own line.

• Working (0s • esc to interrupt)
`

    expect(detectBuilderBlocker(frame)).toBeNull()
  })

  test('captures an actual Bob authority blocker', () => {
    const reply = 'The atom requires `cocoder/decisions/0040.md`, but its declared write scope is `packages/**`. I need an explicit one-file override.'

    expect(detectBuilderBlocker(reply)).toMatchObject({
      reply,
      category: 'authority-scope-conflict',
      owner: 'runner-fault',
    })
  })
})
