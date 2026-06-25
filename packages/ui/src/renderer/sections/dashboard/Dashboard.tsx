// Dashboard root — built AROUND the Oz conversation; priorities + runs are panels, never pages. Run
// detail opens as a modal over the dashboard so cards, priorities, and runs share one detail pattern.
// Ported from design-ref/dashboard.jsx, with the left panel now cycling Priorities/Tickets/Runs in place.
import { useState, useCallback, useRef, type DragEvent } from 'react'
import { Button, Icon, Modal, StatusChip } from '../../ui/primitives.tsx'
import { WorkspaceTabs, type ShellTheme } from '../../ui/ShellControls.tsx'

const PRIO_MIN = 300
const PRIO_MAX = 860
const PRIO_MIN_RATIO = 0.25
const PRIO_MAX_RATIO = 0.75
const LAUNCH_BLOCKED_HINT = 'A run is active in this workspace — only one run executes at a time (single-writer lock). It frees up when the run finishes.'
const TICKET_LAUNCH_OFFLINE_HINT = 'Ticket-fix launch is available only when the dashboard is connected to Oz.'
const PENDING_CLOSE_HINT = 'This ticket has verified work awaiting close confirmation. Open the linked run and close it through the governed ticket-close lane before relaunching.'
const OZ_ITEM_MIME = 'application/x-oz-item'

function setOzItemDragData(e: DragEvent, itemType: 'ticket' | 'run', id: string, label: string): void {
  e.dataTransfer?.setData(OZ_ITEM_MIME, JSON.stringify({ itemType, id, label }))
}

function clampPanelRatio(ratio: number, containerWidth: number): number {
  if (!Number.isFinite(ratio)) return 0.45
  if (containerWidth <= 0) return Math.max(PRIO_MIN_RATIO, Math.min(PRIO_MAX_RATIO, ratio))
  const min = Math.max(PRIO_MIN_RATIO, Math.min(PRIO_MIN / containerWidth, 0.45))
  const max = Math.min(PRIO_MAX_RATIO, PRIO_MAX / containerWidth, 1 - min)
  return Math.max(min, Math.min(max, ratio))
}

// Thin draggable divider that resizes the workspace panel by ratio. Dragging attaches window
// listeners so the cursor can leave the 6px handle without dropping.
function ResizeHandle({ ratio, containerWidth, onResizeTo }: { ratio: number; containerWidth: () => number; onResizeTo: (ratio: number) => void }) {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startRatio = ratio
    const width = containerWidth()
    const move = (ev: MouseEvent) => {
      if (width > 0) onResizeTo(startRatio + (ev.clientX - startX) / width)
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.cursor = '' }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
  }, [containerWidth, ratio, onResizeTo])
  return <div className="oz-resize-handle" onMouseDown={onMouseDown} title="Drag to resize" />
}
import { PrioritiesPanel } from './Priorities.tsx'
import { OzChatPanel } from './OzChat.tsx'
import { RunDetail } from './RunDetail.tsx'
import { FirstRun } from './FirstRun.tsx'
import { DEFAULT_PANEL_RATIO, runDisplayName, type ChatMessage, type Priority, type Run, type Ticket, type Workspace } from '../../model.ts'

type DashboardTab = 'priorities' | 'tickets' | 'runs'
type RunFilter = 'all' | 'active' | 'complete' | 'failed'

function TabStrip({ active, onChange, priorities, tickets, runs }: { active: DashboardTab; onChange: (tab: DashboardTab) => void; priorities: number; tickets: number; runs: number }) {
  const tabs: Array<{ id: DashboardTab; label: string; count: number }> = [
    { id: 'priorities', label: 'Priorities', count: priorities },
    { id: 'tickets', label: 'Tickets', count: tickets },
    { id: 'runs', label: 'Runs/Sessions', count: runs },
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
            padding: '7px 12px',
            border: 'none',
            borderRadius: 3,
            background: active === tab.id ? 'var(--cb-accent-muted)' : 'transparent',
            color: active === tab.id ? 'var(--cb-accent)' : 'var(--cb-text-muted)',
            cursor: 'pointer',
            fontFamily: 'var(--cb-font-body)',
            fontSize: 13,
          }}
        >
          <span>{tab.label}</span>
          <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 11, opacity: 0.75 }}>{tab.count}</span>
        </button>
      ))}
    </div>
  )
}

