import { isActiveRun } from '../../adapter.ts'
import { runDisplayName, type Priority, type Run } from '../../model.ts'
import { Button, Icon, Modal, StatusChip } from '../../ui/primitives.tsx'

const LAUNCH_BLOCKED_HINT = 'A run is active in this workspace — only one run executes at a time (single-writer lock). It frees up when the run finishes.'

export function PriorityDetailModal({ priority, linkedRun, launchBlocked, onClose, onLaunch, onSelectRun }: {
  priority: Priority
  linkedRun: Run | null
  launchBlocked: boolean
  onClose: () => void
  onLaunch: (priority: Priority) => void
  onSelectRun: (id: string) => void
}) {
  const activeLinkedRun = linkedRun ? isActiveRun(linkedRun.status) : false
  const launchDisabled = launchBlocked || activeLinkedRun
  const launchTitle = launchBlocked
    ? LAUNCH_BLOCKED_HINT
    : activeLinkedRun
      ? 'This priority already has an active run.'
      : undefined
  const status = linkedRun ? linkedRun.status : priority.status
  return (
    <Modal
      open
      onClose={onClose}
      title={priority.name}
      subtitle={priority.id}
      icon="list-numbers"
      width={680}
      footer={<Button variant="secondary" icon="play" disabled={launchDisabled} title={launchTitle} onClick={() => { onLaunch(priority); onClose() }}>Launch</Button>}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', padding: '2px 6px', border: '1px solid var(--cb-border)', borderRadius: 3, background: 'var(--cb-bg-soft)', fontSize: 10.5, color: 'var(--cb-text-secondary)' }}>
          <span style={{ fontFamily: 'var(--cb-font-mono)', color: 'var(--cb-text-muted)' }}>slug</span>{priority.id}
        </span>
        <StatusChip status={status} label={status === 'ready' ? 'Ready' : status} />
        {priority.labels.map((label) => (
          <span key={label} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', padding: '2px 6px', border: '1px solid var(--cb-border)', borderRadius: 3, background: 'var(--cb-bg-soft)', fontSize: 10.5, color: 'var(--cb-text-secondary)' }}>{label}</span>
        ))}
      </div>

      <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.65, color: 'var(--cb-text-secondary)', borderTop: '1px solid var(--cb-border)', paddingTop: 12 }}>
        {priority.summary || 'No summary available.'}
      </div>

      {linkedRun && (
        <button
          type="button"
          onClick={() => { onSelectRun(linkedRun.id); onClose() }}
          style={{ width: '100%', marginTop: 16, padding: '10px 12px', background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', cursor: 'pointer', fontFamily: 'var(--cb-font-body)', color: 'var(--cb-text)', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <StatusChip status={linkedRun.status} />
            <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)' }}>{runDisplayName(linkedRun)}</span>
            <Icon name="arrow-right" size={12} style={{ marginLeft: 'auto', color: 'var(--cb-text-muted)' }} />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--cb-text-secondary)', lineHeight: 1.5 }}>{linkedRun.title}</div>
          {linkedRun.lastEvent && <div style={{ marginTop: 5, fontSize: 11, color: linkedRun.status === 'blocked' ? 'var(--cb-highlight)' : 'var(--cb-text-muted)', lineHeight: 1.5, fontStyle: 'italic' }}>{linkedRun.lastEvent}</div>}
        </button>
      )}
    </Modal>
  )
}
