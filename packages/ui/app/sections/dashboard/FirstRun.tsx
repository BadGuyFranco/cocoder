// First-run / empty-workspace welcome — ported from design-ref/dashboard.jsx's first-run state. Shown
// on the Dashboard when the active workspace has no priorities and no runs yet: a centered Deco-framed
// card with the 4-step setup ladder, so a fresh workspace reads as "here's how to start", not blank.
import { Icon, Button, Card } from '../../ui/primitives.tsx'

const STEPS = [
  { n: 1, t: 'Install system dependencies', body: 'cmux — the terminal host CoCoder runs orchestration sessions inside (ADR-0002).', current: true },
  { n: 2, t: 'Register a CLI', body: 'Add at least one coding CLI (Claude Code, Codex, Cursor-agent) and authenticate it.' },
  { n: 3, t: 'Create your workspace', body: 'Name it. Describe it. This becomes the context Oz holds.' },
  { n: 4, t: 'Add root folders', body: 'One primary repo, plus any reference roots.' },
  { n: 5, t: 'Assign personas', body: 'Pick the team. Oz is set up by default.' },
]

export function FirstRun({ wsName, onBegin }: { wsName: string; onBegin: () => void }) {
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24, display: 'grid', placeItems: 'center' }}>
      <Card style={{ padding: 36, maxWidth: 540, textAlign: 'center', position: 'relative' }}>
        <div style={{ position: 'absolute', top: -1, left: -1, width: 16, height: 16, borderTop: '1px solid var(--cb-accent)', borderLeft: '1px solid var(--cb-accent)' }} />
        <div style={{ position: 'absolute', bottom: -1, right: -1, width: 16, height: 16, borderBottom: '1px solid var(--cb-accent)', borderRight: '1px solid var(--cb-accent)' }} />
        <Icon name="cube" size={40} style={{ color: 'var(--cb-accent)', marginBottom: 16 }} />
        <h1 style={{ margin: 0, fontFamily: 'var(--cb-font-display)', fontSize: 18, letterSpacing: 1.8, textTransform: 'uppercase', color: 'var(--cb-text)', fontWeight: 600 }}>Welcome to {wsName}</h1>
        <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 11, color: 'var(--cb-accent)', letterSpacing: 0.5, marginTop: 6, marginBottom: 24 }}>FIRST-RUN SETUP · 5 steps</div>
        <div style={{ textAlign: 'left', marginBottom: 24 }}>
          {STEPS.map((s) => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--cb-border)' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: s.current ? 'var(--cb-accent)' : 'var(--cb-bg-soft)', color: s.current ? 'var(--cb-text-on-accent)' : 'var(--cb-text-muted)', border: '1px solid var(--cb-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--cb-font-mono)', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{s.n}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--cb-text)', fontWeight: 500 }}>{s.t}</div>
                <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', marginTop: 3, lineHeight: 1.5 }}>{s.body}</div>
              </div>
              {s.current && <Icon name="arrow-right" size={14} style={{ color: 'var(--cb-accent)', marginTop: 6 }} />}
            </div>
          ))}
        </div>
        <Button variant="primary" icon="chat-circle-text" onClick={onBegin}>Ask Oz to set this up</Button>
      </Card>
    </div>
  )
}
