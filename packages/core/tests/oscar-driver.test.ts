import { describe, expect, test } from 'vitest'
import { createPaneOscarDriver } from '../src/runner/oscar-driver.js'
import type { SessionHost, SessionRef, SessionStatus } from '../src/session-host/index.js'

function host(statuses: SessionStatus[]): { host: SessionHost; calls: Array<{ method: string; ref: SessionRef; text?: string }> } {
  const calls: Array<{ method: string; ref: SessionRef; text?: string }> = []
  const h: SessionHost = {
    async spawn() {
      throw new Error('not used')
    },
    async readScreen(ref) {
      calls.push({ method: 'readScreen', ref })
      return 'screen'
    },
    async status(ref) {
      calls.push({ method: 'status', ref })
      return statuses.shift() ?? { state: 'exited', code: 0 }
    },
    async waitForExit() {
      throw new Error('not used')
    },
    async sendInput(ref, text) {
      calls.push({ method: 'sendInput', ref, text })
    },
    async show(ref) {
      calls.push({ method: 'show', ref })
    },
    async kill() {
      throw new Error('not used')
    },
    async closeSurface() {
      throw new Error('not used')
    },
  }
  return { host: h, calls }
}

describe('createPaneOscarDriver', () => {
  test('delegates pane operations to SessionHost with the Oscar ref', async () => {
    const ref: SessionRef = { id: 'surface:oscar', driver: 'fake' }
    const h = host([{ state: 'running' }, { state: 'exited', code: 0 }])
    const driver = createPaneOscarDriver(h.host, ref)

    await driver.send('next')
    await driver.show()
    expect(await driver.readScreen()).toBe('screen')
    expect(await driver.alive()).toBe(true)
    expect(await driver.alive()).toBe(false)

    expect(h.calls).toEqual([
      { method: 'sendInput', ref, text: 'next' },
      { method: 'show', ref },
      { method: 'readScreen', ref },
      { method: 'status', ref },
      { method: 'status', ref },
    ])
  })
})
