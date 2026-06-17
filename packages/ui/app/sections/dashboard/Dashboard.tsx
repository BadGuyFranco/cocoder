// Dashboard root — built AROUND the Oz conversation; priorities + runs are panels, never pages. The
// run-detail drawer opens BETWEEN the priorities column and the chat (3-col when a run is selected).
// Ported from design-ref/dashboard.jsx, with the left panel now cycling Priorities/Tickets/Runs in place.
import { useState, useCallback } from 'react'
import { Icon, StatusChip } from '../../ui/primitives.tsx'

const PRIO_MIN = 300
const PRIO_MAX = 640
const PRIO_DEFAULT = 380

// Thin draggable divider that resizes the Priorities column. Width is owned by the Dashboard and
// clamped; dragging attaches window listeners so the cursor can leave the 6px handle without dropping.
function ResizeHandle({ width, onResizeTo }: { width: number; onResizeTo: (px: number) => void }) {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const move = (ev: MouseEvent) => onResizeTo(startWidth + (ev.clientX - startX))
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.cursor = '' }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
  }, [width, onResizeTo])
  return <div className="oz-resize-handle" onMouseDown={onMouseDown} title="Drag to resize" />
}
import { PrioritiesPanel } from './Priorities.tsx'
import { OzChatPanel } from './OzChat.tsx'
import { RunDetail } from './RunDetail.tsx'
import { FirstRun } from './FirstRun.tsx'
import type { ChatMessage, Priority, Run, Ticket, Workspace } from '../../model.ts'

type DashboardTab = 'priorities' | 'tickets' | 'runs'
type RunFilter = 'all' | 'active' | 'complete' | 'failed'

function TabStrip({ active, onChange, priorities, tickets, runs }: { active: DashboardTab; onChange: (tab: DashboardTab) => void; priorities: number; tickets: number; runs: number }) {
  const tabs: Array<{ id: DashboardTab; label: string; count: number }> = [
    { id: 'priorities', label: 'Priorities', count: priorities },
    { id: 'tickets', label: 'Tickets', count: tickets },
    { id: 'runs', label: 'Runs', count: runs },
  ]
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', minWidth: 0 }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={active === tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 8px',
            border: 'none',
            borderRadius: 3,
            background: active === tab.id ? 'var(--cb-accent-muted)' : 'transparent',
            color: active === tab.id ? 'var(--cb-accent)' : 'var(--cb-text-muted)',
            cursor: 'pointer',
            fontFamily: 'var(--cb-font-body)',
            fontSize: 11.5,
          }}
        >
          <span>{tab.label}</span>
          <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, opacity: 0.75 }}>{tab.count}</span>
        </button>
      ))}
    </div>
  )
}

