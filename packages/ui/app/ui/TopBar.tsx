// Top bar. On the Dashboard it shows browser-style WORKSPACE TABS (dev-note 2): multiple workspaces
// loaded at once, each its own Oz; a pulsing dot marks a workspace with live/blocked runs; the +
// loads another or creates one. Off-dashboard it shows the screen title. Plus search + theme toggle.
import { useEffect, useRef, useState } from 'react'
import { Icon } from './primitives.tsx'
import { phicon, type Run, type Workspace } from '../model.ts'

function WorkspaceTab({ ws, isActive, runs, onSelect, onClose, canClose }: { ws: Workspace; isActive: boolean; runs: Run[]; onSelect: (id: string) => void; onClose: (id: string) => void; canClose: boolean }) {
  const activeRunCount = (runs || []).filter((r) => r.status === 'running' || r.status === 'blocked').length
  return (
    <div onClick={() => onSelect(ws.id)} className="oz-ws-tab" data-active={isActive ? 'true' : 'false'}>
      <Icon name={phicon(ws.icon)} size={13} style={{ color: isActive ? 'var(--cb-accent)' : 'var(--cb-text-muted)' }} />
      <span style={{ fontSize: 12.5, color: isActive ? 'var(--cb-text)' : 'var(--cb-text-secondary)', fontWeight: isActive ? 500 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{ws.name}</span>
      {activeRunCount > 0 && <span title={`${activeRunCount} active`} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--cb-accent)', animation: 'ozPulse 1.8s infinite', flexShrink: 0 }} />}
      {canClose && <button className="oz-ws-tab-close" onClick={(e) => { e.stopPropagation(); onClose(ws.id) }} title="Unload workspace"><Icon name="x" size={10} /></button>}
    </div>
  )
}

function WorkspaceTabs({ workspaces, loadedIds, activeId, runsMap, onSelect, onClose, onLoad, onCreate }: {
  workspaces: Workspace[]; loadedIds: string[]; activeId: string; runsMap: Record<string, Run[]>
  onSelect: (id: string) => void; onClose: (id: string) => void; onLoad: (id: string) => void; onCreate: () => void
}) {
  const [adderOpen, setAdderOpen] = useState(false)
  const adderRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!adderOpen) return
    const handler = (e: MouseEvent) => { if (adderRef.current && !adderRef.current.contains(e.target as Node)) setAdderOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [adderOpen])
  const loaded = loadedIds.map((id) => workspaces.find((w) => w.id === id)).filter(Boolean) as Workspace[]
  const unloaded = workspaces.filter((w) => !loadedIds.includes(w.id))

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: '1 1 auto', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto', overflowY: 'hidden', minWidth: 0 }}>
        {loaded.map((w) => <WorkspaceTab key={w.id} ws={w} isActive={w.id === activeId} runs={(runsMap && runsMap[w.id]) || []} onSelect={onSelect} onClose={onClose} canClose={loadedIds.length > 1} />)}
      </div>
      <div ref={adderRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button className="oz-ws-tab-add" onClick={() => setAdderOpen((o) => !o)} title="Load another workspace"><Icon name="plus" size={13} /></button>
        {adderOpen && (
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 320, background: 'var(--cb-surface-raised)', border: '1px solid var(--cb-border-strong)', borderRadius: 'var(--cb-radius-lg)', boxShadow: '0 8px 24px rgba(0,0,0,0.55), inset 0 1px 0 0 var(--cb-glass-highlight)', padding: 6, zIndex: 50 }}>
            <div style={{ padding: '6px 10px 8px', fontFamily: 'var(--cb-font-display)', fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text-muted)' }}>Load workspace</div>
            {unloaded.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--cb-text-muted)' }}>All workspaces already loaded.</div>
            ) : unloaded.map((w) => (
              <div key={w.id} onClick={() => { onLoad(w.id); setAdderOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--cb-radius-md)', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-hover)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <div className="oz-wspicker-icon"><Icon name={phicon(w.icon)} size={14} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--cb-text)', fontWeight: 500 }}>{w.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.description || '—'}</div>
                </div>
                <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{w.roots.length} root{w.roots.length === 1 ? '' : 's'}</span>
              </div>
            ))}
            <div style={{ height: 1, background: 'var(--cb-border)', margin: '6px 4px' }} />
            <div onClick={() => { onCreate(); setAdderOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', cursor: 'pointer', color: 'var(--cb-accent)', fontSize: 12, borderRadius: 'var(--cb-radius-md)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cb-hover)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <Icon name="plus" size={13} /><span>New workspace…</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function TopBar({ title, route, workspaces, activeId, loadedIds, runsMap, onSelectWs, onCloseWs, onLoadWs, onCreateWs, theme, setTheme }: {
  title: string; route: string; workspaces: Workspace[]; activeId: string; loadedIds: string[]; runsMap: Record<string, Run[]>
  onSelectWs: (id: string) => void; onCloseWs: (id: string) => void; onLoadWs: (id: string) => void; onCreateWs: () => void
  theme: 'dark' | 'light'; setTheme: (fn: (t: 'dark' | 'light') => 'dark' | 'light') => void
}) {
  return (
    <header className="oz-topbar">
      {route === 'dashboard' ? (
        <WorkspaceTabs workspaces={workspaces} loadedIds={loadedIds} activeId={activeId} runsMap={runsMap} onSelect={onSelectWs} onClose={onCloseWs} onLoad={onLoadWs} onCreate={onCreateWs} />
      ) : (
        <div className="oz-topbar-title">{title}</div>
      )}
      {route !== 'dashboard' && <div className="oz-topbar-spacer" />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', color: 'var(--cb-text-muted)', fontSize: 12, cursor: 'pointer', minWidth: 220 }}>
        <Icon name="magnifying-glass" size={13} /><span>Search runs, priorities…</span><span className="oz-kbd" style={{ marginLeft: 'auto' }}>⌘K</span>
      </div>
      <button className="oz-iconbtn" title="Toggle theme" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} /></button>
      <button className="oz-iconbtn" title="Notifications"><Icon name="bell" size={15} /></button>
    </header>
  )
}
