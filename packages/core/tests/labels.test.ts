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
    expect(paneLabel(persona({ id: 'bob', label: 'Bob', cli: 'codex', model: '' }))).toBe('Bob | Codex | default')
  })

  test('llmName maps known CLIs, passes through unknown', () => {
    expect(llmName('claude')).toBe('Claude')
    expect(llmName('codex')).toBe('Codex')
    expect(llmName('cursor-agent')).toBe('Cursor')
    expect(llmName('mystery')).toBe('mystery')
  })

  test('modelName: pretty name for known ids, raw for unknown, "default" when unpinned', () => {
    expect(modelName('claude-sonnet-4-6')).toBe('Sonnet 4.6')
    expect(modelName('gpt-x')).toBe('gpt-x')
    expect(modelName('')).toBe('default')
  })
})
