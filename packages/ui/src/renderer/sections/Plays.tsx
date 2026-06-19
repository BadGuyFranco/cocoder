// Skills (Plays) screen — a top-level, read-only catalog of the effective Play set (base packages/personas/base/plays
// + repo cocoder/plays/deltas, merged by GET /workspaces/:id/plays). Each Play shows its id, label, kind
// (headless/interactive), and write-scope (its commit-gate allow-list, ADR-0007/0023). Binding a Play to a
// persona happens on the Personas screen; this is the catalog you browse. ScopeChips lives here because both
// screens render it.
import { Icon, Card, ScreenHeader } from '../ui/primitives.tsx'
import type { Play } from '../model.ts'

export function ScopeChips({ writeScope }: { writeScope: readonly string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, minWidth: 0 }}>
      {writeScope.length === 0 ? (
        <span style={{ fontSize: 11.5, color: 'var(--cb-text-muted)' }}>read-only</span>
      ) : writeScope.map((scope) => (
        <span key={scope} style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)', padding: '2px 5px', background: 'var(--cb-surface-glass)', border: '1px solid var(--cb-border)', borderRadius: 3 }}>{scope}</span>
      ))}
    </div>
  )
}

export function PlaysCatalog({ plays }: { plays: Play[] }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--cb-font-display)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text-muted)', marginBottom: 10 }}>
          <Icon name="tree-structure" size={13} />Skills (Plays) catalog · {plays.length}
        </div>
        {plays.length === 0 ? (
          <div style={{ padding: '10px 14px', background: 'var(--cb-bg-soft)', border: '1px dashed var(--cb-border)', borderRadius: 'var(--cb-radius-md)', fontSize: 11.5, color: 'var(--cb-text-muted)', textAlign: 'center' }}>No Skills (Plays) available for this workspace.</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {plays.map((play) => (
              <div key={play.id} data-testid="play-row" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.5fr 110px minmax(160px, 2fr)', gap: 10, alignItems: 'center', padding: '10px 12px', background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)' }}>
                <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12, color: 'var(--cb-text)' }}>{play.id}</div>
                <div style={{ fontSize: 12, color: 'var(--cb-text-secondary)', minWidth: 0 }}>{play.label}</div>
                <div style={{ justifySelf: 'start', fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, padding: '2px 6px', background: 'var(--cb-surface)', color: 'var(--cb-text-muted)', border: '1px solid var(--cb-border)', borderRadius: 2, textTransform: 'uppercase' }}>{play.kind}</div>
                <ScopeChips writeScope={play.writeScope} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

export function PlaysScreen({ plays }: { plays: Play[] }) {
  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <ScreenHeader title="Skills (Plays)" subtitle="The shared procedures the team can run. A Play is a standalone capability; binding it to a persona (on the Personas screen) grants that persona permission to run it. Each Play shows what it may write and whether it runs headless or interactively." />
      <div style={{ padding: '0 28px 24px', overflowY: 'auto', minHeight: 0 }}>
        <PlaysCatalog plays={plays} />
      </div>
    </div>
  )
}
