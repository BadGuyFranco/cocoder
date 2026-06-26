import { describe, expect, test } from 'vitest'
import { coCoderRunReference, runDisplayName } from '../src/index.js'

describe('portable run display labels', () => {
  test('uses the workspace-local run number for founder-facing display', () => {
    expect(runDisplayName({ id: 'run_188', displayNumber: 1 })).toBe('workspace run 1')
  })

  test('labels the global run id as technical when a display number exists', () => {
    expect(coCoderRunReference({ id: 'run_188', displayNumber: 1 })).toBe('workspace run 1 (technical id: run_188)')
  })

  test('falls back to the global run id when no display number exists', () => {
    expect(runDisplayName({ id: 'run_188', displayNumber: null })).toBe('run_188')
    expect(coCoderRunReference({ id: 'run_188', displayNumber: null })).toBe('run_188')
  })

  test('uses the real workspace name when one is available', () => {
    expect(runDisplayName({ id: 'run_188', displayNumber: 98, workspaceName: 'CoCoder' })).toBe('CoCoder run 98')
    expect(coCoderRunReference({ id: 'run_188', displayNumber: 98, workspaceName: 'CoCoder' })).toBe('CoCoder run 98 (technical id: run_188)')
  })

  test('keeps the workspace fallback when the workspace name is empty', () => {
    expect(runDisplayName({ id: 'run_188', displayNumber: 98, workspaceName: '' })).toBe('workspace run 98')
    expect(coCoderRunReference({ id: 'run_188', displayNumber: 98, workspaceName: '' })).toBe('workspace run 98 (technical id: run_188)')
    expect(runDisplayName({ id: 'run_188', displayNumber: 98, workspaceName: '   ' })).toBe('workspace run 98')
    expect(coCoderRunReference({ id: 'run_188', displayNumber: 98, workspaceName: '   ' })).toBe('workspace run 98 (technical id: run_188)')
  })

  test('ignores the workspace name when no display number exists', () => {
    expect(runDisplayName({ id: 'run_188', displayNumber: null, workspaceName: 'CoCoder' })).toBe('run_188')
    expect(coCoderRunReference({ id: 'run_188', displayNumber: null, workspaceName: 'CoCoder' })).toBe('run_188')
  })
})
