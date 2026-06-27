import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { removeLocalRunDir } from '../src/runner/run-dir.js'

describe('local run-dir folder GC', () => {
  let tempRoot: string
  let runsRoot: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'cocoder-folder-gc-'))
    runsRoot = join(tempRoot, 'runs')
    mkdirSync(runsRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test('removes a nested run dir and returns its path', () => {
    const runDir = makeRunDir('ws-a', 'run_1')

    expect(removeLocalRunDir(runsRoot, 'run_1')).toEqual({ removed: runDir })
    expect(existsSync(runDir)).toBe(false)
  })

  test('removes an empty nested workspace parent after deleting its only run', () => {
    const runDir = makeRunDir('ws-a', 'run_1')
    const workspaceDir = dirname(runDir)

    expect(removeLocalRunDir(runsRoot, 'run_1')).toEqual({ removed: runDir })
    expect(existsSync(workspaceDir)).toBe(false)
    expect(existsSync(runsRoot)).toBe(true)
  })

  test('retains a non-empty nested workspace parent and sibling run', () => {
    const runDir = makeRunDir('ws-a', 'run_1')
    const siblingDir = makeRunDir('ws-a', 'run_2')
    const workspaceDir = dirname(runDir)

    expect(removeLocalRunDir(runsRoot, 'run_1')).toEqual({ removed: runDir })
    expect(existsSync(workspaceDir)).toBe(true)
    expect(existsSync(siblingDir)).toBe(true)
  })

  test('removes a legacy flat run dir without removing runsRoot', () => {
    const runDir = makeLegacyRunDir('run_legacy')

    expect(removeLocalRunDir(runsRoot, 'run_legacy')).toEqual({ removed: runDir })
    expect(existsSync(runDir)).toBe(false)
    expect(existsSync(runsRoot)).toBe(true)
  })

  test('isolates siblings across workspaces', () => {
    const runDir = makeRunDir('ws-a', 'run_1')
    const sameWorkspaceSibling = makeRunDir('ws-a', 'run_2')
    const otherWorkspaceSibling = makeRunDir('ws-b', 'run_3')

    expect(removeLocalRunDir(runsRoot, 'run_1')).toEqual({ removed: runDir })
    expect(existsSync(sameWorkspaceSibling)).toBe(true)
    expect(existsSync(otherWorkspaceSibling)).toBe(true)
  })

  test('returns null for a missing run', () => {
    expect(removeLocalRunDir(runsRoot, 'run_absent')).toEqual({ removed: null })
    expect(existsSync(runsRoot)).toBe(true)
  })

  test('rejects an escaped legacy path and does not delete it', () => {
    const escapedDir = join(tempRoot, 'escaped')
    mkdirSync(escapedDir, { recursive: true })
    writeFileSync(join(escapedDir, 'marker.txt'), 'outside')

    expect(() => removeLocalRunDir(runsRoot, '../escaped')).toThrow(/outside runs root/)
    expect(existsSync(escapedDir)).toBe(true)
    expect(existsSync(runsRoot)).toBe(true)
  })

  test('is idempotent for the same run', () => {
    const runDir = makeRunDir('ws-a', 'run_1')

    expect(removeLocalRunDir(runsRoot, 'run_1')).toEqual({ removed: runDir })
    expect(removeLocalRunDir(runsRoot, 'run_1')).toEqual({ removed: null })
  })

  function makeRunDir(workspaceId: string, runId: string): string {
    const runDir = join(runsRoot, workspaceId, runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'marker.txt'), runId)
    return runDir
  }

  function makeLegacyRunDir(runId: string): string {
    const runDir = join(runsRoot, runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'marker.txt'), runId)
    return runDir
  }
})
