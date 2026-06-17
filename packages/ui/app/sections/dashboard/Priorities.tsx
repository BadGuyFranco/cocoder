// Priorities panel — the workspace's ordered queue (top = next up), drag-reorderable. A run IS a
// priority being executed: a running priority expands to an inline run summary, and clicking it opens
// the run drawer. Ad-hoc is a pinned, always-first row that can hold many concurrent runs. Ported
// faithfully from design-ref/dashboard.jsx (dev pins dropped).
import { useState } from 'react'
import { Icon, StatusChip, Button } from '../../ui/primitives.tsx'
import { isActiveRun } from '../../adapter.ts'
import type { Priority, Run } from '../../model.ts'

const LAUNCH_BLOCKED_HINT = 'A run is active in this workspace — only one run executes at a time (single-writer lock). It frees up when the run finishes.'

function PriorityRow({ priority, index, onLaunch, onDrag, isDragging, isDropTarget, onSelectRun, runs, selectedRunId, launchBlocked }: {
  priority: Priority; index: number; onLaunch: (p: Priority) => void; onDrag: (type: string, index: number) => void
  isDragging: boolean; isDropTarget: boolean; onSelectRun: (id: string) => void; runs: Run[]; selectedRunId: string | null; launchBlocked: boolean
}) {
  const linkedRun = priority.runId ? runs.find((r) => r.id === priority.runId) : null
  const isActive = !!linkedRun && isActiveRun(linkedRun.status)
  const isBlocked = !!linkedRun && linkedRun.status === 'blocked'
  const isSelected = !!linkedRun && linkedRun.id === selectedRunId
  const borderColor = isSelected ? 'var(--cb-accent)' : isBlocked ? 'rgba(212,118,110,0.30)' : isActive ? 'var(--cb-accent-30)' : 'var(--cb-border)'
  return (
    <div draggable onDragStart={() => onDrag('start', index)} onDragOver={(e) => { e.preventDefault(); onDrag('over', index) }} onDragEnd={() => onDrag('end', index)} onDrop={(e) => { e.preventDefault(); onDrag('drop', index) }}
      onClick={() => isActive && linkedRun && onSelectRun(linkedRun.id)}
      style={{
        background: isSelected ? 'var(--cb-accent-muted)' : isActive ? 'var(--cb-accent-subtle)' : 'var(--cb-surface-glass)',
        borderTop: `1px solid ${borderColor}`,
        borderBottom: `1px solid ${borderColor}`,
        borderLeft: `1px solid ${borderColor}`,
        borderRight: `1px solid ${isSelected ? 'var(--cb-accent)' : borderColor}`,
        borderRadius: isSelected ? 'var(--cb-radius-md) 0 0 var(--cb-radius-md)' : 'var(--cb-radius-md)',
        padding: '9px 10px', marginBottom: 8, marginRight: isSelected ? -17 : 0, paddingRight: isSelected ? 24 : 10,
        opacity: isDragging ? 0.4 : 1,
        boxShadow: isDropTarget ? '0 0 0 2px var(--cb-accent-30)' : isSelected ? '0 4px 16px rgba(201,169,110,0.18)' : 'none',
        cursor: isActive ? 'pointer' : 'grab',
        transition: 'box-shadow 120ms ease-out, background 120ms ease-out, margin-right 200ms ease-out, padding-right 200ms ease-out, border-radius 200ms ease-out',
        position: 'relative', zIndex: isSelected ? 5 : 1,
      }}>
      {isSelected && <div style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%) rotate(45deg)', width: 14, height: 14, background: 'var(--cb-accent-muted)', borderTop: '1px solid var(--cb-accent)', borderRight: '1px solid var(--cb-accent)', zIndex: 6, pointerEvents: 'none' }} />}
      {isActive && !isSelected && <div data-run-accent={linkedRun?.status} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: isBlocked ? 'var(--cb-highlight)' : 'var(--cb-accent)', animation: isBlocked ? 'none' : 'ozPulse 1.8s infinite' }} />}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 1 }}>
          <Icon name="dots-six-vertical" size={14} style={{ color: 'var(--cb-text-muted)', cursor: 'grab' }} />
          <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: index === 0 ? 'var(--cb-accent)' : 'var(--cb-text-muted)', minWidth: 18, textAlign: 'right' }}>{String(index + 1).padStart(2, '0')}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, color: 'var(--cb-text)', lineHeight: 1.4, paddingTop: 1 }}>{priority.name}</div>
        <div className="oz-priority-actions">
          {linkedRun ? <StatusChip status={linkedRun.status} /> : <StatusChip status={priority.status} label={priority.status === 'ready' ? 'Ready' : priority.status} />}
          {!isActive && <Button variant="secondary" size="sm" icon="play" disabled={launchBlocked} title={launchBlocked ? LAUNCH_BLOCKED_HINT : undefined} onClick={(e) => { e.stopPropagation(); onLaunch(priority) }}>Launch</Button>}
        </div>
      </div>
      {isActive && linkedRun && (
        <div style={{ marginTop: 10, marginLeft: 36, paddingTop: 10, borderTop: '1px solid var(--cb-border)', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{linkedRun.id} · {linkedRun.startedAt}</span>
            <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>{linkedRun.personas.slice(0, 4).map((p) => <span key={p} style={{ fontSize: 9.5, fontFamily: 'var(--cb-font-mono)', color: 'var(--cb-text-secondary)', padding: '1px 5px', background: 'var(--cb-bg-soft)', borderRadius: 2 }}>{p}</span>)}</div>
          </div>
          <div style={{ fontSize: 11.5, color: isBlocked ? 'var(--cb-highlight)' : 'var(--cb-text-secondary)', lineHeight: 1.5, marginBottom: 8, fontStyle: 'italic' }}>
            {isBlocked && <Icon name="warning-circle" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />}{linkedRun.lastEvent}
          </div>
          {linkedRun.progress != null && <div style={{ height: 2, background: 'var(--cb-border)', borderRadius: 1, overflow: 'hidden' }}><div style={{ height: '100%', width: `${linkedRun.progress * 100}%`, background: isBlocked ? 'var(--cb-highlight)' : 'var(--cb-accent)', transition: 'width 300ms ease-out' }} /></div>}
        </div>
      )}
    </div>
  )
}

