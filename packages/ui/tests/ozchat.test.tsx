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

function renderChat(messagesToRender: ChatMessage[], opts: { onSelectRun?: (id: string) => void; onDecision?: (choice: string) => void; onSend?: (text: string) => void } = {}) {
  render(
    <OzChatPanel
      messages={messagesToRender}
      runs={[run]}
      workspaceName="CoCoder"
      onSend={opts.onSend ?? vi.fn()}
      onSelectRun={opts.onSelectRun ?? vi.fn()}
      onDecision={opts.onDecision ?? vi.fn()}
      ozTyping={false}
    />,
  )
}

function ozItemDataTransfer(item: { itemType: 'priority' | 'ticket' | 'run'; id: string; label: string }): DataTransfer {
  return {
    types: ['application/x-oz-item'],
    getData: (type: string) => type === 'application/x-oz-item' ? JSON.stringify(item) : '',
    setData: vi.fn(),
    dropEffect: 'copy',
  } as unknown as DataTransfer
}

describe('OzChatPanel run cards', () => {
  afterEach(() => cleanup())

  it('shows the run status chip and keeps click-to-select behavior', () => {
    const onSelectRun = vi.fn()
    renderChat(messages, { onSelectRun })

    expect(screen.getByText('Running')).toBeDefined()
    expect(screen.getByText(run.id)).toBeDefined()

    fireEvent.click(screen.getByText(run.title))

    expect(onSelectRun).toHaveBeenCalledWith(run.id)
  })

  it('keeps decision callout behavior', () => {
    const onDecision = vi.fn()
    renderChat([{ id: 'm-decision', role: 'oz', time: 'now', body: 'Pick a path.', flag: 'decision' }], { onDecision })

    fireEvent.click(screen.getByText('Replay full plan'))

    expect(onDecision).toHaveBeenCalledWith('full')
  })
})

describe('OzChatPanel markdown rendering', () => {
  afterEach(() => cleanup())

  it('renders headings, lists, code, links, bold, and italic for Oz messages', () => {
    renderChat([{
      id: 'm-markdown',
      role: 'oz',
      time: 'now',
      body: [
        '## Current status',
        '',
        '- first item',
        '- second item with `inline code`',
        '',
        '1. ordered item',
        '2. next ordered item',
        '',
        '```ts',
        'const answer = 42',
        'console.log(answer)',
        '```',
        '',
        'See [docs](https://example.com/docs) with **bold text** and *italic text*.',
      ].join('\n'),
    }])

    expect(screen.getByRole('heading', { name: 'Current status', level: 2 })).toBeDefined()
    expect(screen.getByText('first item').tagName).toBe('LI')
    expect(screen.getByText(/second item/).tagName).toBe('LI')
    expect(screen.getByText('inline code').tagName).toBe('CODE')
    expect(screen.getByText(/const answer = 42/).tagName).toBe('CODE')
    expect(screen.getByText(/const answer = 42/).parentElement?.tagName).toBe('PRE')
    expect(screen.getByText(/const answer = 42/).textContent).toContain('console.log(answer)')
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link.getAttribute('href')).toBe('https://example.com/docs')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText('bold text').tagName).toBe('STRONG')
    expect(screen.getByText('italic text').tagName).toBe('EM')
  })

  it('escapes raw HTML instead of injecting live DOM', () => {
    renderChat([{
      id: 'm-xss',
      role: 'oz',
      time: 'now',
      body: '<img src=x onerror="window.__xss = true"> <script>window.__xss = true</script>',
    }])

    expect(screen.getByText(/<img src=x/)).toBeDefined()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('script')).toBeNull()
  })

  it('keeps non-Oz messages plain and escaped', () => {
    renderChat([{ id: 'm-user', role: 'user', time: 'now', body: '## Not a heading\n<script>alert(1)</script>' }])

    expect(screen.queryByRole('heading', { name: 'Not a heading' })).toBeNull()
    expect(screen.getByText(/## Not a heading/)).toBeDefined()
    expect(document.querySelector('script')).toBeNull()
  })
})

describe('OzChatPanel drag-to-ask pointers', () => {
  afterEach(() => cleanup())

  it('renders a chip after dropping an Oz item pointer', () => {
    renderChat([])

    fireEvent.drop(screen.getByLabelText('Oz message composer'), {
      dataTransfer: ozItemDataTransfer({ itemType: 'priority', id: 'p-123', label: 'Launch hardening' }),
    })

    expect(screen.getByText('priority')).toBeDefined()
    expect(screen.getByText('Launch hardening')).toBeDefined()
    expect(screen.getByText('p-123')).toBeDefined()
  })

  it('removes an attached pointer from the chip', () => {
    renderChat([])

    fireEvent.drop(screen.getByLabelText('Oz message composer'), {
      dataTransfer: ozItemDataTransfer({ itemType: 'ticket', id: 't-7', label: 'Fix stale status' }),
    })
    fireEvent.click(screen.getByLabelText('Remove attached context'))

    expect(screen.queryByText('Fix stale status')).toBeNull()
  })

  it('sends an attached pointer without typed text', () => {
    const onSend = vi.fn()
    renderChat([], { onSend })

    fireEvent.drop(screen.getByLabelText('Oz message composer'), {
      dataTransfer: ozItemDataTransfer({ itemType: 'run', id: 'run-42', label: 'run #42' }),
    })
    fireEvent.click(screen.getByText('Send'))

    expect(onSend).toHaveBeenCalledWith('[context: run run-42 — run #42]')
    expect(screen.queryByText('run #42')).toBeNull()
  })

  it('sends both the attached pointer and typed text', () => {
    const onSend = vi.fn()
    renderChat([], { onSend })

    fireEvent.drop(screen.getByLabelText('Oz message composer'), {
      dataTransfer: ozItemDataTransfer({ itemType: 'priority', id: 'p-9', label: 'Improve Oz' }),
    })
    fireEvent.change(screen.getByLabelText('Message Oz'), { target: { value: 'What is next?' } })
    fireEvent.click(screen.getByText('Send'))

    expect(onSend).toHaveBeenCalledWith('[context: priority p-9 — Improve Oz]\nWhat is next?')
  })
})
