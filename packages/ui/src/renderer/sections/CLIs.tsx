// CLIs screen — status summary + per-CLI rows with a Test button (returns Success or the exact error),
// expandable model list, and inline error detail with re-auth/install actions. Ported from design-ref.
import { useState } from 'react'
import { Icon, StatusChip, Button, Card, ScreenHeader } from '../ui/primitives.tsx'
import type { Cli } from '../model.ts'

function CliRow({ cli, onTest, testing, expanded, onToggle }: { cli: Cli; onTest: (id: string) => Promise<void>; testing: boolean; expanded: boolean; onToggle: (id: string) => void }) {
  // Status-colored left accent + a solid raised surface + stronger border, so cards read as distinct
  // panels (the glassy default was too low-contrast against the espresso background).
  const accent = !cli.tested ? 'var(--cb-text-muted)' : cli.status === 'ok' ? 'var(--cb-success)' : cli.status === 'auth-failed' || cli.status === 'model-failed' ? 'var(--cb-highlight)' : 'var(--cb-text-muted)'
  const iconBg = !cli.tested ? 'var(--cb-bg-soft)' : cli.status === 'ok' ? 'var(--cb-accent-muted)' : cli.status === 'not-installed' ? 'var(--cb-bg-soft)' : 'var(--cb-highlight-muted)'
  const iconBorder = !cli.tested ? 'var(--cb-border)' : cli.status === 'ok' ? 'var(--cb-accent-15)' : 'var(--cb-border)'
  const iconColor = !cli.tested ? 'var(--cb-text-muted)' : cli.status === 'ok' ? 'var(--cb-accent)' : 'var(--cb-text-muted)'
  const readiness = cli.runReadiness
  return (
    <Card style={{ marginBottom: 12, position: 'relative', overflow: 'hidden', background: 'var(--cb-surface-raised)', borderColor: 'var(--cb-border-strong)', borderLeft: `3px solid ${accent}` }}>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 40, height: 40, background: iconBg, border: `1px solid ${iconBorder}`, borderRadius: 'var(--cb-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: iconColor, flexShrink: 0 }}>
          <Icon name="terminal-window" size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 14, color: 'var(--cb-text)', fontWeight: 500 }}>{cli.name}</span>
            {cli.tested ? <StatusChip status={cli.status} /> : <StatusChip status="queued" label="Not tested" />}
            {cli.version !== '—' && <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)' }}>v{cli.version}</span>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)' }}>{cli.vendor} · last tested {cli.lastTested}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" size="sm" icon="play" onClick={() => void onTest(cli.id)} disabled={testing}>{testing ? 'Testing…' : 'Test'}</Button>
          <Button variant="ghost" size="sm" icon={expanded ? 'caret-up' : 'caret-down'} onClick={() => onToggle(cli.id)}>{expanded ? 'Hide' : 'Details'}</Button>
        </div>
      </div>
      {cli.errorDetail && cli.status !== 'ok' && (
        <div style={{ padding: '10px 16px', background: 'var(--cb-highlight-muted)', borderTop: '1px solid rgba(212,118,110,0.15)', fontSize: 12, color: 'var(--cb-highlight)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="warning-circle" size={14} />
          <span style={{ flex: 1 }}>{cli.errorDetail}</span>
          {cli.status === 'auth-failed' && <Button variant="destructive" size="sm" icon="key">Re-authenticate</Button>}
          {cli.status === 'not-installed' && <Button variant="destructive" size="sm" icon="download-simple">Install instructions</Button>}
        </div>
      )}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--cb-border)', padding: '14px 16px', background: 'var(--cb-bg-soft)' }}>
          <div style={{ fontFamily: 'var(--cb-font-display)', fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text-muted)', marginBottom: 8 }}>
            {cli.canEnumerate ? `Available models · ${cli.models.length}` : 'Models · CLI does not enumerate models'}
          </div>
          {!cli.canEnumerate && (
            <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
              Default + free-text. {cli.modelsDetail}
            </div>
          )}
          {cli.models.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {cli.models.map((m) => <span key={m} style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 11, padding: '4px 10px', background: m === 'Default' ? 'var(--cb-accent-muted)' : 'var(--cb-bg)', color: m === 'Default' ? 'var(--cb-accent)' : 'var(--cb-text-secondary)', border: `1px solid ${m === 'Default' ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`, borderRadius: 3 }}>{m}</span>)}
            </div>
          ) : <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)' }}>None — install the CLI first.</div>}
          {readiness && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--cb-border)' }}>
              <div style={{ fontFamily: 'var(--cb-font-display)', fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text-muted)', marginBottom: 8 }}>Run readiness</div>
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '7px 12px', fontSize: 11.5, color: 'var(--cb-text-secondary)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--cb-text-muted)' }}>Mechanism</span><span>{readiness.mechanism}</span>
                <span style={{ color: 'var(--cb-text-muted)' }}>Flags</span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {readiness.flags.length ? readiness.flags.map((f) => <code key={f} style={{ fontSize: 11, color: 'var(--cb-text)', background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', borderRadius: 3, padding: '2px 6px' }}>{f}</code>) : <span>No flags</span>}
                </span>
                <span style={{ color: 'var(--cb-text-muted)' }}>Detail</span><span>{readiness.detail}</span>
              </div>
              {readiness.managesUserConfig && <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--cb-accent)' }}><Icon name="check-circle" size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Config managed by CoCoder</div>}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export function CLIsScreen({ clis, onTest, onAdd }: { clis: Cli[]; onTest: (id: string) => Promise<void>; onAdd: () => void }) {
  const [testingId, setTestingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const handleTest = async (id: string) => {
    setTestingId(id)
    try { await onTest(id) } finally { setTestingId(null) }
  }
  const summary = [
    { label: 'Ready', count: clis.filter((c) => c.tested && c.status === 'ok').length, color: 'var(--cb-success)', icon: 'check-circle' },
    { label: 'Config issues', count: clis.filter((c) => c.tested && (c.status === 'auth-failed' || c.status === 'model-failed')).length, color: 'var(--cb-highlight)', icon: 'warning-circle' },
    { label: 'Not installed', count: clis.filter((c) => c.tested && c.status === 'not-installed').length, color: 'var(--cb-text-muted)', icon: 'minus-circle' },
    { label: 'Not tested', count: clis.filter((c) => !c.tested).length, color: 'var(--cb-text-muted)', icon: 'circle-dashed' },
  ]
  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <ScreenHeader title="CLIs" subtitle="The coding-agent command-line tools personas run on. Each must be installed on this machine and authenticated." actions={<Button variant="primary" icon="plus" onClick={onAdd}>Register CLI</Button>} />
      <div style={{ padding: '0 28px 24px', overflowY: 'auto', minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {summary.map((s) => (
            <Card key={s.label} style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Icon name={s.icon} size={22} style={{ color: s.color }} />
              <div>
                <div style={{ fontFamily: 'var(--cb-font-display)', fontSize: 22, color: s.color, fontWeight: 600, lineHeight: 1 }}>{s.count}</div>
                <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', marginTop: 4, letterSpacing: 0.3 }}>{s.label}</div>
              </div>
            </Card>
          ))}
        </div>
        {clis.map((c) => <CliRow key={c.id} cli={c} onTest={handleTest} testing={testingId === c.id} expanded={expandedId === c.id} onToggle={(id) => setExpandedId((e) => (e === id ? null : id))} />)}
      </div>
    </div>
  )
}