function TicketsTab({ tickets }: { tickets: Ticket[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const openTickets = tickets.filter((ticket) => ticket.state === 'open')
  const selected = selectedId ? openTickets.find((ticket) => ticket.id === selectedId) ?? null : null
  if (selected) {
    const meta = [
      ['type', selected.type],
      ['status', selected.status],
      ['priority', selected.priority],
      ['owner', selected.owner],
      ['created', selected.created],
    ].filter(([, value]) => value)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button type="button" onClick={() => setSelectedId(null)} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'transparent', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', color: 'var(--cb-text-muted)', fontSize: 11, fontFamily: 'var(--cb-font-body)', cursor: 'pointer' }}>
          <Icon name="arrow-left" size={12} />Back to tickets
        </button>
        <div style={{ padding: '12px 12px 14px', background: 'var(--cb-surface-glass)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 11, color: 'var(--cb-accent)', paddingTop: 2 }}>{selected.id}</span>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, lineHeight: 1.45, color: 'var(--cb-text)' }}>{selected.title}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {meta.map(([label, value]) => (
              <span key={label} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', padding: '2px 6px', border: '1px solid var(--cb-border)', borderRadius: 3, background: 'var(--cb-bg-soft)', fontSize: 10.5, color: 'var(--cb-text-secondary)' }}>
                <span style={{ fontFamily: 'var(--cb-font-mono)', color: 'var(--cb-text-muted)' }}>{label}</span>{value}
              </span>
            ))}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.65, color: 'var(--cb-text-secondary)', borderTop: '1px solid var(--cb-border)', paddingTop: 12 }}>{selected.body}</div>
        </div>
      </div>
    )
  }
  if (openTickets.length === 0) {
    return (
      <div className="oz-empty" style={{ padding: '32px 16px' }}>
        <div className="oz-empty-icon" style={{ width: 44, height: 44 }}><Icon name="ticket" size={22} /></div>
        <div className="oz-empty-title">No open tickets</div>
        <div className="oz-empty-body">Open tickets will appear here when they are filed.</div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {openTickets.map((ticket) => (
        <button
          key={ticket.id}
          type="button"
          onClick={() => setSelectedId(ticket.id)}
          style={{ width: '100%', textAlign: 'left', padding: '10px 10px', background: 'var(--cb-surface-glass)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', cursor: 'pointer', fontFamily: 'var(--cb-font-body)', color: 'var(--cb-text)' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--cb-accent-30)'; e.currentTarget.style.background = 'var(--cb-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--cb-border)'; e.currentTarget.style.background = 'var(--cb-surface-glass)' }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-accent)', paddingTop: 2 }}>{ticket.id}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.45 }}>{ticket.title}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 7, alignItems: 'center' }}>
                {ticket.type && <span style={{ fontSize: 10, color: 'var(--cb-text-secondary)', padding: '1px 6px', background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 2 }}>{ticket.type}</span>}
                {ticket.status && <StatusChip status={ticket.status.toLowerCase()} label={ticket.status} />}
              </div>
            </div>
            <Icon name="arrow-right" size={12} style={{ color: 'var(--cb-text-muted)', marginTop: 3 }} />
          </div>
        </button>
      ))}
    </div>
  )
}

