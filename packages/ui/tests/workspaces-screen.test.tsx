import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspacesScreen } from '../app/sections/Workspaces.tsx'
import type { Workspace } from '../app/model.ts'

type PickRoot = () => Promise<{ readonly path: string | null; readonly error?: string }>

const workspace: Workspace = {
  id: 'cocoder',
  name: 'CoCoder',
  description: 'Dogfood workspace',
  icon: 'ph-thin ph-cube',
  created: 'today',
  roots: [{ id: 'r1', name: 'CoCoder', path: '/repo/root', role: 'primary' }],
}

function Harness({ onPickRoot }: { onPickRoot?: PickRoot }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([workspace])
  return (
    <WorkspacesScreen
      workspaces={workspaces}
      activeId="cocoder"
      onChange={(next) => setWorkspaces((all) => all.map((entry) => (entry.id === next.id ? next : entry)))}
      onSetActive={() => undefined}
      onCreate={() => undefined}
      onDelete={() => undefined}
      onSave={() => undefined}
      onGotoDashboard={() => undefined}
      onPickRoot={onPickRoot}
    />
  )
}

describe('WorkspacesScreen root picker', () => {
  beforeEach(() => cleanup())

  it('fills the edited root path from the shared picker handler', async () => {
    const onPickRoot = vi.fn<PickRoot>(async () => ({ path: '/picked/detail-root' }))

    render(<Harness onPickRoot={onPickRoot} />)
    fireEvent.click(screen.getByTitle('Pick folder'))

    await waitFor(() => expect(screen.getByDisplayValue('/picked/detail-root')).toBeDefined())
    expect(onPickRoot).toHaveBeenCalledTimes(1)
  })

  it('shows picker validation errors inline without changing the path', async () => {
    const error = 'primary root must not be inside the CoCoder install root'
    const onPickRoot = vi.fn<PickRoot>(async () => ({ path: null, error }))

    render(<Harness onPickRoot={onPickRoot} />)
    fireEvent.click(screen.getByTitle('Pick folder'))

    await waitFor(() => expect(screen.getByText(error)).toBeDefined())
    expect(screen.getByDisplayValue('/repo/root')).toBeDefined()
  })

  it('keeps the folder button inert when no picker is available', () => {
    render(<Harness />)

    const button = screen.getByTitle('Pick folder') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(screen.getByDisplayValue('/repo/root')).toBeDefined()
  })
})
