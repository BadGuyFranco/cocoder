// Run Detail modal — selected runs open over the dashboard. Tabs: Transcript (read-only window into
// the externally-running session) · Evidence · Attach. Footer actions adapt to status. Ported from
// design-ref/dashboard.jsx.
import { useState } from 'react'
import { Icon, StatusChip, Button, Modal } from '../../ui/primitives.tsx'
import { runDisplayName, type Priority, type Run } from '../../model.ts'

export function RunDetail({ run, parentPriority, parentPriorityIndex, onClose, onAction }: {
  run: Run; parentPriority: Priority | null; parentPriorityIndex: number; onClose: () => void; onAction: (action: string, id: string) => void
}) {
  const [tab, setTab] = useState<'transcript' | 'evidence' | 'session'>('transcript')
  const isRunning = run.status === 'running'
  const isParked = run.status === 'blocked'
  const isStreaming = run.status === 'running' || run.status === 'blocked'
  const archiveAction = run.actions?.find((action) => action.type === 'archive-priority-confirmation')
  const displayName = runDisplayName(run)
  const footer = isRunning ? (
    <>
      <Button variant="destructive" size="sm" icon="stop" onClick={() => onAction('stop', run.id)}>Stop run</Button>
      <Button variant="ghost" size="sm" icon="terminal-window" onClick={() => onAction('attach', run.id)}>Attach</Button>
      <Button variant="ghost" size="sm" icon="x-square" onClick={() => onAction('teardown', run.id)} title="Terminate this run's personas and close their cmux panes">Teardown</Button>
      <Button variant="ghost" size="sm" icon="chat-circle-text" onClick={() => onAction('ask-oz', run.id)} style={{ marginLeft: 'auto' }}>Ask Oz</Button>
    </>
  ) : isParked ? (
    <>
      {archiveAction && <Button variant="secondary" size="sm" icon="archive" onClick={() => onAction('archive', run.id)}>Archive priority</Button>}
      <Button variant="ghost" size="sm" icon="chat-circle-text" onClick={() => onAction('ask-oz', run.id)} style={{ marginLeft: 'auto' }}>Ask Oz</Button>
    </>
  ) : run.status === 'failed' ? (
    <>
      <Button variant="secondary" size="sm" icon="arrow-clockwise" onClick={() => onAction('retry', run.id)}>Retry</Button>
      <Button variant="ghost" size="sm" icon="chat-circle-text" onClick={() => onAction('ask-oz', run.id)}>Ask Oz why</Button>
      <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--cb-text-muted)' }}>Last event: {run.lastEvent}</div>
    </>
  ) : (
    <>
      <Button variant="ghost" size="sm" icon="arrow-clockwise" onClick={() => onAction('retry', run.id)}>Re-run</Button>
      <Button variant="ghost" size="sm" icon="chat-circle-text" onClick={() => onAction('ask-oz', run.id)} style={{ marginLeft: 'auto' }}>Ask Oz</Button>
    </>
  )
  return (
    <Modal
      open
      onClose={onClose}
      title={run.title}
      subtitle={`${displayName} · started ${run.startedAt} · cli: ${run.cli}`}
      icon="terminal-window"
      width={840}
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '10px 20px', background: 'var(--cb-accent-muted)', borderBottom: '1px solid var(--cb-accent-15)', display: 'flex', alignItems: 'center', gap: 10 }}>
        {parentPriority ? (
          <>
            <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-accent)', letterSpacing: 0.5, padding: '2px 6px', background: 'var(--cb-accent-15)', borderRadius: 2, fontWeight: 600 }}>P{String(parentPriorityIndex + 1).padStart(2, '0')}</span>
            <Icon name="arrow-right" size={11} style={{ color: 'var(--cb-accent)', opacity: 0.6 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, marginBottom: 1 }}>PRIORITY · RUN OF</div>
              <div style={{ fontSize: 12, color: 'var(--cb-text)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parentPriority.name}</div>
            </div>
          </>
        ) : (
          <>
            <Icon name="lightning" size={13} style={{ color: 'var(--cb-accent)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, marginBottom: 1 }}>AD-HOC</div>
              <div style={{ fontSize: 12, color: 'var(--cb-text)', fontWeight: 500 }}>No parent priority</div>
            </div>
          </>
        )}
      </div>
      <div className="oz-panel-header" style={{ padding: '14px 20px' }}>
        <StatusChip status={run.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: 'var(--cb-text)', fontWeight: 500, lineHeight: 1.3 }}>{run.title}</div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)', marginTop: 3 }}>{displayName} · started {run.startedAt} · cli: {run.cli}</div>
        </div>
      </div>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--cb-border)', display: 'flex', flexWrap: 'wrap', gap: 16, background: 'var(--cb-bg-soft)' }}>
        <div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, marginBottom: 3 }}>PERSONAS</div>
          <div style={{ display: 'flex', gap: 5 }}>{run.personas.map((p) => <span key={p} style={{ fontSize: 11, padding: '2px 8px', background: 'var(--cb-accent-muted)', border: '1px solid var(--cb-accent-15)', color: 'var(--cb-accent)', borderRadius: 2, fontWeight: 500 }}>{p}</span>)}</div>
        </div>
        {run.progress != null && (
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, marginBottom: 3 }}>PROGRESS · <span style={{ color: 'var(--cb-text)' }}>{Math.round(run.progress * 100)}%</span></div>
            <div style={{ height: 3, background: 'var(--cb-border)', borderRadius: 2, overflow: 'hidden' }}><div style={{ height: '100%', width: `${run.progress * 100}%`, background: run.status === 'blocked' || run.status === 'failed' ? 'var(--cb-highlight)' : 'var(--cb-accent)' }} /></div>
          </div>
        )}
        <div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, marginBottom: 3 }}>WATCHED BY</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--cb-text)' }}><Icon name="eye" size={13} style={{ color: 'var(--cb-accent)' }} />Oz</div>
        </div>
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--cb-border)', padding: '0 20px' }}>
        {([{ id: 'transcript', label: 'Transcript', icon: 'chat-text' }, { id: 'evidence', label: `Evidence (${(run.evidence || []).length})`, icon: 'file-text' }, { id: 'session', label: 'Attach', icon: 'terminal-window' }] as const).map((t) => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{ padding: '10px 14px', fontSize: 11.5, fontFamily: 'var(--cb-font-body)', color: tab === t.id ? 'var(--cb-accent)' : 'var(--cb-text-muted)', borderBottom: `2px solid ${tab === t.id ? 'var(--cb-accent)' : 'transparent'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: -1, fontWeight: tab === t.id ? 500 : 400 }}>
            <Icon name={t.icon} size={13} />{t.label}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tab === 'transcript' && (
          <div style={{ padding: '8px 20px 16px', fontFamily: 'var(--cb-font-mono)', fontSize: 11.5, lineHeight: 1.7 }}>
            <div style={{ color: 'var(--cb-text-muted)', padding: '8px 0' }}><Icon name="info" size={12} /> read-only window — the session runs in cmux</div>
            {(run.transcript || []).map((line, i) => {
              const isSystem = line.role === 'system'
              const roleColor = isSystem ? 'var(--cb-text-muted)' : line.role === 'Oz' ? 'var(--cb-accent)' : line.role === 'Builder' ? 'var(--cb-success)' : line.role === 'Reviewer' ? 'var(--cb-highlight)' : 'var(--cb-text-secondary)'
              return (
                <div key={i} style={{ marginBottom: 10, display: 'flex', gap: 12 }}>
                  <span style={{ color: roleColor, minWidth: 80, fontWeight: 500, fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, paddingTop: 2 }}>{isSystem ? 'system' : line.role.toLowerCase()}</span>
                  <span style={{ color: isSystem ? 'var(--cb-text-muted)' : 'var(--cb-text)', fontStyle: isSystem ? 'italic' : 'normal', fontFamily: 'var(--cb-font-body)', fontSize: 12.5, lineHeight: 1.6 }}>{line.body}</span>
                </div>
              )
            })}
            {isStreaming && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, color: 'var(--cb-accent)' }}><span style={{ width: 6, height: 6, background: 'var(--cb-accent)', borderRadius: '50%', animation: 'ozPulse 1.6s infinite' }} /><span style={{ fontSize: 11, fontFamily: 'var(--cb-font-mono)' }}>streaming…</span></div>}
          </div>
        )}
        {tab === 'evidence' && (
          <div style={{ padding: '12px 20px' }}>
            {(run.evidence || []).length === 0 ? <div className="oz-empty"><div className="oz-empty-body">No evidence yet.</div></div> : (run.evidence || []).map((e, i) => {
              const iconName = e.kind === 'diff' ? 'git-diff' : e.kind === 'pr' ? 'git-pull-request' : e.kind === 'error' ? 'warning-circle' : 'note'
              const accentColor = e.kind === 'error' ? 'var(--cb-highlight)' : e.kind === 'pr' ? 'var(--cb-success)' : 'var(--cb-accent)'
              return (
                <div key={i} style={{ padding: 12, marginBottom: 8, background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: e.body ? 6 : 0 }}>
                    <Icon name={iconName} size={14} style={{ color: accentColor }} />
                    <span style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500 }}>{e.label}</span>
                    {e.lines && <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)', marginLeft: 'auto' }}>{e.lines}</span>}
                  </div>
                  {e.body && <div style={{ fontSize: 12, color: 'var(--cb-text-secondary)', lineHeight: 1.6 }}>{e.body}</div>}
                </div>
              )
            })}
          </div>
        )}
        {tab === 'session' && (
          <div style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--cb-text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>The orchestration session runs in cmux. Deep-link to focus its pane, or copy the attach command to drop into the live shell.</div>
            <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12, background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', padding: '12px 14px', borderRadius: 'var(--cb-radius-md)', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ color: 'var(--cb-accent)' }}>$</span><span style={{ flex: 1, color: 'var(--cb-text)' }}>{run.attachCmd || `cocoder attach ${run.id}`}</span>
              <button className="oz-iconbtn" style={{ width: 28, height: 28 }} title="Copy"><Icon name="copy" size={13} /></button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" size="sm" icon="terminal-window" onClick={() => onAction('attach', run.id)}>Open in cmux</Button>
              <Button variant="ghost" size="sm" icon="copy">Copy command</Button>
            </div>
          </div>
        )}
      </div>
      </div>
    </Modal>
  )
}