function TicketsTab({ tickets, onLaunchTicket, onReorderTickets, launchBlocked, live }: { tickets: Ticket[]; onLaunchTicket: (ticket: Ticket) => void; onReorderTickets: (from: number, to: number) => void; launchBlocked: boolean; live: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ from: number | null; over: number | null }>({ from: null, over: null })
  const draggedIndex = useRef<number | null>(null)
  const openTickets = tickets.filter((ticket) => ticket.state === 'open')
  const selected = selectedId ? openTickets.find((ticket) => ticket.id === selectedId) ?? null : null
  const launchDisabled = !live || launchBlocked
  const launchTitle = launchBlocked ? LAUNCH_BLOCKED_HINT : !live ? TICKET_LAUNCH_OFFLINE_HINT : undefined
  const selectedLaunchDisabled = launchDisabled || Boolean(selected?.pendingCloseRunId)
  const selectedLaunchTitle = selected?.pendingCloseRunId ? PENDING_CLOSE_HINT : launchTitle
  const meta = selected
    ? [
      ['type', selected.type],
      ['status', selected.status],
      ['priority', selected.priority],
      ['owner', selected.owner],
      ['created', selected.created],
    ].filter(([, value]) => value)
    : []
  const handleDrag = (type: string, index: number) => {
    if (type === 'start') setDrag({ from: index, over: null })
    else if (type === 'over') setDrag((d) => ({ ...d, over: index }))
    else if (type === 'drop') { if (drag.from !== null && drag.from !== index) onReorderTickets(drag.from, index); setDrag({ from: null, over: null }) }
    else if (type === 'end') setDrag({ from: null, over: null })
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
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {openTickets.map((ticket, index) => {
          const ticketLaunchDisabled = launchDisabled || Boolean(ticket.pendingCloseRunId)
          const ticketLaunchTitle = ticket.pendingCloseRunId ? PENDING_CLOSE_HINT : launchTitle
          return (
          <div
            key={ticket.id}
            draggable
            role="button"
            tabIndex={0}
            onDragStart={(e) => { draggedIndex.current = index; setOzItemDragData(e, 'ticket', ticket.id, ticket.title); handleDrag('start', index) }}
            onDragOver={(e) => { e.preventDefault(); handleDrag('over', index) }}
            onDragEnd={() => handleDrag('end', index)}
            onDrop={(e) => { e.preventDefault(); handleDrag('drop', index) }}
            onClick={() => { if (draggedIndex.current === index) { draggedIndex.current = null; return } setSelectedId(ticket.id) }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              setSelectedId(ticket.id)
            }}
            style={{ width: '100%', textAlign: 'left', padding: '9px 10px', background: 'var(--cb-surface-glass)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', cursor: 'grab', fontFamily: 'var(--cb-font-body)', color: 'var(--cb-text)', transition: 'box-shadow 120ms ease-out, background 120ms ease-out, border-color 120ms ease-out, opacity 120ms ease-out', opacity: drag.from === index ? 0.4 : 1, boxShadow: drag.over === index && drag.from !== index ? '0 0 0 2px var(--cb-accent-30)' : 'none' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--cb-accent-30)'; e.currentTarget.style.background = 'var(--cb-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--cb-border)'; e.currentTarget.style.background = 'var(--cb-surface-glass)' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <Icon name="dots-six-vertical" size={14} style={{ color: 'var(--cb-text-muted)', cursor: 'grab', marginTop: 1 }} />
              <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-accent)', minWidth: 34, paddingTop: 2 }}>{ticket.id}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.4, paddingTop: 1 }}>{ticket.title}</div>
                <div style={{ fontSize: 10.5, color: 'var(--cb-text-muted)', marginTop: 3 }}>{ticket.pendingCloseRunId ? `pending close via ${ticket.pendingCloseRunId}` : `${ticket.type || 'ticket'} · ${ticket.priority || 'none'} · ${ticket.status || 'Open'}`}</div>
              </div>
              <Button variant="secondary" size="sm" icon="play" disabled={ticketLaunchDisabled} title={ticketLaunchTitle} onClick={(e) => { e.stopPropagation(); onLaunchTicket(ticket) }}>Launch</Button>
              <Icon name="arrow-right" size={12} style={{ color: 'var(--cb-text-muted)', marginTop: 3 }} />
            </div>
          </div>
          )
        })}
      </div>
      {selected && (
        <Modal
          open
          onClose={() => setSelectedId(null)}
          title={`${selected.id} - ${selected.title}`}
          subtitle="Ticket detail"
          icon="ticket"
          width={680}
          footer={<Button variant="secondary" icon="play" disabled={selectedLaunchDisabled} title={selectedLaunchTitle} onClick={() => { onLaunchTicket(selected); setSelectedId(null) }}>Launch fix</Button>}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {meta.map(([label, value]) => (
              <span key={label} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', padding: '2px 6px', border: '1px solid var(--cb-border)', borderRadius: 3, background: 'var(--cb-bg-soft)', fontSize: 10.5, color: 'var(--cb-text-secondary)' }}>
                <span style={{ fontFamily: 'var(--cb-font-mono)', color: 'var(--cb-text-muted)' }}>{label}</span>{value}
              </span>
            ))}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.65, color: 'var(--cb-text-secondary)', borderTop: '1px solid var(--cb-border)', paddingTop: 12 }}>{selected.body}</div>
        </Modal>
      )}
    </>
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
              <div key={run.id} draggable onDragStart={(e) => setOzItemDragData(e, 'run', run.id, runDisplayName(run))} onClick={() => onSelectRun(run.id)} style={{ padding: '12px 4px', borderBottom: '1px solid var(--cb-border)', cursor: 'pointer', display: 'grid', gridTemplateColumns: '92px minmax(0,1fr) 20px', gap: 12, alignItems: 'center' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-hover)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <StatusChip status={run.status} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500, lineHeight: 1.4 }}>{run.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', marginTop: 3 }}>{parentPriority ? <>priority · <span style={{ color: 'var(--cb-text-secondary)' }}>{parentPriority.name}</span></> : <span style={{ color: 'var(--cb-accent)' }}>ad-hoc</span>}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>{run.personas.slice(0, 3).map((p) => <span key={p} style={{ fontSize: 9.5, fontFamily: 'var(--cb-font-mono)', color: 'var(--cb-text-secondary)', padding: '1px 5px', background: 'var(--cb-bg-soft)', borderRadius: 2, border: '1px solid var(--cb-border)' }}>{p}</span>)}<span style={{ marginLeft: 'auto', fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)' }}>{runDisplayName(run)} · {run.startedAt}</span></div>
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

