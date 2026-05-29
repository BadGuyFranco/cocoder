import { describe, expect, test } from 'vitest'
import type { ResolvedPersona } from '../src/index.js'
import { llmName, modelName, paneLabel } from '../src/runner/labels.js'

const persona = (over: Partial<ResolvedPersona> & { id: string }): ResolvedPersona => ({
  label: over.id,
  cli: 'claude',
  role: 'r',
  writeScope: [],
  body: '',
  model: '',
  ...over,
})

describe('paneLabel', () => {
  test('formats as "<Persona> | <LLM> | <Model>"', () => {
    expect(paneLabel(persona({ id: 'oscar', label: 'Oscar', cli: 'claude', model: 'claude-opus-4-8' }))).toBe('Oscar | Claude | Opus 4.8')
    // claude with an unpinned model shows its default display name (not "default")
    expect(paneLabel(persona({ id: 'oscar', label: 'Oscar', cli: 'claude', model: '' }))).toBe('Oscar | Claude | Opus 4.8')
    // a CLI with no default mapping (codex) shows "default" rather than a guess
    expect(paneLabel(persona({ id: 'bob', label: 'Bob', cli: 'codex', model: '' }))).toBe('Bob | Codex | default')
  })

  test('llmName maps known CLIs, passes through unknown', () => {
    expect(llmName('claude')).toBe('Claude')
    expect(llmName('codex')).toBe('Codex')
    expect(llmName('cursor-agent')).toBe('Cursor')
    expect(llmName('mystery')).toBe('mystery')
  })

  test('modelName: pinned id → pretty/raw; unpinned → CLI default display or "default"', () => {
    expect(modelName('claude', 'claude-sonnet-4-6')).toBe('Sonnet 4.6')
    expect(modelName('claude', 'gpt-x')).toBe('gpt-x')
    expect(modelName('claude', '')).toBe('Opus 4.8') // claude's default display
    expect(modelName('codex', '')).toBe('default') // no default mapping → truthful "default"
  })
})
