// Dashboard root — built AROUND the Oz conversation; priorities + runs are panels, never pages. The
// run-detail drawer opens BETWEEN the priorities column and the chat (3-col when a run is selected).
// Includes the Run History modal. Ported from design-ref/dashboard.jsx.
import { useState, useCallback } from 'react'
import { Icon, Modal, StatusChip } from '../../ui/primitives.tsx'

const PRIO_MIN = 300
const PRIO_MAX = 640
const PRIO_DEFAULT = 380

// Thin draggable divider that resizes the Priorities column. Width is owned by the Dashboard and
// clamped; dragging attaches window listeners so the cursor can leave the 6px handle without dropping.
function ResizeHandle({ onResize }: { onResize: (deltaX: number) => void }) {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const move = (ev: MouseEvent) => onResize(ev.clientX - startX)
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.cursor = '' }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
  }, [onResize])
  return <div className="oz-resize-handle" onMouseDown={onMouseDown} title="Drag to resize" />
}
import { PrioritiesPanel } from './Priorities.tsx'
import { OzChatPanel } from './OzChat.tsx'
import { RunDetail } from './RunDetail.tsx'
import { FirstRun } from './FirstRun.tsx'
import type { ChatMessage, Priority, Run, Workspace } from '../../model.ts'

function RunHistoryModal({ open, onClose, runs, onSelectRun, priorities }: { open: boolean; onClose: () => void; runs: Run[]; onSelectRun: (id: string) => void; priorities: Priority[] }) {
  const [filter, setFilter] = useState('all')
  if (!open) return null
  const filtered = runs.filter((r) => {
    if (filter === 'all') return true
    if (filter === 'active') return r.status === 'running' || r.status === 'blocked'
    if (filter === 'complete') return r.status === 'complete'
    if (filter === 'failed') return r.status === 'failed' || r.status === 'stopped'
    return true
  })
  const counts: Record<string, number> = {
    all: runs.length,
    active: runs.filter((r) => r.status === 'running' || r.status === 'blocked').length,
    complete: runs.filter((r) => r.status === 'complete').length,
    failed: runs.filter((r) => r.status === 'failed' || r.status === 'stopped').length,
  }
  return (
    <Modal open={open} onClose={onClose} title="Run history" subtitle="Every run in this workspace, ordered by recency. Click a run to open its detail." icon="clock-counter-clockwise" width={820}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, padding: 2, background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', width: 'fit-content' }}>
        {[{ id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'complete', label: 'Complete' }, { id: 'failed', label: 'Failed / stopped' }].map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{ padding: '5px 12px', fontSize: 11.5, background: filter === f.id ? 'var(--cb-accent-muted)' : 'transparent', color: filter === f.id ? 'var(--cb-accent)' : 'var(--cb-text-muted)', border: 'none', borderRadius: 3, cursor: 'pointer', fontFamily: 'var(--cb-font-body)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {f.label}<span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, opacity: 0.7 }}>{counts[f.id]}</span>
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="oz-empty" style={{ padding: '32px 0' }}><div className="oz-empty-icon" style={{ width: 44, height: 44 }}><Icon name="clock-counter-clockwise" size={22} /></div><div className="oz-empty-title">No runs match</div></div>
      ) : (
        <div style={{ borderTop: '1px solid var(--cb-border)' }}>
          {filtered.map((run) => {
            const parentPriority = run.priorityId ? priorities.find((p) => p.id === run.priorityId) : null
            return (
              <div key={run.id} onClick={() => { onSelectRun(run.id); onClose() }} style={{ padding: '12px 4px', borderBottom: '1px solid var(--cb-border)', cursor: 'pointer', display: 'grid', gridTemplateColumns: '110px 1fr 120px 100px 20px', gap: 16, alignItems: 'center' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-hover)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <StatusChip status={run.status} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500, lineHeight: 1.4 }}>{run.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', marginTop: 3 }}>{parentPriority ? <>priority · <span style={{ color: 'var(--cb-text-secondary)' }}>{parentPriority.name}</span></> : <span style={{ color: 'var(--cb-accent)' }}>ad-hoc</span>}</div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{run.personas.slice(0, 3).map((p) => <span key={p} style={{ fontSize: 9.5, fontFamily: 'var(--cb-font-mono)', color: 'var(--cb-text-secondary)', padding: '1px 5px', background: 'var(--cb-bg-soft)', borderRadius: 2, border: '1px solid var(--cb-border)' }}>{p}</span>)}</div>
                <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)', textAlign: 'right' }}>{run.startedAt}</div>
                <Icon name="arrow-right" size={12} style={{ color: 'var(--cb-text-muted)' }} />
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

export function Dashboard({ workspace, priorities, runs, ozMessages, selectedRunId, setSelectedRunId, onReorder, onLaunch, onAdhoc, onAddPriority, onSend, onDecision, onRunAction, ozTyping, runHistoryOpen, setRunHistoryOpen }: {
  workspace: Workspace; priorities: Priority[]; runs: Run[]; ozMessages: ChatMessage[]
  selectedRunId: string | null; setSelectedRunId: (id: string | null) => void
  onReorder: (from: number, to: number) => void; onLaunch: (p: Priority) => void; onAdhoc: () => void; onAddPriority: () => void
  onSend: (text: string) => void; onDecision: (choice: string) => void; onRunAction: (action: string, id: string) => void
  ozTyping: boolean; runHistoryOpen: boolean; setRunHistoryOpen: (b: boolean) => void
}) {
  const [prioWidth, setPrioWidth] = useState(PRIO_DEFAULT)
  const selectedRun = selectedRunId ? runs.find((r) => r.id === selectedRunId) : null
  // Fresh workspace (nothing queued, nothing run yet) → the first-run setup ladder, not a blank grid.
  if (priorities.length === 0 && runs.length === 0) {
    return <FirstRun wsName={workspace.name} onBegin={() => onSend('Walk me through setting up this workspace.')} />
  }
  // The Priorities column is user-resizable via the drag handle; clamp to keep both sides usable.
  const onResizeTo = (px: number) => setPrioWidth(Math.max(PRIO_MIN, Math.min(PRIO_MAX, px)))
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: selectedRun ? `${prioWidth}px 6px 460px 1fr` : `${prioWidth}px 6px 1fr`, gap: 16, padding: 16, height: '100%', overflow: 'hidden' }}>
        <PrioritiesPanel priorities={priorities} runs={runs} onReorder={onReorder} onLaunch={onLaunch} onAdhoc={onAdhoc} onAddPriority={onAddPriority} onSelectRun={setSelectedRunId} onOpenRunHistory={() => setRunHistoryOpen(true)} selectedRunId={selectedRunId} />
        <ResizeHandle width={prioWidth} onResizeTo={onResizeTo} />
        {selectedRun && <RunDetail run={selectedRun} parentPriority={selectedRun.priorityId ? priorities.find((p) => p.id === selectedRun.priorityId) || null : null} parentPriorityIndex={selectedRun.priorityId ? priorities.findIndex((p) => p.id === selectedRun.priorityId) : -1} onClose={() => setSelectedRunId(null)} onAction={onRunAction} />}
        <OzChatPanel messages={ozMessages} runs={runs} workspaceName={workspace.name} onSend={onSend} onSelectRun={setSelectedRunId} onDecision={onDecision} ozTyping={ozTyping} />
      </div>
      <RunHistoryModal open={runHistoryOpen} onClose={() => setRunHistoryOpen(false)} runs={runs} priorities={priorities} onSelectRun={setSelectedRunId} />
    </>
  )
}
