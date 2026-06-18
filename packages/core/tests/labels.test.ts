import { describe, expect, test } from 'vitest'
import type { ResolvedPersona } from '../src/index.js'
import { groupLabel, llmName, modelName, paneLabel } from '../src/runner/labels.js'

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

describe('groupLabel', () => {
  test('includes workspace, priority target, and run identity', () => {
    expect(groupLabel({ workspaceName: 'CoCoder', target: { type: 'priority', slug: 'demo' }, runId: 'run_42' })).toBe('CoCoder · priority:demo #42')
  })

  test('includes workspace, ticket target, and run identity', () => {
    expect(groupLabel({ workspaceName: 'CoCoder', target: { type: 'ticket', slug: '0003' }, runId: 'run_42' })).toBe('CoCoder · ticket:0003 #42')
  })

  test('includes workspace, ad-hoc target, and run identity', () => {
    expect(groupLabel({ workspaceName: 'CoCoder', target: { type: 'ad-hoc', slug: 'adhoc-session' }, runId: 'run_42' })).toBe('CoCoder · ad-hoc:adhoc-session #42')
  })

  test('includes workspace, playbook target, and run identity for visible playbook sessions', () => {
    expect(groupLabel({ workspaceName: 'CoCoder', target: { type: 'playbook', slug: 'drift-audit' }, runId: 'run_42' })).toBe('CoCoder · playbook:drift-audit #42')
  })
})
