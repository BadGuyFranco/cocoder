import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { rotateLogFile } from '../src/runner/log-rotation.js'

describe('retention log rotation', () => {
  let tempRoot: string
  let logPath: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'cocoder-log-rotation-'))
    logPath = join(tempRoot, 'test.log')
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test('leaves a below-threshold file untouched', () => {
    writeFileSync(logPath, 'small')

    expect(rotateLogFile(logPath, { maxBytes: 6, keep: 2 })).toEqual({ rotated: false, sizeBytes: 5 })
    expect(readFileSync(logPath, 'utf8')).toBe('small')
  })

  test('rotates an at-threshold file to generation 1 and removes the active path', () => {
    writeFileSync(logPath, '12345')

    expect(rotateLogFile(logPath, { maxBytes: 5, keep: 2 })).toEqual({ rotated: true, sizeBytes: 5 })
    expect(existsSync(logPath)).toBe(false)
    expect(readFileSync(`${logPath}.1`, 'utf8')).toBe('12345')
  })

  test('shifts repeated rotations and caps retained generations', () => {
    writeFileSync(logPath, 'first')
    rotateLogFile(logPath, { maxBytes: 1, keep: 2 })
    writeFileSync(logPath, 'second')
    rotateLogFile(logPath, { maxBytes: 1, keep: 2 })
    writeFileSync(logPath, 'third')

    expect(rotateLogFile(logPath, { maxBytes: 1, keep: 2 })).toEqual({ rotated: true, sizeBytes: 5 })
    expect(readFileSync(`${logPath}.1`, 'utf8')).toBe('third')
    expect(readFileSync(`${logPath}.2`, 'utf8')).toBe('second')
    expect(existsSync(`${logPath}.3`)).toBe(false)
  })

  test('returns a no-op for a missing file', () => {
    expect(rotateLogFile(logPath, { maxBytes: 1, keep: 2 })).toEqual({ rotated: false, sizeBytes: 0 })
  })

  test('tolerates gaps in generations', () => {
    writeFileSync(logPath, 'active')
    writeFileSync(`${logPath}.1`, 'previous')

    expect(rotateLogFile(logPath, { maxBytes: 1, keep: 3 })).toEqual({ rotated: true, sizeBytes: 6 })
    expect(readFileSync(`${logPath}.1`, 'utf8')).toBe('active')
    expect(readFileSync(`${logPath}.2`, 'utf8')).toBe('previous')
    expect(existsSync(`${logPath}.3`)).toBe(false)
  })
})