export function Dashboard({ workspace, priorities, tickets, runs, ozMessages, selectedRunId, setSelectedRunId, onReorder, onReorderTickets, onLaunch, onAdhoc, onAddPriority, onAddTicket, onLaunchTicket, onSend, onDecision, onRunAction, ozTyping, live = false, workspaceConfigured, chatPrefill = null, onChatPrefillConsumed, workspaces, activeId, loadedIds, runsMap, onSelectWs, onCloseWs, onLoadWs, onCreateWs, theme = 'dark', setTheme = () => undefined, conn = 'fixtures', onRestartOz, chatTarget = workspace.id, chatTargets, onChatTargetChange = () => undefined, chatTargetName = workspace.name, chatRuns, panelRatio = DEFAULT_PANEL_RATIO, onPanelRatioChange = () => undefined }: {
  workspace: Workspace; priorities: Priority[]; tickets: Ticket[]; runs: Run[]; ozMessages: ChatMessage[]
  workspaceConfigured?: boolean
  selectedRunId: string | null; setSelectedRunId: (id: string | null) => void
  onReorder: (from: number, to: number) => void; onReorderTickets: (from: number, to: number) => void; onLaunch: (p: Priority, strictPreRunDirt?: boolean, allowPreRunIntegrityErrors?: boolean) => void; onAdhoc: () => void; onAddPriority: () => void
  onAddTicket: () => void; onLaunchTicket: (ticket: Ticket) => void
  onSend: (text: string) => void; onDecision: (choice: string) => void; onRunAction: (action: string, id: string) => void
  ozTyping: boolean; live?: boolean
  chatPrefill?: string | null; onChatPrefillConsumed?: () => void
  workspaces?: Workspace[]; activeId?: string; loadedIds?: string[]; runsMap?: Record<string, Run[]>
  onSelectWs?: (id: string) => void; onCloseWs?: (id: string) => void; onLoadWs?: (id: string) => void; onCreateWs?: () => void
  theme?: ShellTheme; setTheme?: (fn: (t: ShellTheme) => ShellTheme) => void; conn?: string; onRestartOz?: () => void
  chatTarget?: string | null; chatTargets?: Workspace[]; onChatTargetChange?: (target: string | null) => void
  chatTargetName?: string; chatRuns?: Run[]
  panelRatio?: number; onPanelRatioChange?: (ratio: number) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<DashboardTab>('priorities')
  const selectedRun = selectedRunId ? runs.find((r) => r.id === selectedRunId) : null
  const containerWidth = useCallback(() => gridRef.current ? gridRef.current.clientWidth || gridRef.current.getBoundingClientRect().width : 0, [])
  // Fresh workspace (nothing queued, nothing run yet) → the first-run setup ladder, not a blank grid.
  if (priorities.length === 0 && runs.length === 0 && (!live || workspaceConfigured === false)) {
    return <FirstRun wsName={workspace.name} onBegin={() => onSend('Walk me through setting up this workspace.')} />
  }
  const ratio = clampPanelRatio(panelRatio, containerWidth())
  const onResizeTo = (nextRatio: number) => onPanelRatioChange(clampPanelRatio(nextRatio, containerWidth()))
  const gridTemplateColumns = `${Number((ratio * 100).toFixed(4))}% 6px 1fr`
  const openTicketCount = tickets.filter((ticket) => ticket.state === 'open').length
  const launchBlocked = runs.some((r) => r.status === 'running')
  const addTitle = activeTab === 'priorities' ? 'Add priority' : activeTab === 'tickets' ? 'Add ticket' : ''
  const addAction = activeTab === 'priorities' ? onAddPriority : activeTab === 'tickets' ? onAddTicket : null
  const workspaceTabs = {
    workspaces: workspaces ?? [workspace],
    activeId: activeId ?? workspace.id,
    loadedIds: loadedIds ?? [workspace.id],
    runsMap: runsMap ?? { [workspace.id]: runs },
    onSelect: onSelectWs ?? (() => undefined),
    onClose: onCloseWs ?? (() => undefined),
    onLoad: onLoadWs ?? (() => undefined),
    onCreate: onCreateWs ?? (() => undefined),
  }
  return (
    <div ref={gridRef} style={{ display: 'grid', gridTemplateColumns, gap: 16, padding: 16, height: '100%', overflow: 'hidden' }}>
      <div style={{ minHeight: 0 }}>
        <div className="oz-panel oz-priorities-panel" style={{ height: '100%' }}>
          <div className="oz-panel-header" style={{ gap: 10, alignItems: 'stretch', flexDirection: 'column' }}>
            <WorkspaceTabs {...workspaceTabs} />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, flexWrap: 'wrap' }}>
              <TabStrip active={activeTab} onChange={setActiveTab} priorities={priorities.length} tickets={openTicketCount} runs={runs.length} />
              {addAction && <button className="oz-iconbtn" title={addTitle} onClick={addAction} style={{ width: 26, height: 26, flexShrink: 0 }}><Icon name="plus" size={13} /></button>}
            </div>
          </div>
          <div className="oz-panel-body">
            {activeTab === 'priorities' && <PrioritiesPanel priorities={priorities} runs={runs} onReorder={onReorder} onLaunch={onLaunch} onAdhoc={onAdhoc} onAddPriority={onAddPriority} onSelectRun={setSelectedRunId} selectedRunId={selectedRunId} />}
            {activeTab === 'tickets' && <TicketsTab tickets={tickets} onLaunchTicket={onLaunchTicket} onReorderTickets={onReorderTickets} launchBlocked={launchBlocked} live={live} />}
            {activeTab === 'runs' && <RunsTab runs={runs} priorities={priorities} onSelectRun={setSelectedRunId} />}
          </div>
        </div>
      </div>
      <ResizeHandle ratio={ratio} containerWidth={containerWidth} onResizeTo={onResizeTo} />
      <OzChatPanel messages={ozMessages} runs={chatRuns ?? runs} workspaceName={chatTargetName} onSend={onSend} onSelectRun={setSelectedRunId} onDecision={onDecision} ozTyping={ozTyping} live={live} prefill={chatPrefill} onPrefillConsumed={onChatPrefillConsumed} theme={theme} setTheme={setTheme} conn={conn} onRestartOz={onRestartOz} chatTarget={chatTarget} chatTargets={chatTargets ?? [workspace]} onChatTargetChange={onChatTargetChange} />
      {selectedRun && <RunDetail run={selectedRun} parentPriority={selectedRun.priorityId ? priorities.find((p) => p.id === selectedRun.priorityId) || null : null} parentPriorityIndex={selectedRun.priorityId ? priorities.findIndex((p) => p.id === selectedRun.priorityId) : -1} onClose={() => setSelectedRunId(null)} onAction={onRunAction} />}
    </div>
  )
}
