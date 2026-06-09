// Shared Fusion primitives — ported from design-ref/components.jsx (Icon, StatusChip, Button, Card,
// Modal, ScreenHeader). Typed; inline styles kept verbatim so the visual language matches the V1
// prototype exactly. Icons are Phosphor THIN (the design's only weight).
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const Icon = ({ name, size, style }: { name: string; size?: number; style?: CSSProperties }) => (
  <i className={`ph-thin ph-${name}`} style={{ fontSize: size || 16, lineHeight: 1, ...(style || {}) }} />
)

// ── Status chips ── (run + cli + dependency statuses all funnel through here)
const STATUS_LABEL: Record<string, string> = {
  running: 'Running', blocked: 'Needs decision', 'not-landed': 'Not landed', complete: 'Complete', failed: 'Failed',
  stopped: 'Stopped', queued: 'Queued', ready: 'Ready', 'in-progress': 'In progress',
  ok: 'Ready', 'auth-failed': 'Auth failed', 'not-installed': 'Not installed',
}
const STATUS_ICON: Record<string, string | null> = {
  running: null, blocked: 'warning-circle', 'not-landed': 'git-branch', complete: 'check-circle', failed: 'x-circle',
  stopped: 'stop-circle', queued: 'circle-dashed', ready: 'circle', 'in-progress': null,
  ok: 'check-circle', 'auth-failed': 'warning-circle', 'not-installed': 'minus-circle',
}
const STATUS_VARIANT: Record<string, string> = {
  running: 'running', 'in-progress': 'running', blocked: 'blocked', 'not-landed': 'blocked', complete: 'complete',
  ok: 'complete', failed: 'failed', 'auth-failed': 'failed', stopped: 'stopped',
  'not-installed': 'stopped', queued: 'queued', ready: 'queued',
}
export { STATUS_LABEL, STATUS_VARIANT }

export const StatusChip = ({ status, label }: { status: string; label?: string }) => {
  const variant = STATUS_VARIANT[status] || 'queued'
  const iconName = STATUS_ICON[status]
  return (
    <span className={`oz-chip oz-chip-${variant}`}>
      {variant === 'running' ? <span className="dot" /> : iconName && <Icon name={iconName} size={11} />}
      {label || STATUS_LABEL[status] || status}
    </span>
  )
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'
export const Button = ({
  variant = 'secondary', size, icon, children, ...rest
}: { variant?: BtnVariant; size?: 'sm'; icon?: string; children?: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button className={`oz-btn oz-btn-${variant} ${size === 'sm' ? 'oz-btn-sm' : ''}`} {...rest}>
    {icon && <Icon name={icon} />}
    {children}
  </button>
)

export const Card = ({ children, style, onClick, active }: { children: ReactNode; style?: CSSProperties; onClick?: () => void; active?: boolean }) => (
  <div
    onClick={onClick}
    style={{
      background: 'var(--cb-surface-glass)',
      backdropFilter: 'blur(var(--cb-glass-blur))',
      WebkitBackdropFilter: 'blur(var(--cb-glass-blur))',
      border: `1px solid ${active ? 'var(--cb-accent-30)' : 'var(--cb-border)'}`,
      borderRadius: 'var(--cb-radius-lg)',
      boxShadow: 'inset 0 1px 0 0 var(--cb-glass-highlight)',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'all var(--cb-duration-fast) var(--cb-ease-default)',
      ...style,
    }}
  >
    {children}
  </div>
)

export const ScreenHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '20px 28px 16px', gap: 16 }}>
    <div>
      <h1 style={{ margin: 0, fontFamily: 'var(--cb-font-display)', fontSize: 22, letterSpacing: 1.8, textTransform: 'uppercase', color: 'var(--cb-accent)', fontWeight: 600 }}>
        {title}
      </h1>
      {subtitle && <div style={{ fontSize: 12.5, color: 'var(--cb-text-muted)', marginTop: 4, lineHeight: 1.5, maxWidth: 640 }}>{subtitle}</div>}
    </div>
    {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
  </div>
)

export const Modal = ({
  open, onClose, title, subtitle, icon, footer, children, width = 640,
}: { open: boolean; onClose: () => void; title: string; subtitle?: string; icon?: string; footer?: ReactNode; children: ReactNode; width?: number }) => {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  // Portal to <body>: the Fusion glass panels use backdrop-filter, which creates stacking contexts —
  // a modal rendered inside .oz-app would paint BEHIND them despite z-index. Escaping to body fixes it.
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(6, 4, 3, 0.82)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'ozFadeIn 200ms ease-out' }}>
      {/* SOLID, fully-opaque card (NOT a glass surface — those let the blurred dashboard show through and
          read as transparent). Explicit opaque hex + a clearly-lighter tone than the espresso bg. */}
      <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: '100%', maxHeight: 'calc(100vh - 48px)', background: 'var(--cb-surface-raised)', border: '1px solid var(--cb-border-strong)', borderRadius: 'var(--cb-radius-xl)', boxShadow: '0 24px 70px rgba(0,0,0,0.7), inset 0 1px 0 0 var(--cb-glass-highlight)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', animation: 'ozSlideIn 240ms ease-out' }}>
        <div style={{ position: 'absolute', top: -1, left: -1, width: 16, height: 16, borderTop: '1px solid var(--cb-accent)', borderLeft: '1px solid var(--cb-accent)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -1, right: -1, width: 16, height: 16, borderBottom: '1px solid var(--cb-accent)', borderRight: '1px solid var(--cb-accent)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '20px 24px 16px', borderBottom: '1px solid var(--cb-border)' }}>
          {icon && (
            <div style={{ width: 36, height: 36, background: 'var(--cb-accent-muted)', border: '1px solid var(--cb-accent-15)', borderRadius: 'var(--cb-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cb-accent)', flexShrink: 0 }}>
              <Icon name={icon} size={18} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--cb-font-display)', fontSize: 15, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text)', fontWeight: 600 }}>{title}</h2>
            {subtitle && <div style={{ fontSize: 12, color: 'var(--cb-text-muted)', marginTop: 4, lineHeight: 1.5 }}>{subtitle}</div>}
          </div>
          <button className="oz-iconbtn" onClick={onClose} title="Close (Esc)"><Icon name="x" size={14} /></button>
        </div>
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, minHeight: 0 }}>{children}</div>
        {footer && <div style={{ padding: '14px 24px', borderTop: '1px solid var(--cb-border)', background: 'var(--cb-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
