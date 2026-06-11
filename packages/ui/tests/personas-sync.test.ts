// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  daemonPut: vi.fn(),
}))

vi.mock('../electron/daemon-client.ts', () => ({
  daemonPut: mocks.daemonPut,
}))

import { savePersonaAssignmentsViaDaemon } from '../electron/personas-sync.ts'

describe('main-process personas assignments seam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('puts the required wrapped personas map and unwraps the daemon assignments response', async () => {
    const assignments = {
      oscar: {
        cli: 'claude',
        model: '',
        mode: 'headless' as const,
        plays: { 'wrap-up': { cli: 'cursor-agent', model: '' } },
      },
      deb: { cli: 'codex', model: '', enabled: true },
    }
    mocks.daemonPut.mockResolvedValue({ ok: true, status: 200, data: { ok: true, assignments } })

    await expect(savePersonaAssignmentsViaDaemon('co coder', assignments)).resolves.toEqual({
      ok: true,
      status: 200,
      data: assignments,
    })

    expect(mocks.daemonPut).toHaveBeenCalledWith('/workspaces/co%20coder/personas/assignments', { personas: assignments })
  })

  it('returns daemon errors without local fallback', async () => {
    mocks.daemonPut.mockResolvedValue({ ok: false, status: 400, error: 'missing "personas" object' })

    await expect(savePersonaAssignmentsViaDaemon('cocoder', {})).resolves.toEqual({ ok: false, status: 400, error: 'missing "personas" object' })
  })

  it('passes persona mode through the daemon-client payload unchanged', async () => {
    const assignments = { bob: { cli: 'codex', model: '', mode: 'headless' as const } }
    mocks.daemonPut.mockResolvedValue({ ok: true, status: 200, data: { ok: true, assignments } })

    await expect(savePersonaAssignmentsViaDaemon('cocoder', assignments)).resolves.toEqual({ ok: true, status: 200, data: assignments })

    expect(mocks.daemonPut).toHaveBeenCalledWith('/workspaces/cocoder/personas/assignments', { personas: assignments })
  })
})
