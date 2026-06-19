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

// A calm, informational note (NOT a red "pending endpoint" alarm). For surfaces that ARE wired but carry
// a small, honest caveat — e.g. settings that apply per-session, or a run-mode that's preview-only for
// some personas. Renders nothing in fixtures/seed mode so the design demo + launch smoke are unchanged.
export function SessionNote({ live, children }: { live: boolean; children: React.ReactNode }) {
  if (!live) return null
  return (
    <div role="note" style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px', marginBottom: 16, background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)' }}>
      <Icon name="info" size={14} style={{ color: 'var(--cb-text-muted)', marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 11.5, color: 'var(--cb-text-muted)', lineHeight: 1.55 }}>{children}</div>
    </div>
  )
}
