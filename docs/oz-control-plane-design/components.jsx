// Shared primitives + app shell (Sidebar, TopBar, WorkspacePicker)

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ───────── Icon wrapper (Phosphor thin) ─────────
const Icon = ({ name, size, style }) => (
  <i className={`ph-thin ph-${name}`} style={{ fontSize: size || 16, lineHeight: 1, ...(style || {}) }}></i>
);

// ───────── Status chips ─────────
const STATUS_LABEL = {
  running: "Running",
  blocked: "Needs decision",
  complete: "Complete",
  failed: "Failed",
  stopped: "Stopped",
  queued: "Queued",
  ready: "Ready",
  "in-progress": "In progress",
  ok: "Ready",
  "auth-failed": "Auth failed",
  "not-installed": "Not installed",
};
const STATUS_ICON = {
  running: null, // uses pulsing dot
  blocked: "warning-circle",
  complete: "check-circle",
  failed: "x-circle",
  stopped: "stop-circle",
  queued: "circle-dashed",
  ready: "circle",
  "in-progress": null,
  ok: "check-circle",
  "auth-failed": "warning-circle",
  "not-installed": "minus-circle",
};
const STATUS_VARIANT = {
  running: "running", "in-progress": "running",
  blocked: "blocked",
  complete: "complete", ok: "complete",
  failed: "failed", "auth-failed": "failed",
  stopped: "stopped", "not-installed": "stopped",
  queued: "queued", ready: "queued",
};

const StatusChip = ({ status, label }) => {
  const variant = STATUS_VARIANT[status] || "queued";
  const iconName = STATUS_ICON[status];
  return (
    <span className={`oz-chip oz-chip-${variant}`}>
      {variant === "running" ? <span className="dot"></span> : iconName && <Icon name={iconName} size={11} />}
      {label || STATUS_LABEL[status] || status}
    </span>
  );
};

// ───────── Button ─────────
const Button = ({ variant = "secondary", size, icon, children, ...rest }) => (
  <button className={`oz-btn oz-btn-${variant} ${size === "sm" ? "oz-btn-sm" : ""}`} {...rest}>
    {icon && <Icon name={icon} />}
    {children}
  </button>
);

// ───────── Sidebar ─────────
const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "squares-four" },
  { id: "workspaces", label: "Workspaces", icon: "folders" },
  { id: "clis", label: "CLIs", icon: "terminal-window" },
  { id: "personas", label: "Personas", icon: "users-three" },
  { id: "settings", label: "Settings", icon: "gear-six" },
];

const Sidebar = ({ route, setRoute, runs, priorities, user }) => {
  const activeRuns = runs.filter(r => r.status === "running" || r.status === "blocked").length;
  return (
    <aside className="oz-sidebar">
      <DevNote n={1} anchor="top-right" />
      <div className="oz-brand">
        <span className="oz-brand-mark">OZ</span>
        <div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5 }}>
            control plane
          </div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-secondary)', letterSpacing: 0.3 }}>
            cocoder · v0.7.2
          </div>
        </div>
      </div>

      <nav className="oz-nav">
        {NAV_ITEMS.map(item => {
          let badge = null;
          if (item.id === "dashboard" && activeRuns > 0) badge = activeRuns;
          return (
            <div
              key={item.id}
              className={`oz-nav-item ${route === item.id ? "active" : ""}`}
              onClick={() => setRoute(item.id)}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {badge && <span className="oz-nav-badge">{badge}</span>}
            </div>
          );
        })}
      </nav>

      <div className="oz-sidebar-footer">
        <div className="oz-avatar">{user.initials}</div>
        <div style={{ minWidth: 0 }}>
          <div className="oz-user-name">{user.name}</div>
          <div className="oz-user-meta">{user.role}</div>
        </div>
      </div>
    </aside>
  );
};

