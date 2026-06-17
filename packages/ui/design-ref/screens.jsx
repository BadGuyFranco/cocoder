// Other screens: Workspaces, CLIs, Personas, Settings.

const S = window;

// DEPENDENCIES PANEL — system tools (iTerm2, cmux). Reusable in Settings and First-run.

const DependencyRow = ({ dep, onRecheck, onCopy, checking }) => {
  const ok = dep.status === "ok";
  return (
    <S.Card style={{ marginBottom: 10 }}>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{
          width: 40, height: 40,
          background: ok ? 'var(--cb-accent-muted)' : 'var(--cb-bg-soft)',
          border: `1px solid ${ok ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`,
          borderRadius: 'var(--cb-radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: ok ? 'var(--cb-accent)' : 'var(--cb-text-muted)',
          flexShrink: 0,
        }}>
          <S.Icon name={dep.icon} size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, color: 'var(--cb-text)', fontWeight: 500 }}>{dep.name}</span>
            <S.StatusChip status={ok ? "ok" : "not-installed"} label={ok ? `Installed v${dep.version}` : "Not installed"} />
            <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)' }}>
              {dep.vendor} · checked {dep.lastChecked}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--cb-text-muted)', lineHeight: 1.55, marginBottom: ok ? 0 : 12 }}>
            {dep.purpose}
          </div>
          {!ok && (
            <>
              <div style={{
                fontFamily: 'var(--cb-font-mono)', fontSize: 12,
                background: 'var(--cb-bg)', border: '1px solid var(--cb-border)',
                padding: '10px 12px', borderRadius: 'var(--cb-radius-md)',
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: dep.note ? 8 : 0,
              }}>
                <span style={{ color: 'var(--cb-accent)' }}>$</span>
                <span style={{ flex: 1, color: 'var(--cb-text)' }}>{dep.installCmd}</span>
                <button className="oz-iconbtn" style={{ width: 26, height: 26 }} title="Copy command" onClick={() => onCopy(dep.installCmd)}>
                  <S.Icon name="copy" size={12} />
                </button>
              </div>
              {dep.note && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                  fontSize: 11, color: 'var(--cb-text-muted)',
                  padding: '6px 2px', lineHeight: 1.55,
                }}>
                  <S.Icon name="info" size={11} style={{ color: 'var(--cb-text-muted)', marginTop: 2, flexShrink: 0 }} />
                  <span>{dep.note}</span>
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <S.Button variant="ghost" size="sm" icon="arrow-clockwise" onClick={() => onRecheck(dep.id)} disabled={checking}>
            {checking ? "Checking…" : "Re-check"}
          </S.Button>
        </div>
      </div>
    </S.Card>
  );
};

const DependenciesPanel = ({ dependencies, onRecheck, compact }) => {
  const [checking, setChecking] = useState(null);
  const [copied, setCopied] = useState(null);
  const missing = dependencies.filter(d => d.status !== "ok").length;

  const handleRecheck = (id) => {
    setChecking(id);
    setTimeout(() => { onRecheck && onRecheck(id); setChecking(null); }, 900);
  };
  const handleCopy = (cmd) => {
    try { navigator.clipboard?.writeText(cmd); } catch (e) {}
    setCopied(cmd);
    setTimeout(() => setCopied(null), 1400);
  };

  return (
    <>
      {!compact && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', marginBottom: 16,
          background: missing > 0 ? 'var(--cb-highlight-muted)' : 'var(--cb-success-muted)',
          border: `1px solid ${missing > 0 ? 'rgba(212,118,110,0.20)' : 'rgba(125,175,110,0.20)'}`,
          borderRadius: 'var(--cb-radius-md)',
        }}>
          <S.Icon name={missing > 0 ? "warning-circle" : "check-circle"} size={16}
                  style={{ color: missing > 0 ? 'var(--cb-highlight)' : 'var(--cb-success)' }} />
          <div style={{ flex: 1, fontSize: 12.5, color: missing > 0 ? 'var(--cb-highlight)' : 'var(--cb-success)', lineHeight: 1.5 }}>
            {missing > 0
              ? `${missing} dependenc${missing === 1 ? 'y is' : 'ies are'} missing. CoCoder runs without them, but attach/orchestration won't work properly.`
              : `All system dependencies installed.`}
          </div>
        </div>
      )}
      {dependencies.map(d => (
        <DependencyRow key={d.id} dep={d}
                       onRecheck={handleRecheck}
                       onCopy={handleCopy}
                       checking={checking === d.id} />
      ))}
      {copied && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-accent-30)',
          padding: '8px 14px', borderRadius: 'var(--cb-radius-md)',
          fontSize: 12, color: 'var(--cb-accent)', zIndex: 800,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <S.Icon name="check" size={13} /> Copied to clipboard
        </div>
      )}
    </>
  );
};

// ──────────────────────────────────────────────────────────────
// CRAFT NEW PERSONA — modal that enqueues a priority for the team to build
// ──────────────────────────────────────────────────────────────

