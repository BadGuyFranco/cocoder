// Workspaces screen — list + detail editor. Each root has Name · Path · Role (Primary | Writable |
// Read-only) with the "exactly one Primary" rule enforced in the role dropdown + a warning when none.
// Ported from design-ref/screens.jsx.
import { useState } from 'react'
import { Icon, Button, ScreenHeader } from '../ui/primitives.tsx'
import { PendingBanner } from '../ui/PendingBanner.tsx'
import { phicon, type Root, type Workspace } from '../model.ts'

const ROLE_META: Record<string, { label: string; color: string; bg: string; border: string; body: string }> = {
  primary: { label: 'Primary', color: 'var(--cb-accent)', bg: 'var(--cb-accent-muted)', border: 'var(--cb-accent-15)', body: 'Main working repo. CoCoder picks up here and writes freely.' },
  writable: { label: 'Writable', color: 'var(--cb-text)', bg: 'var(--cb-bg-soft)', border: 'var(--cb-border)', body: 'Orchestrator may write, but only with explicit human permission.' },
  readonly: { label: 'Read-only', color: 'var(--cb-text-muted)', bg: 'var(--cb-bg-soft)', border: 'var(--cb-border)', body: 'Reference repo. Never written to.' },
}

function RootRow({ root, hasPrimary, onChange, onDelete }: { root: Root; hasPrimary: boolean; onChange: (r: Root) => void; onDelete: () => void }) {
  const meta = ROLE_META[root.role]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 200px 32px', gap: 12, alignItems: 'center', padding: '12px 14px', background: 'var(--cb-surface-glass)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Icon name={root.role === 'primary' ? 'folder-star' : root.role === 'writable' ? 'folder-open' : 'folder-lock'} size={16} style={{ color: meta.color }} />
        <input value={root.name} onChange={(e) => onChange({ ...root, name: e.target.value })} className="oz-input" style={{ padding: '5px 8px', fontSize: 12.5, background: 'transparent', border: 'none' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--cb-font-mono)', fontSize: 11.5, color: 'var(--cb-text-secondary)', minWidth: 0 }}>
        <Icon name="folder" size={13} style={{ color: 'var(--cb-text-muted)' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{root.path}</span>
        <button className="oz-iconbtn" style={{ width: 24, height: 24, flexShrink: 0 }} title="Pick folder"><Icon name="folder-notch-open" size={11} /></button>
      </div>
      <select className="oz-select" value={root.role} onChange={(e) => onChange({ ...root, role: e.target.value as Root['role'] })} style={{ fontSize: 12 }}>
        <option value="primary" disabled={hasPrimary && root.role !== 'primary'}>Primary{hasPrimary && root.role !== 'primary' ? ' (taken)' : ''}</option>
        <option value="writable">Writable</option>
        <option value="readonly">Read-only</option>
      </select>
      <button className="oz-iconbtn" onClick={onDelete} title="Remove root" style={{ color: 'var(--cb-text-muted)' }}><Icon name="trash" size={13} /></button>
    </div>
  )
}

export function WorkspacesScreen({ workspaces, activeId, onChange, onSetActive, onCreate, onDelete, onGotoDashboard, live = false }: {
  workspaces: Workspace[]; activeId: string; onChange: (ws: Workspace) => void; onSetActive: (id: string) => void; onCreate: () => void; onDelete: (id: string) => void; onGotoDashboard: () => void; live?: boolean
}) {
  const [editId, setEditId] = useState(activeId)
  const editing = workspaces.find((w) => w.id === editId)
  const hasPrimary = !!editing?.roots.some((r) => r.role === 'primary')

  const updateRoot = (id: string, next: Root) => editing && onChange({ ...editing, roots: editing.roots.map((r: Root) => (r.id === id ? next : r)) })
  const addRoot = () => {
    if (!editing) return
    const newId = 'r-' + Math.random().toString(36).slice(2, 8)
    onChange({ ...editing, roots: [...editing.roots, { id: newId, name: 'new-root', path: '~/dev/', role: hasPrimary ? 'writable' : 'primary' }] })
  }
  const removeRoot = (id: string) => editing && onChange({ ...editing, roots: editing.roots.filter((r: Root) => r.id !== id) })

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <ScreenHeader title="Workspaces" subtitle="Each workspace bundles one or more root folders and runs its own Oz, priorities, and runs. Switch between them from the dashboard." actions={<Button variant="primary" icon="plus" onClick={onCreate}>New workspace</Button>} />
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, padding: '0 28px 24px', overflow: 'hidden', minHeight: 0 }}>
        <div className="oz-panel" style={{ minHeight: 0 }}>
          <div className="oz-panel-header"><div className="oz-panel-title">All workspaces</div><span className="oz-panel-count">{workspaces.length}</span></div>
          <div className="oz-panel-body" style={{ padding: 8 }}>
            {workspaces.map((w) => (
              <div key={w.id} onClick={() => setEditId(w.id)} style={{ padding: '10px 12px', background: editId === w.id ? 'var(--cb-accent-muted)' : 'transparent', border: editId === w.id ? '1px solid var(--cb-accent-15)' : '1px solid transparent', borderRadius: 'var(--cb-radius-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <Icon name={phicon(w.icon)} size={16} style={{ color: editId === w.id ? 'var(--cb-accent)' : 'var(--cb-text-secondary)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: editId === w.id ? 500 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</div>
                  <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{w.roots.length} root{w.roots.length === 1 ? '' : 's'}</div>
                </div>
                {w.id === activeId && <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-accent)', letterSpacing: 0.5 }}>● ACTIVE</span>}
              </div>
            ))}
          </div>
        </div>

        {editing && (
          <div className="oz-panel" style={{ minHeight: 0 }}>
            <div className="oz-panel-header">
              <Icon name={phicon(editing.icon)} size={16} style={{ color: 'var(--cb-accent)' }} />
              <div className="oz-panel-title" style={{ color: 'var(--cb-accent)' }}>{editing.name}</div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {editing.id !== activeId && <Button variant="secondary" size="sm" icon="arrow-right" onClick={() => { onSetActive(editing.id); onGotoDashboard() }}>Open in Dashboard</Button>}
                <Button variant="ghost" size="sm" icon="trash" onClick={() => onDelete(editing.id)}>Delete</Button>
              </div>
            </div>
            <div className="oz-panel-body">
              <PendingBanner live={live}>The daemon’s <code>/workspaces</code> is thin (id · name · path); roots, roles, and descriptions aren’t served and workspace create/edit/delete isn’t wired (<code>POST/PUT/DELETE /workspaces</code> + a roots/role model owed). The single primary root shown is derived from the path.</PendingBanner>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                <div><label className="oz-field-label">Name</label><input className="oz-input" value={editing.name} onChange={(e) => onChange({ ...editing, name: e.target.value })} /></div>
                <div><label className="oz-field-label">Created</label><div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12, color: 'var(--cb-text-muted)', padding: '9px 0' }}>{editing.created}</div></div>
              </div>
              <div style={{ marginBottom: 28 }}>
                <label className="oz-field-label">Description</label>
                <textarea className="oz-textarea" value={editing.description} onChange={(e) => onChange({ ...editing, description: e.target.value })} />
                <div className="oz-field-help">Oz reads this on every conversation. Keep it short and concrete — what's this workspace for?</div>
              </div>
              <div className="oz-section-marker lhs">Root folders · {editing.roots.length}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                {Object.entries(ROLE_META).map(([k, v]) => (
                  <div key={k} style={{ padding: '10px 12px', background: v.bg, border: `1px solid ${v.border}`, borderRadius: 'var(--cb-radius-md)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                      <Icon name={k === 'primary' ? 'folder-star' : k === 'writable' ? 'folder-open' : 'folder-lock'} size={13} style={{ color: v.color }} />
                      <span style={{ fontFamily: 'var(--cb-font-display)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: v.color, fontWeight: 600 }}>{v.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', lineHeight: 1.5 }}>{v.body}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 200px 32px', gap: 12, padding: '0 14px 8px', fontFamily: 'var(--cb-font-display)', fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text-muted)' }}>
                <span>Name</span><span>Path</span><span>Role</span><span />
              </div>
              {editing.roots.map((r) => <RootRow key={r.id} root={r} hasPrimary={hasPrimary} onChange={(next) => updateRoot(r.id, next)} onDelete={() => removeRoot(r.id)} />)}
              <button onClick={addRoot} style={{ width: '100%', padding: 12, background: 'transparent', border: '1px dashed var(--cb-border-strong)', borderRadius: 'var(--cb-radius-md)', cursor: 'pointer', color: 'var(--cb-text-secondary)', fontSize: 12, fontFamily: 'var(--cb-font-body)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Icon name="plus" size={13} /> Add root folder
              </button>
              {!hasPrimary && editing.roots.length > 0 && (
                <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--cb-highlight-muted)', border: '1px solid rgba(212,118,110,0.20)', borderRadius: 'var(--cb-radius-md)', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--cb-highlight)', fontSize: 12 }}>
                  <Icon name="warning-circle" size={14} />This workspace has no Primary root. Promote one before launching a run.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
