// "Pending endpoint" banner. In LIVE mode some surfaces still render seed/demo content because the
// daemon endpoint that would back them doesn't exist yet (see full-oz-dashboard.md "Endpoints owed").
// Rather than pass demo data off as real, those surfaces show this honest marker. In fixtures/seed mode
// (`live=false`) it renders nothing, so the design demo + launch smoke are unchanged.
import { Icon } from './primitives.tsx'

export function PendingBanner({ live, children }: { live: boolean; children: React.ReactNode }) {
  if (!live) return null
  return (
    <div role="note" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 14px', marginBottom: 16, background: 'var(--cb-highlight-muted)', border: '1px solid rgba(212,118,110,0.25)', borderRadius: 'var(--cb-radius-md)' }}>
      <Icon name="warning-circle" size={16} style={{ color: 'var(--cb-highlight)', marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 11.5, color: 'var(--cb-text-secondary)', lineHeight: 1.55 }}>
        <span style={{ color: 'var(--cb-highlight)', fontWeight: 500 }}>Pending daemon endpoint. </span>
        {children}
      </div>
    </div>
  )
}