const CraftPersonaModal = ({ open, onClose, clis, onSubmit }) => {
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [cli, setCli] = useState("claude-code");
  const [model, setModel] = useState("Default");
  const [runMode, setRunMode] = useState("visible");
  const [capabilities, setCapabilities] = useState("");
  const [needsSubAgents, setNeedsSubAgents] = useState(false);
  const [subAgentSketch, setSubAgentSketch] = useState("");
  const [priority, setPriority] = useState("normal");

  // Reset on open
  useEffect(() => {
    if (open) {
      setName(""); setTagline(""); setDescription("");
      setCli("claude-code"); setModel("Default"); setRunMode("visible");
      setCapabilities(""); setNeedsSubAgents(false); setSubAgentSketch("");
      setPriority("normal");
    }
  }, [open]);

  const cliEntry = clis.find(c => c.id === cli);
  const valid = name.trim() && tagline.trim();

  const handleSubmit = () => {
    onSubmit({
      name: `Persona: ${name.trim()}`,
      summary: `${tagline.trim()}${description.trim() ? ' — ' + description.trim() : ''}`,
      spec: { name, tagline, description, cli, model, runMode, capabilities, needsSubAgents, subAgentSketch },
      placeAtTop: priority === "next",
    });
    onClose();
  };

  return (
    <S.Modal
      open={open} onClose={onClose}
      title="Craft a new persona"
      subtitle="Sketch the role. Oz files it as a workspace priority — the team builds the persona itself (prompt, sub-agents, tests)."
      icon="hammer"
      width={680}
      footer={
        <>
          <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', flex: 1, lineHeight: 1.5 }}>
            <S.Icon name="info" size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Personas aren't configured — they're <span style={{ color: 'var(--cb-accent)' }}>built</span>. Once Bob ships and Talia / Quinn green-light, the persona appears here.
          </div>
          <S.Button variant="ghost" onClick={onClose}>Cancel</S.Button>
          <S.Button variant="primary" icon="plus" disabled={!valid} onClick={handleSubmit}>
            File as priority
          </S.Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label className="oz-field-label">Persona name</label>
          <input className="oz-input" autoFocus value={name}
                 onChange={e => setName(e.target.value)}
                 placeholder="e.g. Translator, Designer, Auditor" />
        </div>
        <div>
          <label className="oz-field-label">Role tagline</label>
          <input className="oz-input" value={tagline}
                 onChange={e => setTagline(e.target.value)}
                 placeholder="One line — what they do" />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="oz-field-label">Description</label>
        <textarea className="oz-textarea" value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Couple sentences. When does this persona get pulled in? What's their lane?"
                  rows={3} />
      </div>

      <div className="oz-section-marker lhs">Default config</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label className="oz-field-label">CLI</label>
          <select className="oz-select" value={cli} onChange={e => { setCli(e.target.value); setModel("Default"); }}>
            {clis.map(c => <option key={c.id} value={c.id} disabled={c.status !== "ok"}>
              {c.name}{c.status !== "ok" ? ` (${S.STATUS_LABEL[c.status]})` : ""}
            </option>)}
          </select>
        </div>
        <div>
          <label className="oz-field-label">Model</label>
          <select className="oz-select" value={model} onChange={e => setModel(e.target.value)}>
            {(cliEntry?.models || ["Default"]).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="oz-field-label">Run mode</label>
          <div style={{ display: 'flex', gap: 6, padding: 2, background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)' }}>
            {["visible", "headless"].map(m => (
              <button key={m} onClick={() => setRunMode(m)}
                      style={{
                        flex: 1, padding: '6px 8px',
                        background: runMode === m ? 'var(--cb-accent-muted)' : 'transparent',
                        color: runMode === m ? 'var(--cb-accent)' : 'var(--cb-text-muted)',
                        border: 'none', borderRadius: 3,
                        fontSize: 11.5, fontWeight: runMode === m ? 500 : 400,
                        cursor: 'pointer', textTransform: 'capitalize',
                      }}>{m}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="oz-field-label">Capabilities sketch</label>
        <textarea className="oz-textarea" value={capabilities}
                  onChange={e => setCapabilities(e.target.value)}
                  placeholder="What should this persona be able to do? Examples, edge cases, things they should never do."
                  rows={3} />
        <div className="oz-field-help">
          Free-form. The team uses this to draft the system prompt and design tests.
        </div>
      </div>

      <div style={{
        padding: '12px 14px',
        background: 'var(--cb-bg)',
        border: '1px solid var(--cb-border)',
        borderRadius: 'var(--cb-radius-md)',
        marginBottom: 16,
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={needsSubAgents}
                 onChange={e => setNeedsSubAgents(e.target.checked)}
                 style={{ width: 14, height: 14, accentColor: 'var(--cb-accent)' }} />
          <span style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500 }}>This persona should have sub-agents</span>
        </label>
        {needsSubAgents && (
          <textarea className="oz-textarea" value={subAgentSketch}
                    onChange={e => setSubAgentSketch(e.target.value)}
                    placeholder="Sketch the sub-agents. e.g. 'a fact-checker sub on Gemini Pro; a formatter sub on Haiku.'"
                    rows={2}
                    style={{ marginTop: 10 }} />
        )}
      </div>

      <div className="oz-section-marker lhs">Priority placement</div>

      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { v: "next", label: "Next up", help: "Pin to the top of the priority list." },
          { v: "normal", label: "Add to list", help: "Append at the current position." },
        ].map(opt => (
          <div key={opt.v}
            onClick={() => setPriority(opt.v)}
            style={{
              flex: 1, padding: '12px 14px',
              background: priority === opt.v ? 'var(--cb-accent-muted)' : 'var(--cb-bg-soft)',
              border: `1px solid ${priority === opt.v ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`,
              borderRadius: 'var(--cb-radius-md)',
              cursor: 'pointer',
            }}>
            <div style={{ fontSize: 13, color: priority === opt.v ? 'var(--cb-accent)' : 'var(--cb-text)', fontWeight: 500, marginBottom: 3 }}>
              {opt.label}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', lineHeight: 1.5 }}>{opt.help}</div>
          </div>
        ))}
      </div>
    </S.Modal>
  );
};

// ──────────────────────────────────────────────────────────────
// NEW WORKSPACE MODAL
// ──────────────────────────────────────────────────────────────

const NewWorkspaceModal = ({ open, onClose, onCreate }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rootName, setRootName] = useState("");
  const [rootPath, setRootPath] = useState("");

  useEffect(() => {
    if (open) { setName(""); setDescription(""); setRootName(""); setRootPath(""); }
  }, [open]);

  const valid = name.trim() && rootName.trim() && rootPath.trim();

  const submit = () => {
    onCreate({
      name: name.trim(),
      description: description.trim(),
      root: { name: rootName.trim(), path: rootPath.trim() },
    });
    onClose();
  };

  return (
    <S.Modal
      open={open} onClose={onClose}
      title="New workspace"
      subtitle="A workspace bundles one or more root folders and runs its own Oz, priorities, and runs."
      icon="cube"
      width={620}
      footer={
        <>
          <div style={{ flex: 1, fontSize: 11, color: 'var(--cb-text-muted)' }}>
            You can add more roots and assign Writable / Read-only roles after creating it.
          </div>
          <S.Button variant="ghost" onClick={onClose}>Cancel</S.Button>
          <S.Button variant="primary" icon="cube" disabled={!valid} onClick={submit}>
            Create & open
          </S.Button>
        </>
      }
    >
      <div style={{ marginBottom: 16 }}>
        <label className="oz-field-label">Workspace name</label>
        <input className="oz-input" autoFocus value={name}
               onChange={e => setName(e.target.value)}
               placeholder="e.g. AcmeCRM, Vault, Internal Tools" />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label className="oz-field-label">Description</label>
        <textarea className="oz-textarea" value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What's this workspace for? Oz reads this on every conversation."
                  rows={2} />
      </div>

      <div className="oz-section-marker lhs">Primary root</div>

      <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', marginBottom: 12, lineHeight: 1.55 }}>
        The main working repo. Where CoCoder picks up and writes freely. Exactly one Primary per workspace.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
        <div>
          <label className="oz-field-label">Name</label>
          <input className="oz-input" value={rootName}
                 onChange={e => setRootName(e.target.value)}
                 placeholder="cocoder-cli" />
        </div>
        <div>
          <label className="oz-field-label">Path</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="oz-input" value={rootPath} style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12 }}
                   onChange={e => setRootPath(e.target.value)}
                   placeholder="~/dev/cocoder-cli" />
            <button className="oz-iconbtn" title="Pick folder"
                    onClick={() => setRootPath("~/dev/" + (rootName || "new-root"))}>
              <S.Icon name="folder-notch-open" size={14} />
            </button>
          </div>
        </div>
      </div>
    </S.Modal>
  );
};

// ──────────────────────────────────────────────────────────────
// WORKSPACES
// ──────────────────────────────────────────────────────────────

const ROLE_META = {
  primary: {
    label: "Primary",
    color: "var(--cb-accent)",
    bg: "var(--cb-accent-muted)",
    border: "var(--cb-accent-15)",
    body: "Main working repo. CoCoder picks up here and writes freely.",
  },
  writable: {
    label: "Writable",
    color: "var(--cb-text)",
    bg: "var(--cb-bg-soft)",
    border: "var(--cb-border)",
    body: "Orchestrator may write, but only with explicit human permission.",
  },
  readonly: {
    label: "Read-only",
    color: "var(--cb-text-muted)",
    bg: "var(--cb-bg-soft)",
    border: "var(--cb-border)",
    body: "Reference repo. Never written to.",
  },
};

const RootRow = ({ root, hasPrimary, onChange, onDelete }) => {
  const meta = ROLE_META[root.role];
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1.2fr 2fr 200px 32px',
      gap: 12, alignItems: 'center',
      padding: '12px 14px',
      background: 'var(--cb-surface-glass)',
      border: '1px solid var(--cb-border)',
      borderRadius: 'var(--cb-radius-md)',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <S.Icon name={root.role === "primary" ? "folder-star" : root.role === "writable" ? "folder-open" : "folder-lock"}
                size={16} style={{ color: meta.color }} />
        <input
          value={root.name}
          onChange={e => onChange({ ...root, name: e.target.value })}
          className="oz-input"
          style={{ padding: '5px 8px', fontSize: 12.5, background: 'transparent', border: 'none' }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--cb-font-mono)', fontSize: 11.5, color: 'var(--cb-text-secondary)', minWidth: 0 }}>
        <S.Icon name="folder" size={13} style={{ color: 'var(--cb-text-muted)' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{root.path}</span>
        <button className="oz-iconbtn" style={{ width: 24, height: 24, flexShrink: 0 }} title="Pick folder"><S.Icon name="folder-notch-open" size={11} /></button>
      </div>
      <div>
        <select
          className="oz-select"
          value={root.role}
          onChange={e => onChange({ ...root, role: e.target.value })}
          style={{ fontSize: 12 }}
        >
          <option value="primary" disabled={hasPrimary && root.role !== "primary"}>
            Primary{hasPrimary && root.role !== "primary" ? " (taken)" : ""}
          </option>
          <option value="writable">Writable</option>
          <option value="readonly">Read-only</option>
        </select>
      </div>
      <button className="oz-iconbtn" onClick={onDelete} title="Remove root"
              style={{ color: 'var(--cb-text-muted)' }}>
        <S.Icon name="trash" size={13} />
      </button>
    </div>
  );
};

const WorkspacesScreen = ({ workspaces, activeId, onChange, onSetActive, onCreate, onDelete, onGotoDashboard }) => {
  const [editId, setEditId] = useState(activeId);
  const editing = workspaces.find(w => w.id === editId);

  const updateRoot = (id, next) => {
    onChange({ ...editing, roots: editing.roots.map(r => r.id === id ? next : r) });
  };
  const addRoot = () => {
    const newId = "r-" + Math.random().toString(36).slice(2, 8);
    const hasPrimary = editing.roots.some(r => r.role === "primary");
    onChange({ ...editing, roots: [...editing.roots, { id: newId, name: "new-root", path: "~/dev/", role: hasPrimary ? "writable" : "primary" }] });
  };
  const removeRoot = (id) => {
    onChange({ ...editing, roots: editing.roots.filter(r => r.id !== id) });
  };

  const hasPrimary = editing?.roots.some(r => r.role === "primary");

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <S.ScreenHeader
        title="Workspaces"
        subtitle="Each workspace bundles one or more root folders and runs its own Oz, priorities, and runs. Switch between them from the dashboard."
        actions={<S.Button variant="primary" icon="plus" onClick={onCreate}>New workspace</S.Button>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, padding: '0 28px 24px', overflow: 'hidden', minHeight: 0 }}>
        {/* List */}
        <div className="oz-panel" style={{ minHeight: 0 }}>
          <div className="oz-panel-header">
            <div className="oz-panel-title">All workspaces</div>
            <span className="oz-panel-count">{workspaces.length}</span>
          </div>
          <div className="oz-panel-body" style={{ padding: 8 }}>
            {workspaces.map(w => (
              <div key={w.id} onClick={() => setEditId(w.id)} style={{
                padding: '10px 12px',
                background: editId === w.id ? 'var(--cb-accent-muted)' : 'transparent',
                border: editId === w.id ? '1px solid var(--cb-accent-15)' : '1px solid transparent',
                borderRadius: 'var(--cb-radius-md)',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
                marginBottom: 4,
              }}>
                <S.Icon name={w.icon.replace("ph-thin ph-", "")} size={16}
                        style={{ color: editId === w.id ? 'var(--cb-accent)' : 'var(--cb-text-secondary)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: editId === w.id ? 500 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {w.name}
                  </div>
                  <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>
                    {w.roots.length} root{w.roots.length === 1 ? '' : 's'}
                  </div>
                </div>
                {w.id === activeId && (
                  <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-accent)', letterSpacing: 0.5 }}>● ACTIVE</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Detail */}
        {editing && (
          <div className="oz-panel" style={{ minHeight: 0 }}>
            <div className="oz-panel-header">
              <S.Icon name={editing.icon.replace("ph-thin ph-", "")} size={16} style={{ color: 'var(--cb-accent)' }} />
              <div className="oz-panel-title" style={{ color: 'var(--cb-accent)' }}>{editing.name}</div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {editing.id !== activeId && (
                  <S.Button variant="secondary" size="sm" icon="arrow-right" onClick={() => { onSetActive(editing.id); onGotoDashboard && onGotoDashboard(); }}>Open in Dashboard</S.Button>
                )}
                <S.Button variant="ghost" size="sm" icon="trash" onClick={() => onDelete(editing.id)}>Delete</S.Button>
              </div>
            </div>
            <div className="oz-panel-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                <div>
                  <label className="oz-field-label">Name</label>
                  <input className="oz-input" value={editing.name}
                         onChange={e => onChange({ ...editing, name: e.target.value })} />
                </div>
                <div>
                  <label className="oz-field-label">Created</label>
                  <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12, color: 'var(--cb-text-muted)', padding: '9px 0' }}>
                    {editing.created}
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 28 }}>
                <label className="oz-field-label">Description</label>
                <textarea className="oz-textarea" value={editing.description}
                          onChange={e => onChange({ ...editing, description: e.target.value })} />
                <div className="oz-field-help">
                  Oz reads this on every conversation. Keep it short and concrete — what's this workspace for?
                </div>
              </div>

              {/* Roots */}
              <div className="oz-section-marker lhs">Root folders · {editing.roots.length}</div>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16,
              }}>
                {Object.entries(ROLE_META).map(([k, v]) => (
                  <div key={k} style={{
                    padding: '10px 12px',
                    background: v.bg, border: `1px solid ${v.border}`,
                    borderRadius: 'var(--cb-radius-md)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                      <S.Icon name={k === "primary" ? "folder-star" : k === "writable" ? "folder-open" : "folder-lock"} size={13} style={{ color: v.color }} />
                      <span style={{ fontFamily: 'var(--cb-font-display)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: v.color, fontWeight: 600 }}>
                        {v.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', lineHeight: 1.5 }}>{v.body}</div>
                  </div>
                ))}
              </div>

              <div style={{
                display: 'grid', gridTemplateColumns: '1.2fr 2fr 200px 32px',
                gap: 12, padding: '0 14px 8px',
                fontFamily: 'var(--cb-font-display)', fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text-muted)',
              }}>
                <span>Name</span><span>Path</span><span>Role</span><span></span>
              </div>

              {editing.roots.map(r => (
                <RootRow key={r.id} root={r} hasPrimary={hasPrimary}
                         onChange={next => updateRoot(r.id, next)}
                         onDelete={() => removeRoot(r.id)} />
              ))}
              <button onClick={addRoot} style={{
                width: '100%', padding: '12px',
                background: 'transparent', border: '1px dashed var(--cb-border-strong)',
                borderRadius: 'var(--cb-radius-md)', cursor: 'pointer',
                color: 'var(--cb-text-secondary)', fontSize: 12,
                fontFamily: 'var(--cb-font-body)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all 120ms ease-out',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--cb-accent)'; e.currentTarget.style.borderColor = 'var(--cb-accent-30)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--cb-text-secondary)'; e.currentTarget.style.borderColor = 'var(--cb-border-strong)'; }}>
                <S.Icon name="plus" size={13} /> Add root folder
              </button>
              {!hasPrimary && editing.roots.length > 0 && (
                <div style={{
                  marginTop: 16, padding: '10px 14px',
                  background: 'var(--cb-highlight-muted)',
                  border: '1px solid rgba(212,118,110,0.20)',
                  borderRadius: 'var(--cb-radius-md)',
                  display: 'flex', alignItems: 'center', gap: 10,
                  color: 'var(--cb-highlight)', fontSize: 12,
                }}>
                  <S.Icon name="warning-circle" size={14} />
                  This workspace has no Primary root. Promote one before launching a run.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// CLIs
// ──────────────────────────────────────────────────────────────

const CliRow = ({ cli, onTest, testing, expanded, onToggle }) => {
  const meta = STATUS_VARIANT[cli.status];
  return (
    <Card style={{ marginBottom: 10, position: 'relative' }}>
      {cli.id === "claude-code" && <S.DevNote n={12} anchor="top-right" />}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 40, height: 40,
          background: cli.status === "ok" ? 'var(--cb-accent-muted)' :
                      cli.status === "not-installed" ? 'var(--cb-bg-soft)' :
                      'var(--cb-highlight-muted)',
          border: `1px solid ${cli.status === "ok" ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`,
          borderRadius: 'var(--cb-radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: cli.status === "ok" ? 'var(--cb-accent)' : 'var(--cb-text-muted)',
          flexShrink: 0,
        }}>
          <S.Icon name="terminal-window" size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 14, color: 'var(--cb-text)', fontWeight: 500 }}>{cli.name}</span>
            <S.StatusChip status={cli.status} />
            {cli.version !== "—" && (
              <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)' }}>v{cli.version}</span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)' }}>
            {cli.vendor} · last tested {cli.lastTested}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <S.Button variant="ghost" size="sm" icon="play"
                  onClick={() => onTest(cli.id)} disabled={testing}>
            {testing ? "Testing…" : "Test"}
          </S.Button>
          <S.Button variant="ghost" size="sm" icon={expanded ? "caret-up" : "caret-down"}
                  onClick={() => onToggle(cli.id)}>
            {expanded ? "Hide" : "Details"}
          </S.Button>
        </div>
      </div>
      {cli.errorDetail && cli.status !== "ok" && (
        <div style={{
          padding: '10px 16px',
          background: 'var(--cb-highlight-muted)',
          borderTop: '1px solid rgba(212,118,110,0.15)',
          fontSize: 12, color: 'var(--cb-highlight)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <S.Icon name="warning-circle" size={14} />
          <span style={{ flex: 1 }}>{cli.errorDetail}</span>
          {cli.status === "auth-failed" && <S.Button variant="destructive" size="sm" icon="key">Re-authenticate</S.Button>}
          {cli.status === "not-installed" && <S.Button variant="destructive" size="sm" icon="download-simple">Install instructions</S.Button>}
        </div>
      )}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--cb-border)', padding: '14px 16px', background: 'var(--cb-bg-soft)' }}>
          <div style={{ fontFamily: 'var(--cb-font-display)', fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text-muted)', marginBottom: 8 }}>
            Available models · {cli.models.length}
          </div>
          {cli.models.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {cli.models.map(m => (
                <span key={m} style={{
                  fontFamily: 'var(--cb-font-mono)', fontSize: 11,
                  padding: '4px 10px',
                  background: m === "Default" ? 'var(--cb-accent-muted)' : 'var(--cb-bg)',
                  color: m === "Default" ? 'var(--cb-accent)' : 'var(--cb-text-secondary)',
                  border: `1px solid ${m === "Default" ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`,
                  borderRadius: 3,
                }}>{m}</span>
              ))}
            </div>
          ) : <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)' }}>None — install the CLI first.</div>}
        </div>
      )}
    </Card>
  );
};

const CLIsScreen = ({ clis, onTest, onAdd }) => {
  const [testingId, setTestingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const handleTest = (id) => {
    setTestingId(id);
    setTimeout(() => { onTest(id); setTestingId(null); }, 1100);
  };

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <S.ScreenHeader
        title="CLIs"
        subtitle="The coding-agent command-line tools personas run on. Each must be installed on this machine and authenticated."
        actions={<S.Button variant="primary" icon="plus" onClick={onAdd}>Register CLI</S.Button>}
      />
      <div style={{ padding: '0 28px 24px', overflowY: 'auto', minHeight: 0 }}>
        {/* Status summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: "Ready", count: clis.filter(c => c.status === "ok").length, color: "var(--cb-success)", icon: "check-circle" },
            { label: "Auth issues", count: clis.filter(c => c.status === "auth-failed").length, color: "var(--cb-highlight)", icon: "warning-circle" },
            { label: "Not installed", count: clis.filter(c => c.status === "not-installed").length, color: "var(--cb-text-muted)", icon: "minus-circle" },
          ].map(s => (
            <Card key={s.label} style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <S.Icon name={s.icon} size={22} style={{ color: s.color }} />
              <div>
                <div style={{ fontFamily: 'var(--cb-font-display)', fontSize: 22, color: s.color, fontWeight: 600, lineHeight: 1, fontFamilly: 'var(--cb-font-display)' }}>{s.count}</div>
                <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', marginTop: 4, letterSpacing: 0.3 }}>{s.label}</div>
              </div>
            </Card>
          ))}
        </div>

        {clis.map(c => (
          <CliRow key={c.id} cli={c}
                  onTest={handleTest} testing={testingId === c.id}
                  expanded={expandedId === c.id}
                  onToggle={id => setExpandedId(e => e === id ? null : id)} />
        ))}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// PERSONAS
// ──────────────────────────────────────────────────────────────

const PersonaRow = ({ persona, clis, onChange, onAddSub, onRemoveSub, onUpdateSub }) => {
  const isOz = persona.id === "oz";
  const cliEntry = clis.find(c => c.id === persona.cli);

  return (
    <Card style={{
      marginBottom: 12,
      borderColor: isOz ? 'var(--cb-accent-15)' : 'var(--cb-border)',
      background: 'var(--cb-surface-solid)',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      boxShadow: 'none',
    }}>
      <div style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{
            width: 44, height: 44,
            background: isOz ? 'var(--cb-accent-muted)' : 'var(--cb-bg-soft)',
            border: `1px solid ${isOz ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`,
            borderRadius: 'var(--cb-radius-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: isOz ? 'var(--cb-accent)' : 'var(--cb-text-secondary)',
            flexShrink: 0,
          }}>
            <S.Icon name={persona.icon.replace("ph-thin ph-", "")} size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <span style={{ fontSize: 15, color: 'var(--cb-text)', fontWeight: 500 }}>{persona.name}</span>
              {isOz && <span className="oz-chip oz-chip-running"><span className="dot"></span>HEADLESS</span>}
              {persona.runMode === "headless" && !isOz && <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, padding: '2px 6px', background: 'var(--cb-bg-soft)', color: 'var(--cb-text-muted)', borderRadius: 2 }}>HEADLESS</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--cb-text-secondary)', marginBottom: 6 }}>{persona.role}</div>
            <div style={{ fontSize: 12, color: 'var(--cb-text-muted)', lineHeight: 1.55 }}>{persona.description}</div>
          </div>
        </div>

        {/* Config grid */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 12, marginTop: 16, paddingTop: 16,
          borderTop: '1px solid var(--cb-border)',
          position: 'relative',
        }}>
          {persona.id === "bob" && <S.DevNote n={13} anchor="top-right" />}
          <div>
            <label className="oz-field-label">CLI</label>
            <select className="oz-select" value={persona.cli}
                    onChange={e => onChange({ ...persona, cli: e.target.value, model: "Default" })}>
              {clis.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="oz-field-label">Model</label>
            <select className="oz-select" value={persona.model}
                    onChange={e => onChange({ ...persona, model: e.target.value })}>
              {(cliEntry?.models || ["Default"]).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="oz-field-label">Run mode</label>
            <div style={{ display: 'flex', gap: 6, padding: 2, background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)' }}>
              {["visible", "headless"].map(m => (
                <button key={m} onClick={() => !isOz && onChange({ ...persona, runMode: m })}
                        disabled={isOz && m === "visible"}
                        style={{
                          flex: 1, padding: '6px 10px',
                          background: persona.runMode === m ? 'var(--cb-accent-muted)' : 'transparent',
                          color: persona.runMode === m ? 'var(--cb-accent)' : 'var(--cb-text-muted)',
                          border: 'none', borderRadius: 3,
                          fontSize: 11.5, fontWeight: persona.runMode === m ? 500 : 400,
                          cursor: isOz ? 'not-allowed' : 'pointer',
                          textTransform: 'capitalize',
                          opacity: isOz && m === "visible" ? 0.4 : 1,
                        }}>{m}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Sub-agents */}
        <div style={{ marginTop: 18, position: 'relative' }}>
          {persona.id === "bob" && <S.DevNote n={14} anchor="top-right" />}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'var(--cb-font-display)', fontSize: 9.5, letterSpacing: 1.5,
            textTransform: 'uppercase', color: 'var(--cb-text-muted)', marginBottom: 10,
          }}>
            <S.Icon name="tree-structure" size={12} />
            Sub-agents · {persona.subAgents.length}
            <button onClick={() => onAddSub(persona.id)} style={{
              marginLeft: 'auto', fontSize: 11, padding: '2px 8px',
              background: 'transparent', border: '1px solid var(--cb-border)',
              borderRadius: 3, color: 'var(--cb-text-muted)', cursor: 'pointer',
              fontFamily: 'var(--cb-font-body)', letterSpacing: 0,
              textTransform: 'none', fontWeight: 400,
            }}>+ Add</button>
          </div>
          {persona.subAgents.length === 0 ? (
            <div style={{
              padding: '10px 14px',
              background: 'var(--cb-bg-soft)',
              border: '1px dashed var(--cb-border)',
              borderRadius: 'var(--cb-radius-md)',
              fontSize: 11.5, color: 'var(--cb-text-muted)',
              textAlign: 'center',
            }}>
              No sub-agents. {persona.name} runs everything itself.
            </div>
          ) : (
            persona.subAgents.map(sa => {
              const subCli = clis.find(c => c.id === sa.cli);
              return (
                <div key={sa.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 1.5fr 1fr 1fr 30px',
                  gap: 10, alignItems: 'center',
                  padding: '10px 12px',
                  background: 'var(--cb-bg-soft)',
                  border: '1px solid var(--cb-border)',
                  borderRadius: 'var(--cb-radius-md)',
                  marginBottom: 6,
                }}>
                  <S.Icon name="git-fork" size={12} style={{ color: 'var(--cb-text-muted)', transform: 'rotate(180deg)' }} />
                  <input className="oz-input" value={sa.name}
                         style={{ padding: '5px 8px', fontSize: 12, background: 'transparent', border: 'none' }}
                         onChange={e => onUpdateSub(persona.id, sa.id, { ...sa, name: e.target.value })} />
                  <select className="oz-select" value={sa.cli}
                          style={{ padding: '5px 24px 5px 8px', fontSize: 11.5 }}
                          onChange={e => onUpdateSub(persona.id, sa.id, { ...sa, cli: e.target.value, model: "Default" })}>
                    {clis.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select className="oz-select" value={sa.model}
                          style={{ padding: '5px 24px 5px 8px', fontSize: 11.5 }}
                          onChange={e => onUpdateSub(persona.id, sa.id, { ...sa, model: e.target.value })}>
                    {(subCli?.models || ["Default"]).map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button className="oz-iconbtn" style={{ width: 24, height: 24 }}
                          onClick={() => onRemoveSub(persona.id, sa.id)}>
                    <S.Icon name="x" size={11} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Card>
  );
};

const PersonasScreen = ({ personas, clis, onChange, onAddSub, onRemoveSub, onUpdateSub, onNewPersonaAsPriority }) => {
  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <S.ScreenHeader
        title="Personas"
        subtitle="The AI team. Each persona has a CLI + model and may delegate work to sub-agents. Building a new persona becomes a priority for the team itself."
        actions={
          <div style={{ position: 'relative' }}>
            <S.DevNote n={15} anchor="top-right" />
            <S.Button variant="primary" icon="hammer" onClick={onNewPersonaAsPriority}>
              Craft a new persona
            </S.Button>
          </div>
        }
      />
      <div style={{ padding: '0 28px 24px', overflowY: 'auto', minHeight: 0 }}>
        {/* Note about crafting a persona */}
        <div style={{
          padding: '14px 16px',
          background: 'var(--cb-accent-subtle)',
          border: '1px solid var(--cb-accent-15)',
          borderRadius: 'var(--cb-radius-md)',
          marginBottom: 20,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <S.Icon name="lightbulb" size={18} style={{ color: 'var(--cb-accent)', marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500, marginBottom: 3 }}>
              New personas are built, not configured.
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--cb-text-secondary)', lineHeight: 1.55 }}>
              Sketch what the persona should do. Oz files it as a priority and the team scaffolds the new role — prompts, sub-agents, and tests included.
            </div>
          </div>
        </div>

        {personas.map(p => (
          <PersonaRow key={p.id} persona={p} clis={clis}
                      onChange={next => onChange(p.id, next)}
                      onAddSub={onAddSub} onRemoveSub={onRemoveSub}
                      onUpdateSub={onUpdateSub} />
        ))}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// SETTINGS
// ──────────────────────────────────────────────────────────────

const Toggle = ({ on, onChange }) => (
  <button onClick={() => onChange(!on)} style={{
    width: 38, height: 22, padding: 2,
    background: on ? 'var(--cb-accent)' : 'var(--cb-bg-soft)',
    border: `1px solid ${on ? 'var(--cb-accent)' : 'var(--cb-border)'}`,
    borderRadius: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center',
    transition: 'background 120ms ease-out',
  }}>
    <span style={{
      width: 16, height: 16, borderRadius: '50%',
      background: on ? 'var(--cb-text-on-accent)' : 'var(--cb-text-muted)',
      transform: on ? 'translateX(16px)' : 'translateX(0)',
      transition: 'transform 150ms ease-out',
    }}></span>
  </button>
);

const SettingsRow = ({ label, help, children }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '1fr auto',
    gap: 24, alignItems: 'center',
    padding: '16px 0',
    borderBottom: '1px solid var(--cb-border)',
  }}>
    <div>
      <div style={{ fontSize: 13, color: 'var(--cb-text)', fontWeight: 500, marginBottom: 3 }}>{label}</div>
      {help && <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', lineHeight: 1.55, maxWidth: 540 }}>{help}</div>}
    </div>
    <div>{children}</div>
  </div>
);

const SettingsScreen = ({ settings, clis, personas, dependencies, onRecheckDep, onChange }) => {
  const [tab, setTab] = useState("preferences");

  const update = (section, key, value) => {
    onChange({ ...settings, [section]: { ...settings[section], [key]: value } });
  };

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <S.ScreenHeader
        title="Settings"
        subtitle="Global preferences. Everything here applies across workspaces unless overridden."
      />
      <div style={{ padding: '0 28px 24px', overflow: 'hidden', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, minHeight: 0 }}>
        {/* Tab nav */}
        <div className="oz-panel" style={{ minHeight: 0 }}>
          <div className="oz-panel-body" style={{ padding: 8 }}>
            {[
              { id: "preferences", label: "Appearance", icon: "palette" },
              { id: "system", label: "System dependencies", icon: "hard-drives" },
              { id: "watching", label: "Watching & alerts", icon: "bell" },
              { id: "advanced", label: "Advanced", icon: "sliders" },
              { id: "about", label: "About", icon: "info" },
            ].map(t => (
              <div key={t.id} onClick={() => setTab(t.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px',
                background: tab === t.id ? 'var(--cb-accent-muted)' : 'transparent',
                border: tab === t.id ? '1px solid var(--cb-accent-15)' : '1px solid transparent',
                borderRadius: 'var(--cb-radius-md)',
                cursor: 'pointer',
                fontSize: 12.5,
                color: tab === t.id ? 'var(--cb-accent)' : 'var(--cb-text-secondary)',
                marginBottom: 2,
              }}>
                <S.Icon name={t.icon} size={14} />
                {t.label}
              </div>
            ))}
          </div>
        </div>

        <div className="oz-panel" style={{ minHeight: 0 }}>
          <div className="oz-panel-body" style={{ padding: '0 24px 24px' }}>
            {tab === "system" && (
              <>
                <div className="oz-section-marker lhs">
                  System dependencies
                </div>
                <div style={{ fontSize: 12, color: 'var(--cb-text-muted)', lineHeight: 1.6, marginBottom: 16, maxWidth: 600 }}>
                  System tools CoCoder needs on this machine. CLI auth lives on the <span style={{ color: 'var(--cb-accent)' }}>CLIs</span> screen.
                </div>
                <DependenciesPanel dependencies={dependencies} onRecheck={onRecheckDep} />
              </>
            )}

            {tab === "preferences" && (
              <>
                <div className="oz-section-marker lhs">Appearance</div>
                <SettingsRow label="Theme" help="Dark is the default. Light flips to warm linen.">
                  <div style={{ display: 'flex', gap: 6 }}>
                    {["dark", "light"].map(t => (
                      <button key={t}
                        onClick={() => update("preferences", "theme", t)}
                        style={{
                          padding: '7px 14px', fontSize: 12,
                          background: settings.preferences.theme === t ? 'var(--cb-accent-muted)' : 'var(--cb-bg-soft)',
                          color: settings.preferences.theme === t ? 'var(--cb-accent)' : 'var(--cb-text-muted)',
                          border: `1px solid ${settings.preferences.theme === t ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`,
                          borderRadius: 'var(--cb-radius-md)',
                          cursor: 'pointer', textTransform: 'capitalize',
                        }}>{t}</button>
                    ))}
                  </div>
                </SettingsRow>
                <SettingsRow label="Sound on Oz events" help="A subtle chime when a run completes or a decision lands.">
                  <Toggle on={settings.preferences.sound} onChange={v => update("preferences", "sound", v)} />
                </SettingsRow>
                <SettingsRow label="Send on Enter" help="Off makes Enter newline; ⌘+Enter sends.">
                  <Toggle on={settings.preferences.sendOnEnter} onChange={v => update("preferences", "sendOnEnter", v)} />
                </SettingsRow>
              </>
            )}

            {tab === "watching" && (
              <>
                <div className="oz-section-marker lhs">Notifications</div>
                <SettingsRow label="Decision needed" help="Oz needs a human call on a run.">
                  <Toggle on={settings.watching.notifyOnDecisionNeeded} onChange={v => update("watching", "notifyOnDecisionNeeded", v)} />
                </SettingsRow>
                <SettingsRow label="Run failed" help="A run halted with an error.">
                  <Toggle on={settings.watching.notifyOnRunFailed} onChange={v => update("watching", "notifyOnRunFailed", v)} />
                </SettingsRow>
                <SettingsRow label="Run complete" help="A run finished without intervention. Off by default — they get noisy.">
                  <Toggle on={settings.watching.notifyOnRunComplete} onChange={v => update("watching", "notifyOnRunComplete", v)} />
                </SettingsRow>
                <SettingsRow label="Desktop notifications" help="Show OS-level notifications.">
                  <Toggle on={settings.watching.desktopNotifications} onChange={v => update("watching", "desktopNotifications", v)} />
                </SettingsRow>
                <SettingsRow label="Slack webhook" help="Mirror Oz alerts to a Slack channel.">
                  <input className="oz-input" style={{ width: 320, fontFamily: 'var(--cb-font-mono)', fontSize: 11 }}
                         value={settings.watching.slackWebhook}
                         onChange={e => update("watching", "slackWebhook", e.target.value)}
                         placeholder="https://hooks.slack.com/services/…" />
                </SettingsRow>
              </>
            )}

            {tab === "advanced" && (
              <>
                <div className="oz-section-marker lhs">Advanced</div>
                <SettingsRow label="Transcript retention" help="Number of days Oz keeps run transcripts before pruning.">
                  <select className="oz-select" style={{ width: 120 }}
                          value={settings.advanced.transcriptRetention}
                          onChange={e => update("advanced", "transcriptRetention", parseInt(e.target.value))}>
                    {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </SettingsRow>
                <SettingsRow label="Auto-attach Oz to new runs" help="Oz watches every run by default. Off if you want explicit watchers.">
                  <Toggle on={settings.advanced.autoAttach} onChange={v => update("advanced", "autoAttach", v)} />
                </SettingsRow>
              </>
            )}

            {tab === "about" && (
              <>
                <div className="oz-section-marker lhs">About</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 0' }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: 'var(--cb-radius-md)',
                    background: 'var(--cb-accent-muted)',
                    border: '1px solid var(--cb-accent-15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--cb-accent)',
                  }}>
                    <S.Icon name="eye" size={28} />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--cb-font-display)', fontSize: 18, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--cb-text)', fontWeight: 600 }}>
                      Oz · CoCoder
                    </div>
                    <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 11, color: 'var(--cb-text-muted)', marginTop: 4 }}>
                      version 0.7.2 · build a7e3d91 · macOS 15.2 (Apple Silicon)
                    </div>
                  </div>
                </div>
                <SettingsRow label="Check for updates"><S.Button variant="secondary" icon="arrow-clockwise" size="sm">Check now</S.Button></SettingsRow>
                <SettingsRow label="Export workspace bundle"><S.Button variant="ghost" icon="download-simple" size="sm">Export…</S.Button></SettingsRow>
                <SettingsRow label="Diagnostics & logs"><S.Button variant="ghost" icon="file-text" size="sm">Open log</S.Button></SettingsRow>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, {
  WorkspacesScreen, CLIsScreen, PersonasScreen, SettingsScreen,
  CraftPersonaModal, NewWorkspaceModal,
  DependenciesPanel,
});