function AdhocPriorityRow({ adhocRuns, onLaunch, onSelectRun, selectedRunId, launchBlocked }: { adhocRuns: Run[]; onLaunch: () => void; onSelectRun: (id: string) => void; selectedRunId: string | null; launchBlocked: boolean }) {
  const activeCount = adhocRuns.filter((r) => isActiveRun(r.status)).length
  const hasSelected = adhocRuns.some((r) => r.id === selectedRunId)
  const borderColor = hasSelected ? 'var(--cb-accent)' : adhocRuns.length > 0 ? 'var(--cb-accent-30)' : 'var(--cb-border)'
  return (
    <div style={{ background: hasSelected ? 'var(--cb-accent-muted)' : 'var(--cb-surface-glass)', borderTop: `1px solid ${borderColor}`, borderBottom: `1px solid ${borderColor}`, borderLeft: `1px solid ${borderColor}`, borderRight: `1px solid ${hasSelected ? 'var(--cb-accent)' : borderColor}`, borderRadius: hasSelected ? 'var(--cb-radius-md) 0 0 var(--cb-radius-md)' : 'var(--cb-radius-md)', padding: '9px 10px', marginBottom: 8, marginRight: hasSelected ? -17 : 0, paddingRight: hasSelected ? 24 : 10, position: 'relative', transition: 'all 200ms ease-out', boxShadow: hasSelected ? '0 4px 16px rgba(201,169,110,0.18)' : 'none', zIndex: hasSelected ? 5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 1 }}><Icon name="push-pin" size={12} style={{ color: 'var(--cb-text-muted)' }} /><Icon name="lightning" size={14} style={{ color: 'var(--cb-accent)' }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--cb-text)', lineHeight: 1.4 }}>Ad-hoc</span>
            <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', padding: '1px 5px', background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 2 }}>pinned</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', lineHeight: 1.5 }}>Refactors · code reviews · research · audits — work that doesn't fit a priority.</div>
        </div>
        <div className="oz-priority-actions">
          {activeCount > 0 ? <span className="oz-chip oz-chip-running"><span className="dot" />{activeCount} active</span> : <StatusChip status="ready" label="Ready" />}
          <Button variant="secondary" size="sm" icon="play" disabled={launchBlocked} title={launchBlocked ? LAUNCH_BLOCKED_HINT : undefined} onClick={(e) => { e.stopPropagation(); onLaunch() }}>Launch run</Button>
        </div>
      </div>
      {adhocRuns.length > 0 && (
        <div style={{ marginTop: 10, marginLeft: 36, paddingTop: 10, borderTop: '1px solid var(--cb-border)' }}>
          {adhocRuns.map((r, idx) => {
            const isSel = r.id === selectedRunId, isBlocked = r.status === 'blocked', isLive = isActiveRun(r.status)
            return (
              <div key={r.id} onClick={() => onSelectRun(r.id)} style={{ padding: '8px 10px', background: isSel ? 'var(--cb-accent-15)' : 'transparent', border: `1px solid ${isSel ? 'var(--cb-accent-30)' : 'var(--cb-border)'}`, borderRadius: 'var(--cb-radius-sm)', marginBottom: idx === adhocRuns.length - 1 ? 0 : 6, cursor: 'pointer', transition: 'all 120ms ease-out', position: 'relative', overflow: 'hidden' }}
                onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = 'var(--cb-hover)' }}
                onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'transparent' }}>
                {isLive && <div data-run-accent={r.status} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: isBlocked ? 'var(--cb-highlight)' : 'var(--cb-accent)', animation: isBlocked ? 'none' : 'ozPulse 1.8s infinite' }} />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><StatusChip status={r.status} /><span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{r.id}</span><span style={{ marginLeft: 'auto', fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{r.startedAt}</span></div>
                <div style={{ fontSize: 12, color: 'var(--cb-text)', fontWeight: 500, marginBottom: 4, lineHeight: 1.4 }}>{r.title}</div>
                {r.lastEvent && <div style={{ fontSize: 11, color: isBlocked ? 'var(--cb-highlight)' : 'var(--cb-text-muted)', lineHeight: 1.5, fontStyle: 'italic' }}>{r.lastEvent}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function PrioritiesPanel({ priorities, runs, onReorder, onLaunch, onAdhoc, onAddPriority, onSelectRun, onOpenRunHistory, selectedRunId }: {
  priorities: Priority[]; runs: Run[]; onReorder: (from: number, to: number) => void; onLaunch: (p: Priority) => void
  onAdhoc: () => void; onAddPriority: () => void; onSelectRun: (id: string) => void; onOpenRunHistory: () => void; selectedRunId: string | null
}) {
  const [drag, setDrag] = useState<{ from: number | null; over: number | null }>({ from: null, over: null })
  const handleDrag = (type: string, index: number) => {
    if (type === 'start') setDrag({ from: index, over: null })
    else if (type === 'over') setDrag((d) => ({ ...d, over: index }))
    else if (type === 'drop') { if (drag.from !== null && drag.from !== index) onReorder(drag.from, index); setDrag({ from: null, over: null }) }
    else if (type === 'end') setDrag({ from: null, over: null })
  }
  const adhocRuns = runs.filter((r) => !r.priorityId && isActiveRun(r.status))
  // The daemon serializes runs per workspace (single-writer lock, ADR-0004): a POST /runs while a run is
  // executing 409s. Mirror that here so Launch is legibly disabled instead of silently failing. Only a
  // truly in-flight ('running') run holds the lock — settled runs have ended.
  const launchBlocked = runs.some((r) => r.status === 'running')
  return (
    <div className="oz-panel oz-priorities-panel" style={{ height: '100%' }}>
      <div className="oz-panel-header">
        <Icon name="list-numbers" size={15} style={{ color: 'var(--cb-accent)' }} />
        <div className="oz-panel-title">Priorities</div>
        <span className="oz-panel-count">{priorities.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={onOpenRunHistory} title={`Run history (${runs.length})`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', background: 'transparent', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', color: 'var(--cb-text-muted)', fontSize: 11, fontFamily: 'var(--cb-font-body)', cursor: 'pointer' }}>
            <Icon name="clock-counter-clockwise" size={12} /><span>Run history</span><span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10 }}>{runs.length}</span>
          </button>
          <button className="oz-iconbtn" title="Add priority" onClick={onAddPriority} style={{ width: 26, height: 26 }}><Icon name="plus" size={13} /></button>
        </div>
      </div>
      <div className="oz-panel-body">
        <AdhocPriorityRow adhocRuns={adhocRuns} onLaunch={onAdhoc} onSelectRun={onSelectRun} selectedRunId={selectedRunId} launchBlocked={launchBlocked} />
        {priorities.length === 0 ? (
          <div className="oz-empty" style={{ padding: '32px 16px' }}>
            <div className="oz-empty-icon" style={{ width: 44, height: 44 }}><Icon name="list-numbers" size={22} /></div>
            <div className="oz-empty-title">Nothing queued</div>
            <div className="oz-empty-body">Ask Oz to draft your first priority, or add one yourself.</div>
            <Button variant="secondary" size="sm" icon="plus" onClick={onAddPriority}>Add priority</Button>
          </div>
        ) : (
          <>
            <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, padding: '4px 4px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>QUEUE · ↑ TOP = NEXT UP</span><span style={{ flex: 1, height: 1, background: 'var(--cb-border)' }} />
            </div>
            {priorities.map((p, i) => <PriorityRow key={p.id} priority={p} index={i} onLaunch={onLaunch} onSelectRun={onSelectRun} onDrag={handleDrag} isDragging={drag.from === i} isDropTarget={drag.over === i && drag.from !== i} runs={runs} selectedRunId={selectedRunId} launchBlocked={launchBlocked} />)}
          </>
        )}
      </div>
    </div>
  )
}