// ───────── Workspace tabs (top bar — loaded workspaces, like browser tabs) ─────────
const WorkspaceTab = ({ ws, isActive, runs, onSelect, onClose, canClose }) => {
  const activeRunCount = (runs || []).filter(r => r.status === "running" || r.status === "blocked").length;
  return (
    <div
      onClick={() => onSelect(ws.id)}
      className="oz-ws-tab"
      data-active={isActive ? "true" : "false"}
    >
      <Icon name={ws.icon.replace("ph-thin ph-", "")} size={13}
            style={{ color: isActive ? 'var(--cb-accent)' : 'var(--cb-text-muted)' }} />
      <span style={{
        fontSize: 12.5,
        color: isActive ? 'var(--cb-text)' : 'var(--cb-text-secondary)',
        fontWeight: isActive ? 500 : 400,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: 140,
      }}>{ws.name}</span>
      {activeRunCount > 0 && (
        <span title={`${activeRunCount} active run${activeRunCount === 1 ? '' : 's'}`} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--cb-accent)',
          animation: 'ozPulse 1.8s infinite',
          flexShrink: 0,
        }}></span>
      )}
      {canClose && (
        <button
          className="oz-ws-tab-close"
          onClick={(e) => { e.stopPropagation(); onClose(ws.id); }}
          title="Unload workspace"
        ><Icon name="x" size={10} /></button>
      )}
    </div>
  );
};

const WorkspaceTabs = ({ workspaces, loadedIds, activeId, runsMap, onSelect, onClose, onLoad, onCreate }) => {
  const [adderOpen, setAdderOpen] = useState(false);
  const adderRef = useRef(null);

  useEffect(() => {
    if (!adderOpen) return;
    const handler = (e) => { if (adderRef.current && !adderRef.current.contains(e.target)) setAdderOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [adderOpen]);

  const loaded = loadedIds.map(id => workspaces.find(w => w.id === id)).filter(Boolean);
  const unloaded = workspaces.filter(w => !loadedIds.includes(w.id));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: '1 1 auto', position: 'relative' }}>
      <DevNote n={2} anchor="bottom-left" />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        overflowX: 'auto', overflowY: 'hidden',
        scrollbarWidth: 'thin',
        minWidth: 0,
      }}>
        {loaded.map(w => (
          <WorkspaceTab
            key={w.id}
            ws={w}
            isActive={w.id === activeId}
            runs={(runsMap && runsMap[w.id]) || []}
            onSelect={onSelect}
            onClose={onClose}
            canClose={loadedIds.length > 1}
          />
        ))}
      </div>

      <div ref={adderRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          className="oz-ws-tab-add"
          onClick={() => setAdderOpen(o => !o)}
          title="Load another workspace"
        ><Icon name="plus" size={13} /></button>

        {adderOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0,
            minWidth: 320,
            background: 'var(--cb-surface-glass)',
            backdropFilter: 'blur(var(--cb-glass-blur))',
            WebkitBackdropFilter: 'blur(var(--cb-glass-blur))',
            border: '1px solid var(--cb-border)',
            borderRadius: 'var(--cb-radius-lg)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 0 var(--cb-glass-highlight)',
            padding: 6, zIndex: 50,
          }}>
            <div style={{ padding: '6px 10px 8px', fontFamily: 'var(--cb-font-display)', fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text-muted)' }}>
              Load workspace
            </div>
            {unloaded.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--cb-text-muted)' }}>
                All workspaces already loaded.
              </div>
            ) : unloaded.map(w => (
              <div
                key={w.id}
                onClick={() => { onLoad(w.id); setAdderOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 10px', borderRadius: 'var(--cb-radius-md)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--cb-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div className="oz-wspicker-icon"><Icon name={w.icon.replace("ph-thin ph-", "")} size={14} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--cb-text)', fontWeight: 500 }}>{w.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {w.description || '—'}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>
                  {w.roots.length} root{w.roots.length === 1 ? '' : 's'}
                </span>
              </div>
            ))}
            <div style={{ height: 1, background: 'var(--cb-border)', margin: '6px 4px' }}></div>
            <div
              onClick={() => { onCreate(); setAdderOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', cursor: 'pointer', color: 'var(--cb-accent)', fontSize: 12, borderRadius: 'var(--cb-radius-md)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--cb-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Icon name="plus" size={13} />
              <span>New workspace…</span>
              <span className="oz-kbd" style={{ marginLeft: 'auto' }}>⌘N</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ───────── Top bar ─────────
const TopBar = ({ title, workspaces, activeId, loadedIds, runsMap, onSelectWs, onCloseWs, onLoadWs, onCreateWs, theme, setTheme, route }) => (
  <header className="oz-topbar">
    {route === "dashboard" ? (
      <WorkspaceTabs
        workspaces={workspaces}
        loadedIds={loadedIds}
        activeId={activeId}
        runsMap={runsMap}
        onSelect={onSelectWs}
        onClose={onCloseWs}
        onLoad={onLoadWs}
        onCreate={onCreateWs}
      />
    ) : (
      <div className="oz-topbar-title">{title}</div>
    )}
    {route !== "dashboard" && <div className="oz-topbar-spacer"></div>}

    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 12px',
      background: 'var(--cb-bg-soft)',
      border: '1px solid var(--cb-border)',
      borderRadius: 'var(--cb-radius-md)',
      color: 'var(--cb-text-muted)',
      fontSize: 12, cursor: 'pointer',
      minWidth: 220,
    }}>
      <Icon name="magnifying-glass" size={13} />
      <span>Search runs, priorities…</span>
      <span className="oz-kbd" style={{ marginLeft: 'auto' }}>⌘K</span>
    </div>

    <button className="oz-iconbtn" title="Toggle theme" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}>
      <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
    </button>
    <button className="oz-iconbtn" title="Notifications">
      <Icon name="bell" size={15} />
    </button>
  </header>
);

