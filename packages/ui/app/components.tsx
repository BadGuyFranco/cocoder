// Shared presentational primitives. Never render raw JSON — these are the building blocks (chips,
// cards, empty/loading/error states) every surface composes from.
import type { ReactNode } from 'react'

export function StatusChip({ status }: { status: string }): JSX.Element {
  const cls = `chip chip-${status.replace(/[^a-z-]/gi, '').toLowerCase() || 'unknown'}`
  return <span className={cls}>{status}</span>
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <p className="empty">{children}</p>
}

export function Loading({ what = 'Loading' }: { what?: string }): JSX.Element {
  return <p className="loading">{what}…</p>
}

export function ErrorNote({ children }: { children: ReactNode }): JSX.Element {
  return <p className="error-note">{children}</p>
}

export function Pending({ label, note }: { label: string; note: string }): JSX.Element {
  return (
    <div className="pending">
      <span className="pending-tag">pending endpoint</span>
      <strong>{label}</strong>
      <p>{note}</p>
    </div>
  )
}