function RunsTab({ runs, onSelectRun, priorities }: { runs: Run[]; onSelectRun: (id: string) => void; priorities: Priority[] }) {
  const [filter, setFilter] = useState<RunFilter>('all')
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
    <>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, padding: 2, background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', width: 'fit-content', maxWidth: '100%', flexWrap: 'wrap' }}>
        {([{ id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'complete', label: 'Complete' }, { id: 'failed', label: 'Failed / stopped' }] as Array<{ id: RunFilter; label: string }>).map((f) => (
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
              <div key={run.id} onClick={() => onSelectRun(run.id)} style={{ padding: '12px 4px', borderBottom: '1px solid var(--cb-border)', cursor: 'pointer', display: 'grid', gridTemplateColumns: '92px minmax(0,1fr) 20px', gap: 12, alignItems: 'center' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-hover)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <StatusChip status={run.status} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500, lineHeight: 1.4 }}>{run.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', marginTop: 3 }}>{parentPriority ? <>priority · <span style={{ color: 'var(--cb-text-secondary)' }}>{parentPriority.name}</span></> : <span style={{ color: 'var(--cb-accent)' }}>ad-hoc</span>}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>{run.personas.slice(0, 3).map((p) => <span key={p} style={{ fontSize: 9.5, fontFamily: 'var(--cb-font-mono)', color: 'var(--cb-text-secondary)', padding: '1px 5px', background: 'var(--cb-bg-soft)', borderRadius: 2, border: '1px solid var(--cb-border)' }}>{p}</span>)}<span style={{ marginLeft: 'auto', fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)' }}>{run.startedAt}</span></div>
                </div>
                <Icon name="arrow-right" size={12} style={{ color: 'var(--cb-text-muted)' }} />
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export function Dashboard({ workspace, priorities, tickets, runs, ozMessages, selectedRunId, setSelectedRunId, onReorder, onLaunch, onAdhoc, onAddPriority, onAddTicket, onSend, onDecision, onRunAction, ozTyping, live = false, workspaceConfigured, chatPrefill = null, onChatPrefillConsumed }: {
  workspace: Workspace; priorities: Priority[]; tickets: Ticket[]; runs: Run[]; ozMessages: ChatMessage[]
  workspaceConfigured?: boolean
  selectedRunId: string | null; setSelectedRunId: (id: string | null) => void
  onReorder: (from: number, to: number) => void; onLaunch: (p: Priority) => void; onAdhoc: () => void; onAddPriority: () => void
  onAddTicket: () => void
  onSend: (text: string) => void; onDecision: (choice: string) => void; onRunAction: (action: string, id: string) => void
  ozTyping: boolean; live?: boolean
  chatPrefill?: string | null; onChatPrefillConsumed?: () => void
}) {
  const [prioWidth, setPrioWidth] = useState(PRIO_DEFAULT)
  const [activeTab, setActiveTab] = useState<DashboardTab>('priorities')
  const selectedRun = selectedRunId ? runs.find((r) => r.id === selectedRunId) : null
  // Fresh workspace (nothing queued, nothing run yet) → the first-run setup ladder, not a blank grid.
  if (priorities.length === 0 && runs.length === 0 && (!live || workspaceConfigured === false)) {
    return <FirstRun wsName={workspace.name} onBegin={() => onSend('Walk me through setting up this workspace.')} />
  }
  // The Priorities column is user-resizable via the drag handle; clamp to keep both sides usable.
  const onResizeTo = (px: number) => setPrioWidth(Math.max(PRIO_MIN, Math.min(PRIO_MAX, px)))
  const gridTemplateColumns = selectedRun ? `${prioWidth}px 460px 6px 1fr` : `${prioWidth}px 6px 1fr`
  const openTicketCount = tickets.filter((ticket) => ticket.state === 'open').length
  const headerIcon = activeTab === 'priorities' ? 'list-numbers' : activeTab === 'tickets' ? 'ticket' : 'clock-counter-clockwise'
  const headerTitle = activeTab === 'priorities' ? 'Priorities' : activeTab === 'tickets' ? 'Tickets' : 'Runs'
  const addTitle = activeTab === 'priorities' ? 'Add priority' : activeTab === 'tickets' ? 'Add ticket' : ''
  const addAction = activeTab === 'priorities' ? onAddPriority : activeTab === 'tickets' ? onAddTicket : null
  return (
    <div style={{ display: 'grid', gridTemplateColumns, gap: 16, padding: 16, height: '100%', overflow: 'hidden' }}>
      <div style={{ minHeight: 0 }}>
        <div className="oz-panel oz-priorities-panel" style={{ height: '100%' }}>
          <div className="oz-panel-header" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Icon name={headerIcon} size={15} style={{ color: 'var(--cb-accent)' }} />
            <div className="oz-panel-title">{headerTitle}</div>
            <span className="oz-panel-count">{activeTab === 'priorities' ? priorities.length : activeTab === 'tickets' ? openTicketCount : runs.length}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
              <TabStrip active={activeTab} onChange={setActiveTab} priorities={priorities.length} tickets={openTicketCount} runs={runs.length} />
              {addAction && <button className="oz-iconbtn" title={addTitle} onClick={addAction} style={{ width: 26, height: 26, flexShrink: 0 }}><Icon name="plus" size={13} /></button>}
            </div>
          </div>
          <div className="oz-panel-body">
            {activeTab === 'priorities' && <PrioritiesPanel priorities={priorities} runs={runs} onReorder={onReorder} onLaunch={onLaunch} onAdhoc={onAdhoc} onAddPriority={onAddPriority} onSelectRun={setSelectedRunId} selectedRunId={selectedRunId} />}
            {activeTab === 'tickets' && <TicketsTab tickets={tickets} />}
            {activeTab === 'runs' && <RunsTab runs={runs} priorities={priorities} onSelectRun={setSelectedRunId} />}
          </div>
        </div>
      </div>
      {selectedRun && <RunDetail run={selectedRun} parentPriority={selectedRun.priorityId ? priorities.find((p) => p.id === selectedRun.priorityId) || null : null} parentPriorityIndex={selectedRun.priorityId ? priorities.findIndex((p) => p.id === selectedRun.priorityId) : -1} onClose={() => setSelectedRunId(null)} onAction={onRunAction} />}
      <ResizeHandle width={prioWidth} onResizeTo={onResizeTo} />
      <OzChatPanel messages={ozMessages} runs={runs} workspaceName={workspace.name} onSend={onSend} onSelectRun={setSelectedRunId} onDecision={onDecision} ozTyping={ozTyping} live={live} prefill={chatPrefill} onPrefillConsumed={onChatPrefillConsumed} />
    </div>
  )
}
