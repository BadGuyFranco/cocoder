import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { LaunchProgressModal, type LaunchProgressState } from '../src/renderer/sections/LaunchProgressModal.tsx'

const noop = (): void => {}

describe('LaunchProgressModal', () => {
  afterEach(() => cleanup())

  it('renders runnerless handoff success as a non-error notice with a copyable command', async () => {
    const state: LaunchProgressState = {
      open: true,
      title: 'Runnerless handoff',
      runId: null,
      detail: null,
      error: null,
      handoff: {
        handoffPath: 'local/runnerless-handoffs/cocoder/runnerless.md',
        command: "cd '/repo' && cocoder run-independent runnerless",
      },
    }

    render(<LaunchProgressModal state={state} onClose={noop} />)

    const notice = await screen.findByText('Runnerless handoff created — run it in a fresh terminal:')
    const overlay = notice.closest('body > div') as HTMLElement | null
    expect(overlay).not.toBeNull()
    expect(within(overlay!).getByRole('status')).toBeDefined()
    expect(within(overlay!).queryByRole('alert')).toBeNull()
    expect(within(overlay!).queryByText('Launch needs attention.')).toBeNull()
    expect(within(overlay!).getByText("cd '/repo' && cocoder run-independent runnerless")).toBeDefined()
    expect(within(overlay!).getByText('local/runnerless-handoffs/cocoder/runnerless.md')).toBeDefined()
    expect(overlay!.querySelector('.ph-check-circle')).not.toBeNull()
    expect(overlay!.querySelector('.ph-warning-circle')).toBeNull()
  })
})
