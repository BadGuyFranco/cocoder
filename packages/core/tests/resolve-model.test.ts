import { describe, expect, test } from 'vitest'
import {
  assertNoModelCollapse,
  detectModelCollapse,
  resolveAssignmentModel,
  type ModelTier,
} from '../src/index.js'

const claudeTiers: Readonly<Record<ModelTier, string>> = {
  default: 'sonnet',
  strong: 'opus',
}

const codexTiers: Readonly<Record<ModelTier, string>> = {
  default: '',
  strong: 'gpt-5-codex',
}

describe('resolveAssignmentModel', () => {
  test('concrete model pins win byte-for-byte over tier metadata', () => {
    expect(resolveAssignmentModel({
      assignment: { cli: 'claude', model: 'claude-opus-4-8', tier: 'strong' },
      tiers: { default: 'sonnet', strong: 'opus' },
    })).toEqual({ cli: 'claude', model: 'claude-opus-4-8' })
  })

  test('tier resolves through the caller-provided map, including CLI default', () => {
    expect(resolveAssignmentModel({
      assignment: { cli: 'claude', model: '', tier: 'strong' },
      tiers: claudeTiers,
    })).toEqual({ cli: 'claude', model: 'opus' })

    expect(resolveAssignmentModel({
      assignment: { cli: 'codex', model: '', tier: 'default' },
      tiers: codexTiers,
    })).toEqual({ cli: 'codex', model: '' })
  })

  test('the same tier can resolve to different concrete models across CLIs', () => {
    const claude = resolveAssignmentModel({ assignment: { cli: 'claude', model: '', tier: 'strong' }, tiers: claudeTiers })
    const codex = resolveAssignmentModel({ assignment: { cli: 'codex', model: '', tier: 'strong' }, tiers: codexTiers })

    expect(claude).toEqual({ cli: 'claude', model: 'opus' })
    expect(codex).toEqual({ cli: 'codex', model: 'gpt-5-codex' })
    expect(claude.model).not.toBe(codex.model)
  })

  test('missing tier metadata fails loud with cli and tier', () => {
    expect(() => resolveAssignmentModel({
      assignment: { cli: 'claude', model: '', tier: 'strong' },
      tiers: { default: 'sonnet' } as Readonly<Record<ModelTier, string>>,
    })).toThrow(/claude.*strong/)

    expect(() => resolveAssignmentModel({
      assignment: { cli: 'codex', model: '', tier: 'default' },
    })).toThrow(/codex.*default/)
  })

  test('without a concrete model or tier, the CLI default is preserved', () => {
    expect(resolveAssignmentModel({ assignment: { cli: 'cursor-agent', model: '' } })).toEqual({ cli: 'cursor-agent', model: '' })
  })
})

describe('model collapse detection', () => {
  test('detects identical cli and effective model, including two CLI defaults', () => {
    expect(detectModelCollapse({ cli: 'codex', model: 'gpt-5-codex' }, { cli: 'codex', model: 'gpt-5-codex' })).toBe(true)
    expect(detectModelCollapse({ cli: 'codex', model: '' }, { cli: 'codex', model: '' })).toBe(true)
  })

  test('does not collapse when cli or effective model differs', () => {
    expect(detectModelCollapse({ cli: 'claude', model: 'opus' }, { cli: 'codex', model: 'opus' })).toBe(false)
    expect(detectModelCollapse({ cli: 'claude', model: 'opus' }, { cli: 'claude', model: 'sonnet' })).toBe(false)
  })

  test('assertNoModelCollapse throws clearly on collapse and passes on divergence', () => {
    expect(() => assertNoModelCollapse(
      { cli: 'codex', model: '' },
      { cli: 'codex', model: '' },
      ['reviewer', 'builder'],
    )).toThrow(/reviewer.*builder.*codex\/CLI default/)

    expect(() => assertNoModelCollapse(
      { cli: 'claude', model: 'opus' },
      { cli: 'codex', model: 'gpt-5-codex' },
      ['reviewer', 'builder'],
    )).not.toThrow()
  })
})