// ───────── Reusable: section header inside content ─────────
const ScreenHeader = ({ title, subtitle, actions }) => (
  <div style={{
    display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
    padding: '20px 28px 16px',
    gap: 16,
  }}>
    <div>
      <h1 style={{ margin: 0, fontFamily: 'var(--cb-font-display)', fontSize: 22, letterSpacing: 1.8, textTransform: 'uppercase', color: 'var(--cb-accent)', fontWeight: 600 }}>
        {title}
      </h1>
      {subtitle && (
        <div style={{ fontSize: 12.5, color: 'var(--cb-text-muted)', marginTop: 4, lineHeight: 1.5, maxWidth: 640 }}>
          {subtitle}
        </div>
      )}
    </div>
    {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
  </div>
);

// ───────── Card ─────────
const Card = ({ children, style, onClick, active }) => (
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
);

// ───────── Modal ─────────
const Modal = ({ open, onClose, title, subtitle, icon, footer, children, width = 640 }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(10, 8, 6, 0.55)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        animation: 'ozFadeIn 200ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: width, maxWidth: '100%', maxHeight: 'calc(100vh - 48px)',
          background: 'var(--cb-bg-soft)',
          border: '1px solid var(--cb-border-strong)',
          borderRadius: 'var(--cb-radius-xl)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.55), inset 0 1px 0 0 var(--cb-glass-highlight)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          animation: 'ozSlideIn 240ms ease-out',
        }}
      >
        <div style={{ position: 'absolute', top: -1, left: -1, width: 16, height: 16, borderTop: '1px solid var(--cb-accent)', borderLeft: '1px solid var(--cb-accent)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -1, right: -1, width: 16, height: 16, borderBottom: '1px solid var(--cb-accent)', borderRight: '1px solid var(--cb-accent)', pointerEvents: 'none' }} />

        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 14,
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--cb-border)',
        }}>
          {icon && (
            <div style={{
              width: 36, height: 36,
              background: 'var(--cb-accent-muted)',
              border: '1px solid var(--cb-accent-15)',
              borderRadius: 'var(--cb-radius-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--cb-accent)', flexShrink: 0,
            }}>
              <Icon name={icon} size={18} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{
              margin: 0,
              fontFamily: 'var(--cb-font-display)', fontSize: 15,
              letterSpacing: 1.5, textTransform: 'uppercase',
              color: 'var(--cb-text)', fontWeight: 600,
            }}>{title}</h2>
            {subtitle && (
              <div style={{ fontSize: 12, color: 'var(--cb-text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                {subtitle}
              </div>
            )}
          </div>
          <button className="oz-iconbtn" onClick={onClose} title="Close (Esc)">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {children}
        </div>

        {footer && (
          <div style={{
            padding: '14px 24px',
            borderTop: '1px solid var(--cb-border)',
            background: 'var(--cb-bg)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

// ───────── Export to window ─────────
// ───────── Dev Annotations ─────────
const DevModeContext = React.createContext({ on: false, register: () => {}, unregister: () => {} });

const useDevMode = () => React.useContext(DevModeContext);

const DevNote = ({ n, anchor = "top-left" }) => {
  const { on } = useDevMode();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const meta = (window.DEV_NOTES || []).find(x => x.n === n) || { title: `Note ${n}`, body: "Missing in registry." };
  const { title, body } = meta;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!on) return null;
  const positions = {
    "top-left": { top: 6, left: 6 },
    "top-right": { top: 6, right: 6 },
    "bottom-left": { bottom: 6, left: 6 },
    "bottom-right": { bottom: 6, right: 6 },
  };
  return (
    <div ref={ref} style={{
      position: 'absolute', ...positions[anchor], zIndex: 200,
      pointerEvents: 'auto',
    }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        title={`Dev note ${n}: ${title}`}
        style={{
          width: 22, height: 22, borderRadius: '50%',
          background: 'var(--cb-accent)',
          color: 'var(--cb-text-on-accent)',
          border: '2px solid var(--cb-bg)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.5), 0 0 0 1px var(--cb-accent-30)',
          fontFamily: 'var(--cb-font-mono)',
          fontSize: 10, fontWeight: 700,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1,
        }}
      >{n}</button>
      {open && (
        <div style={{
          position: 'absolute',
          [anchor.includes('top') ? 'top' : 'bottom']: 28,
          [anchor.includes('left') ? 'left' : 'right']: 0,
          width: 280,
          background: 'var(--cb-bg-soft)',
          border: '1px solid var(--cb-accent-30)',
          borderRadius: 'var(--cb-radius-md)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
          padding: 14,
          zIndex: 201,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{
              width: 20, height: 20, borderRadius: '50%',
              background: 'var(--cb-accent)', color: 'var(--cb-text-on-accent)',
              fontFamily: 'var(--cb-font-mono)', fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>{n}</span>
            <div style={{
              fontFamily: 'var(--cb-font-display)', fontSize: 11,
              letterSpacing: 1.2, textTransform: 'uppercase',
              color: 'var(--cb-accent)', fontWeight: 600,
            }}>{title}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--cb-text)', lineHeight: 1.6 }}>
            {body}
          </div>
        </div>
      )}
    </div>
  );
};

// ───────── Dev Annotations side panel ─────────
const DevNotesPanel = ({ open, onClose, notes }) => {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', top: 56, right: 0, bottom: 0,
      width: 340,
      background: 'var(--cb-bg-soft)',
      borderLeft: '1px solid var(--cb-accent-30)',
      boxShadow: '-12px 0 32px rgba(0,0,0,0.4)',
      zIndex: 600,
      display: 'flex', flexDirection: 'column',
      animation: 'ozSlideIn 250ms ease-out',
    }}>
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--cb-border)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <Icon name="code" size={16} style={{ color: 'var(--cb-accent)' }} />
        <div style={{
          fontFamily: 'var(--cb-font-display)', fontSize: 12,
          letterSpacing: 1.5, textTransform: 'uppercase',
          color: 'var(--cb-text)', fontWeight: 600, flex: 1,
        }}>Dev notes</div>
        <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)', padding: '1px 6px', background: 'var(--cb-bg)', borderRadius: 10 }}>
          {notes.length} pins
        </span>
        <button className="oz-iconbtn" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1, fontSize: 11.5, color: 'var(--cb-text-muted)', lineHeight: 1.55 }}>
        Numbered pins overlay every annotated component. Click a pin in the UI for component-level docs; the list here is the index.
        <div style={{ margin: '14px 0 10px', height: 1, background: 'var(--cb-border)' }}></div>
        {notes.map(note => (
          <div key={note.n} style={{
            display: 'grid', gridTemplateColumns: '24px 1fr',
            gap: 10, marginBottom: 14,
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: 'var(--cb-accent)', color: 'var(--cb-text-on-accent)',
              fontFamily: 'var(--cb-font-mono)', fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{note.n}</div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--cb-text)', fontWeight: 500, marginBottom: 3 }}>{note.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', lineHeight: 1.55 }}>{note.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

Object.assign(window, {
  Icon, StatusChip, Button, Sidebar, TopBar, WorkspaceTabs, ScreenHeader, Card, Modal,
  DevModeContext, useDevMode, DevNote, DevNotesPanel,
  NAV_ITEMS, STATUS_LABEL,
});
