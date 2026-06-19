import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OzChatPanel } from '../src/renderer/sections/dashboard/OzChat.tsx'
import type { ChatMessage, Run } from '../src/renderer/model.ts'

const run: Run = {
  id: 'run-chat',
  title: 'Chat attached run',
  status: 'running',
  priorityId: 'p-chat',
  personas: ['oscar', 'bob'],
  cli: 'codex',
  startedAt: '2026-06-12 09:00',
  lastEvent: 'Working.',
}

const messages: ChatMessage[] = [
  {
    id: 'm-run-card',
    role: 'oz',
    time: 'now',
    body: 'Attached run.',
    attachments: [{ kind: 'run-card', runId: run.id }],
  },
]

describe('OzChatPanel run cards', () => {
  afterEach(() => cleanup())

  it('shows the run status chip and keeps click-to-select behavior', () => {
    const onSelectRun = vi.fn()
    render(
      <OzChatPanel
        messages={messages}
        runs={[run]}
        workspaceName="CoCoder"
        onSend={vi.fn()}
        onSelectRun={onSelectRun}
        onDecision={vi.fn()}
        ozTyping={false}
      />,
    )

    expect(screen.getByText('Running')).toBeDefined()
    expect(screen.getByText(run.id)).toBeDefined()

    fireEvent.click(screen.getByText(run.title))

    expect(onSelectRun).toHaveBeenCalledWith(run.id)
  })
})
