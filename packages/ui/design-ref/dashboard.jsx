// Dashboard — the operator's home. Priorities | Oz terminal | Runs (with run-detail drawer).

const D = window;

// ───────── Priority row (draggable, run-aware) ─────────
const PriorityRow = ({ priority, index, onLaunch, onDrag, isDragging, isDropTarget, onSelectRun, runs, showDevPin9, selectedRunId }) => {
  const linkedRun = priority.runId ? runs.find(r => r.id === priority.runId) : null;
  const isRunning = linkedRun && (linkedRun.status === "running" || linkedRun.status === "blocked");
  const isBlocked = linkedRun && linkedRun.status === "blocked";
  const isSelected = linkedRun && linkedRun.id === selectedRunId;

  return (
    <div
      draggable
      onDragStart={(e) => onDrag("start", index, e)}
      onDragOver={(e) => { e.preventDefault(); onDrag("over", index, e); }}
      onDragEnd={(e) => onDrag("end", index, e)}
      onDrop={(e) => { e.preventDefault(); onDrag("drop", index, e); }}
      onClick={() => isRunning && onSelectRun(linkedRun.id)}
      style={{
        background: isSelected ? 'var(--cb-accent-muted)' : isRunning ? 'var(--cb-accent-subtle)' : 'var(--cb-surface-glass)',
        border: `1px solid ${isSelected ? 'var(--cb-accent)' : isBlocked ? 'rgba(212,118,110,0.30)' : isRunning ? 'var(--cb-accent-30)' : 'var(--cb-border)'}`,
        borderRight: isSelected ? '1px solid var(--cb-accent)' : undefined,
        borderRadius: isSelected ? 'var(--cb-radius-md) 0 0 var(--cb-radius-md)' : 'var(--cb-radius-md)',
        padding: '9px 10px',
        marginBottom: 8,
        marginRight: isSelected ? -17 : 0,
        paddingRight: isSelected ? 24 : 10,
        opacity: isDragging ? 0.4 : 1,
        boxShadow: isDropTarget ? '0 0 0 2px var(--cb-accent-30)' :
                    isSelected ? '0 4px 16px rgba(201,169,110,0.18)' : 'none',
        cursor: isRunning ? 'pointer' : 'grab',
        transition: 'box-shadow 120ms ease-out, background 120ms ease-out, margin-right 200ms ease-out, padding-right 200ms ease-out, border-radius 200ms ease-out',
        position: 'relative',
        zIndex: isSelected ? 5 : 1,
      }}
    >
      {/* Selected: notch arrow pointing into the run drawer */}
      {isSelected && (
        <div style={{
          position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%) rotate(45deg)',
          width: 14, height: 14,
          background: 'var(--cb-accent-muted)',
          borderTop: '1px solid var(--cb-accent)',
          borderRight: '1px solid var(--cb-accent)',
          zIndex: 6,
          pointerEvents: 'none',
        }}></div>
      )}
      {/* Running accent bar */}
      {isRunning && !isSelected && (
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: 3,
          background: isBlocked ? 'var(--cb-highlight)' : 'var(--cb-accent)',
          animation: isBlocked ? 'none' : 'ozPulse 1.8s infinite',
        }}></div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          paddingTop: 1,
        }}>
          <D.Icon name="dots-six-vertical" size={14} style={{ color: 'var(--cb-text-muted)', cursor: 'grab' }} />
          <span style={{
            fontFamily: 'var(--cb-font-mono)', fontSize: 10,
            color: index === 0 ? 'var(--cb-accent)' : 'var(--cb-text-muted)',
            minWidth: 18, textAlign: 'right',
          }}>{String(index + 1).padStart(2, '0')}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--cb-text)', lineHeight: 1.4, marginBottom: 4 }}>
            {priority.name}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', lineHeight: 1.5 }}>
            {priority.summary}
          </div>
        </div>
        <div className="oz-priority-actions">
          {linkedRun ? (
            <D.StatusChip status={linkedRun.status} />
          ) : (
            <D.StatusChip status={priority.status} label={priority.status === "ready" ? "Ready" : priority.status} />
          )}
          {!isRunning && (
            <D.Button variant="secondary" size="sm" icon="play" onClick={(e) => { e.stopPropagation(); onLaunch(priority); }}>
              Launch
            </D.Button>
          )}
        </div>
      </div>

      {/* Inline run summary — only when running */}
      {isRunning && (
        <div style={{
          marginTop: 10, marginLeft: 36,
          paddingTop: 10,
          borderTop: '1px solid var(--cb-border)',
          position: 'relative',
        }}>
          {showDevPin9 && <D.DevNote n={9} anchor="top-right" />}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: 6,
          }}>
            <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>
              {linkedRun.id} · {linkedRun.startedAt}
            </span>
            <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
              {linkedRun.personas.slice(0, 4).map(p => (
                <span key={p} style={{
                  fontSize: 9.5, fontFamily: 'var(--cb-font-mono)',
                  color: 'var(--cb-text-secondary)',
                  padding: '1px 5px', background: 'var(--cb-bg-soft)',
                  borderRadius: 2,
                }}>{p}</span>
              ))}
            </div>
          </div>
          <div style={{
            fontSize: 11.5, color: isBlocked ? 'var(--cb-highlight)' : 'var(--cb-text-secondary)',
            lineHeight: 1.5, marginBottom: 8,
            fontStyle: 'italic',
          }}>
            {isBlocked && <D.Icon name="warning-circle" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />}
            {linkedRun.lastEvent}
          </div>
          {linkedRun.progress != null && (
            <div style={{ height: 2, background: 'var(--cb-border)', borderRadius: 1, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${linkedRun.progress * 100}%`,
                background: isBlocked ? 'var(--cb-highlight)' : 'var(--cb-accent)',
                transition: 'width 300ms ease-out',
              }}></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ───────── Ad-hoc priority row (pinned at top, behaves like any priority) ─────────
const AdhocPriorityRow = ({ adhocRuns, onLaunch, onSelectRun, selectedRunId }) => {
  const activeCount = adhocRuns.filter(r => r.status === "running" || r.status === "blocked").length;
  const hasSelected = adhocRuns.some(r => r.id === selectedRunId);

  return (
    <div style={{
      background: hasSelected ? 'var(--cb-accent-muted)' : 'var(--cb-surface-glass)',
      border: `1px solid ${hasSelected ? 'var(--cb-accent)' : adhocRuns.length > 0 ? 'var(--cb-accent-30)' : 'var(--cb-border)'}`,
      borderRight: hasSelected ? '1px solid var(--cb-accent)' : undefined,
      borderRadius: hasSelected ? 'var(--cb-radius-md) 0 0 var(--cb-radius-md)' : 'var(--cb-radius-md)',
      padding: '9px 10px',
      marginBottom: 8,
      marginRight: hasSelected ? -17 : 0,
      paddingRight: hasSelected ? 24 : 10,
      position: 'relative',
      transition: 'all 200ms ease-out',
      boxShadow: hasSelected ? '0 4px 16px rgba(201,169,110,0.18)' : 'none',
      zIndex: hasSelected ? 5 : 1,
    }}>
      <D.DevNote n={4} anchor="top-right" />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 1 }}>
          <D.Icon name="push-pin" size={12} style={{ color: 'var(--cb-text-muted)' }} />
          <D.Icon name="lightning" size={14} style={{ color: 'var(--cb-accent)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--cb-text)', lineHeight: 1.4 }}>Ad-hoc</span>
            <span style={{
              fontFamily: 'var(--cb-font-mono)', fontSize: 9.5,
              color: 'var(--cb-text-muted)',
              padding: '1px 5px', background: 'var(--cb-bg-soft)',
              border: '1px solid var(--cb-border)',
              borderRadius: 2,
            }}>pinned</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', lineHeight: 1.5 }}>
            Refactors · code reviews · research · audits — work that doesn't fit a priority.
          </div>
        </div>
        <div className="oz-priority-actions">
          {activeCount > 0 ? (
            <span className="oz-chip oz-chip-running">
              <span className="dot"></span>{activeCount} active
            </span>
          ) : (
            <D.StatusChip status="ready" label="Ready" />
          )}
          <D.Button variant="secondary" size="sm" icon="play" onClick={(e) => { e.stopPropagation(); onLaunch(); }}>
            Launch run
          </D.Button>
        </div>
      </div>

      {/* Inline list of ad-hoc runs */}
      {adhocRuns.length > 0 && (
        <div style={{ marginTop: 10, marginLeft: 36, paddingTop: 10, borderTop: '1px solid var(--cb-border)' }}>
          {adhocRuns.map((r, idx) => {
            const isSel = r.id === selectedRunId;
            const isBlocked = r.status === "blocked";
            const isLive = r.status === "running" || r.status === "blocked";
            return (
              <div key={r.id} onClick={() => onSelectRun(r.id)} style={{
                padding: '8px 10px 8px 10px',
                background: isSel ? 'var(--cb-accent-15)' : 'transparent',
                border: `1px solid ${isSel ? 'var(--cb-accent-30)' : 'var(--cb-border)'}`,
                borderRadius: 'var(--cb-radius-sm)',
                marginBottom: idx === adhocRuns.length - 1 ? 0 : 6,
                cursor: 'pointer',
                transition: 'all 120ms ease-out',
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--cb-hover)'; }}
              onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}>
                {isLive && (
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: 2,
                    background: isBlocked ? 'var(--cb-highlight)' : 'var(--cb-accent)',
                    animation: isBlocked ? 'none' : 'ozPulse 1.8s infinite',
                  }}></div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <D.StatusChip status={r.status} />
                  <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{r.id}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{r.startedAt}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--cb-text)', fontWeight: 500, marginBottom: 4, lineHeight: 1.4 }}>
                  {r.title}
                </div>
                {r.lastEvent && (
                  <div style={{
                    fontSize: 11, color: isBlocked ? 'var(--cb-highlight)' : 'var(--cb-text-muted)',
                    lineHeight: 1.5, fontStyle: 'italic',
                  }}>
                    {r.lastEvent}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ───────── Priorities panel ─────────

// ───────── Priorities panel (now includes ad-hoc runs section) ─────────
const PrioritiesPanel = ({ priorities, runs, onReorder, onLaunch, onAdhoc, onAddPriority, onSelectRun, onOpenRunHistory, selectedRunId }) => {
  const [drag, setDrag] = useState({ from: null, over: null });

  const handleDrag = (type, index) => {
    if (type === "start") setDrag({ from: index, over: null });
    else if (type === "over") setDrag(d => ({ ...d, over: index }));
    else if (type === "drop") {
      if (drag.from !== null && drag.from !== index) onReorder(drag.from, index);
      setDrag({ from: null, over: null });
    } else if (type === "end") setDrag({ from: null, over: null });
  };

  const adhocRuns = runs.filter(r => !r.priorityId && (r.status === "running" || r.status === "blocked"));
  const totalRuns = runs.length;

  return (
    <div className="oz-panel oz-priorities-panel" style={{ height: '100%' }}>
      <D.DevNote n={3} anchor="top-right" />
      <div className="oz-panel-header">
        <D.Icon name="list-numbers" size={15} style={{ color: 'var(--cb-accent)' }} />
        <div className="oz-panel-title">Priorities</div>
        <span className="oz-panel-count">{priorities.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={onOpenRunHistory}
            title={`Run history (${totalRuns})`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 9px',
              background: 'transparent',
              border: '1px solid var(--cb-border)',
              borderRadius: 'var(--cb-radius-md)',
              color: 'var(--cb-text-muted)',
              fontSize: 11,
              fontFamily: 'var(--cb-font-body)',
              cursor: 'pointer',
              transition: 'all 120ms ease-out',
              position: 'relative',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--cb-accent)'; e.currentTarget.style.borderColor = 'var(--cb-accent-30)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--cb-text-muted)'; e.currentTarget.style.borderColor = 'var(--cb-border)'; }}
          >
            <D.DevNote n={16} anchor="bottom-right" />
            <D.Icon name="clock-counter-clockwise" size={12} />
            <span>Run history</span>
            <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{totalRuns}</span>
          </button>
          <button className="oz-iconbtn" title="Add priority" onClick={onAddPriority} style={{ width: 26, height: 26 }}>
            <D.Icon name="plus" size={13} />
          </button>
        </div>
      </div>

      <div className="oz-panel-body">
        {/* Ad-hoc — always-pinned priority */}
        <AdhocPriorityRow
          adhocRuns={runs.filter(r => !r.priorityId && (r.status === "running" || r.status === "blocked"))}
          onLaunch={onAdhoc}
          onSelectRun={onSelectRun}
          selectedRunId={selectedRunId}
        />

        {priorities.length === 0 ? (
          <div className="oz-empty" style={{ padding: '32px 16px' }}>
            <div className="oz-empty-icon" style={{ width: 44, height: 44 }}><D.Icon name="list-numbers" size={22} /></div>
            <div className="oz-empty-title">Nothing queued</div>
            <div className="oz-empty-body">
              Ask Oz to draft your first priority, or add one yourself.
            </div>
            <D.Button variant="secondary" size="sm" icon="plus" onClick={onAddPriority}>Add priority</D.Button>
          </div>
        ) : (
          <>
            <div style={{
              fontFamily: 'var(--cb-font-mono)', fontSize: 9.5,
              color: 'var(--cb-text-muted)', letterSpacing: 0.5,
              padding: '4px 4px 8px',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>QUEUE · ↑ TOP = NEXT UP</span>
              <span style={{ flex: 1, height: 1, background: 'var(--cb-border)' }}></span>
            </div>
            {priorities.map((p, i) => (
              <PriorityRow
                key={p.id}
                priority={p} index={i}
                onLaunch={onLaunch}
                onSelectRun={onSelectRun}
                onDrag={handleDrag}
                isDragging={drag.from === i}
                isDropTarget={drag.over === i && drag.from !== i}
                runs={runs}
                selectedRunId={selectedRunId}
                showDevPin9={i === 0 && p.runId && runs.find(r => r.id === p.runId && (r.status === "running" || r.status === "blocked"))}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

// ───────── Oz chat: message ─────────
const ChatMessage = ({ msg, runs, onSelectRun, onDecision }) => {
  const isOz = msg.role === "oz";
  const isUser = msg.role === "user";
  const roleLabel = isOz ? "Oz" : isUser ? "You" : msg.role;
  const roleColor = isOz ? 'var(--cb-accent)' : isUser ? 'var(--cb-text)' : 'var(--cb-text-secondary)';

  return (
    <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--cb-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          fontFamily: 'var(--cb-font-display)', fontSize: 10, letterSpacing: 1.5,
          textTransform: 'uppercase', color: roleColor, fontWeight: 600,
        }}>{roleLabel}</span>
        {isOz && <span style={{
          fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)',
          padding: '1px 6px', border: '1px solid var(--cb-border)', borderRadius: 2,
        }}>orchestrator · headless</span>}
        <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)', marginLeft: 'auto' }}>
          {msg.time}
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--cb-text)', lineHeight: 1.65, paddingLeft: 0 }}
           dangerouslySetInnerHTML={{ __html: msg.body.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--cb-text);font-weight:600">$1</strong>') }} />

      {/* Inline run cards */}
      {msg.attachments && msg.attachments.map((a, i) => {
        if (a.kind === "run-card") {
          const run = runs.find(r => r.id === a.runId);
          if (!run) return null;
          return (
            <div key={i} onClick={() => onSelectRun(run.id)} style={{
              marginTop: 10,
              padding: 12,
              background: 'var(--cb-bg-soft)',
              border: '1px solid var(--cb-border)',
              borderRadius: 'var(--cb-radius-md)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12,
              transition: 'border-color 120ms ease-out',
              position: 'relative',
            }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--cb-accent-30)'}
               onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--cb-border)'}>
              <D.DevNote n={7} anchor="top-right" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <D.StatusChip status={run.status} />
                  <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{run.id}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500 }}>{run.title}</div>
                <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', marginTop: 3 }}>
                  {run.personas.join(' · ')} · started {run.startedAt}
                </div>
              </div>
              <D.Icon name="arrow-right" size={14} style={{ color: 'var(--cb-text-muted)' }} />
            </div>
          );
        }
        return null;
      })}

      {/* Decision callout */}
      {msg.flag === "decision" && (
        <div style={{
          marginTop: 12, padding: '12px 14px',
          background: 'var(--cb-highlight-muted)',
          border: '1px solid rgba(212,118,110,0.20)',
          borderRadius: 'var(--cb-radius-md)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          position: 'relative',
        }}>
          <D.DevNote n={6} anchor="top-right" />
          <D.Icon name="warning-circle" size={18} style={{ color: 'var(--cb-highlight)' }} />
          <div style={{ fontSize: 12, color: 'var(--cb-highlight)', flex: 1, minWidth: 200 }}>
            Oz is waiting for your call before run-1 can continue.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <D.Button variant="secondary" size="sm" onClick={() => onDecision("full")}>Replay full plan</D.Button>
            <D.Button variant="ghost" size="sm" onClick={() => onDecision("partial")}>Partial</D.Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ───────── Oz chat panel ─────────
const QUICK_PROMPTS = [
  { label: "Status check", prompt: "Status across the workspace?" },
  { label: "Launch next priority", prompt: "Launch the next priority." },
  { label: "Ad-hoc run", prompt: "Run an ad-hoc " },
  { label: "Reorder priorities", prompt: "Promote #4 to the top." },
];

const OzChatPanel = ({ messages, runs, workspaceName, onSend, onSelectRun, onDecision, ozTyping }) => {
  const [text, setText] = useState("");
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages.length, ozTyping]);

  const send = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <div className="oz-panel" style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* Decorative corner accents */}
      <div style={{ position: 'absolute', top: -1, left: -1, width: 14, height: 14, borderTop: '1px solid var(--cb-accent)', borderLeft: '1px solid var(--cb-accent)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -1, right: -1, width: 14, height: 14, borderBottom: '1px solid var(--cb-accent)', borderRight: '1px solid var(--cb-accent)', pointerEvents: 'none' }} />

      <div className="oz-panel-header" style={{ padding: '14px 24px' }}>
        <D.DevNote n={5} anchor="top-right" />
        <D.Icon name="eye" size={16} style={{ color: 'var(--cb-accent)' }} />
        <div style={{ position: 'relative' }}>
          <D.DevNote n={17} anchor="top-left" />
          <div style={{ fontFamily: 'var(--cb-font-display)', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--cb-text)', fontWeight: 600 }}>
            Oz Terminal
          </div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)', marginTop: 2 }}>
            headless oz · bound to <span style={{ color: 'var(--cb-accent)' }}>{workspaceName}</span>
          </div>
        </div>
        <span className="oz-chip oz-chip-running" style={{ marginLeft: 'auto' }}>
          <span className="dot"></span>watching
        </span>
        <button className="oz-iconbtn" title="Conversation menu" style={{ width: 28, height: 28 }}>
          <D.Icon name="dots-three" size={14} />
        </button>
      </div>

      <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {messages.map(m => (
          <ChatMessage key={m.id} msg={m} runs={runs} onSelectRun={onSelectRun} onDecision={onDecision} />
        ))}
        {ozTyping && (
          <div style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--cb-font-display)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-accent)', fontWeight: 600 }}>Oz</span>
            <span style={{ display: 'inline-flex', gap: 3 }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: 'var(--cb-accent)',
                  opacity: 0.5,
                  animation: `ozPulse 1.2s ${i * 0.15}s infinite`,
                }}></span>
              ))}
            </span>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ borderTop: '1px solid var(--cb-border)', padding: '12px 24px 14px' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', position: 'relative' }}>
          <D.DevNote n={8} anchor="top-right" />
          {QUICK_PROMPTS.map(qp => (
            <button key={qp.label}
              onClick={() => setText(qp.prompt)}
              style={{
                background: 'var(--cb-bg-soft)',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text-secondary)',
                padding: '4px 10px',
                borderRadius: 'var(--cb-radius-pill)',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'var(--cb-font-body)',
                transition: 'all 120ms ease-out',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--cb-accent-15)'; e.currentTarget.style.color = 'var(--cb-accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--cb-border)'; e.currentTarget.style.color = 'var(--cb-text-secondary)'; }}
            >{qp.label}</button>
          ))}
        </div>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 10,
          background: 'var(--cb-bg-soft)',
          border: '1px solid var(--cb-border)',
          borderRadius: 'var(--cb-radius-md)',
          padding: '10px 12px',
        }}>
          <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12, color: 'var(--cb-accent)', userSelect: 'none' }}>›</span>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Tell Oz what to do — launch a run, reorder, ask for status…"
            rows={1}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              color: 'var(--cb-text)', resize: 'none',
              fontFamily: 'var(--cb-font-body)', fontSize: 13.5, lineHeight: 1.5,
              maxHeight: 120,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="oz-iconbtn" style={{ width: 28, height: 28 }} title="Attach"><D.Icon name="paperclip" size={13} /></button>
            <button
              onClick={send}
              className="oz-btn oz-btn-primary oz-btn-sm"
              style={{ padding: '6px 10px' }}
              disabled={!text.trim()}
            >
              <D.Icon name="paper-plane-tilt" size={13} />
              Send
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>
          <span><span className="oz-kbd" style={{ fontSize: 9 }}>⏎</span> send</span>
          <span><span className="oz-kbd" style={{ fontSize: 9 }}>⇧⏎</span> new line</span>
          <span style={{ marginLeft: 'auto' }}>oz model: claude opus 4.5 · ctx 28k / 200k</span>
        </div>
      </div>
    </div>
  );
};

// ───────── Runs panel (right column) ─────────
const RunCard = ({ run, selected, onClick }) => {
  return (
    <div onClick={onClick} style={{
      padding: 12,
      marginBottom: 8,
      background: selected ? 'var(--cb-accent-muted)' : 'var(--cb-surface-glass)',
      border: `1px solid ${selected ? 'var(--cb-accent-30)' : 'var(--cb-border)'}`,
      borderRadius: 'var(--cb-radius-md)',
      cursor: 'pointer',
      transition: 'all 120ms ease-out',
    }}
    onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--cb-border-strong)'; }}
    onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--cb-border)'; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <D.StatusChip status={run.status} />
        <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{run.id}</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{run.startedAt}</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500, lineHeight: 1.4, marginBottom: 6 }}>
        {run.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {run.personas.map(p => (
          <span key={p} style={{
            fontSize: 10, fontFamily: 'var(--cb-font-mono)',
            color: 'var(--cb-text-muted)',
            padding: '1px 5px', background: 'var(--cb-bg-soft)',
            borderRadius: 2, border: '1px solid var(--cb-border)',
          }}>{p}</span>
        ))}
      </div>
      {(run.status === "running" || run.status === "blocked") && run.progress != null && (
        <div style={{ marginTop: 9, height: 2, background: 'var(--cb-border)', borderRadius: 1, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${run.progress * 100}%`,
            background: run.status === "blocked" ? 'var(--cb-highlight)' : 'var(--cb-accent)',
            transition: 'width 300ms ease-out',
          }}></div>
        </div>
      )}
    </div>
  );
};

const RunsPanel = ({ runs, selectedRunId, onSelectRun }) => {
  const active = runs.filter(r => r.status === "running" || r.status === "blocked");
  const recent = runs.filter(r => r.status !== "running" && r.status !== "blocked");

  return (
    <div className="oz-panel" style={{ height: '100%' }}>
      <D.DevNote n={9} anchor="top-right" />
      <div className="oz-panel-header">
        <D.Icon name="play-circle" size={15} style={{ color: 'var(--cb-accent)' }} />
        <div className="oz-panel-title">Runs</div>
        <span className="oz-panel-count">{runs.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button className="oz-iconbtn" title="Filter" style={{ width: 26, height: 26 }}>
            <D.Icon name="funnel" size={12} />
          </button>
        </div>
      </div>
      <div className="oz-panel-body">
        {runs.length === 0 ? (
          <div className="oz-empty" style={{ padding: '32px 16px' }}>
            <div className="oz-empty-icon" style={{ width: 44, height: 44 }}><D.Icon name="play-circle" size={22} /></div>
            <div className="oz-empty-title">No runs yet</div>
            <div className="oz-empty-body">Launch a priority or kick off an ad-hoc task.</div>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <>
                <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, padding: '2px 4px 8px' }}>
                  ACTIVE · {active.length}
                </div>
                {active.map(r => (
                  <RunCard key={r.id} run={r} selected={selectedRunId === r.id} onClick={() => onSelectRun(r.id)} />
                ))}
              </>
            )}
            {recent.length > 0 && (
              <>
                <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, padding: '14px 4px 8px' }}>
                  RECENT · {recent.length}
                </div>
                {recent.map(r => (
                  <RunCard key={r.id} run={r} selected={selectedRunId === r.id} onClick={() => onSelectRun(r.id)} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ───────── Run detail drawer ─────────
const RunDetail = ({ run, parentPriority, parentPriorityIndex, onClose, onAction }) => {
  const [tab, setTab] = useState("transcript");
  if (!run) return null;
  const isLive = run.status === "running" || run.status === "blocked";

  return (
    <div className="oz-panel" style={{
      height: '100%',
      animation: 'ozSlideIn 250ms ease-out',
      borderLeft: '2px solid var(--cb-accent)',
      position: 'relative',
    }}>
      <D.DevNote n={10} anchor="top-right" />

      {/* Priority context strip — the handoff cue */}
      <div style={{
        padding: '10px 20px',
        background: 'var(--cb-accent-muted)',
        borderBottom: '1px solid var(--cb-accent-15)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        {parentPriority ? (
          <>
            <span style={{
              fontFamily: 'var(--cb-font-mono)', fontSize: 10,
              color: 'var(--cb-accent)', letterSpacing: 0.5,
              padding: '2px 6px',
              background: 'var(--cb-accent-15)',
              borderRadius: 2, fontWeight: 600,
            }}>P{String(parentPriorityIndex + 1).padStart(2, '0')}</span>
            <D.Icon name="arrow-right" size={11} style={{ color: 'var(--cb-accent)', opacity: 0.6 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, marginBottom: 1 }}>
                PRIORITY · RUN OF
              </div>
              <div style={{ fontSize: 12, color: 'var(--cb-text)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {parentPriority.name}
              </div>
            </div>
          </>
        ) : (
          <>
            <D.Icon name="lightning" size={13} style={{ color: 'var(--cb-accent)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, marginBottom: 1 }}>
                AD-HOC
              </div>
              <div style={{ fontSize: 12, color: 'var(--cb-text)', fontWeight: 500 }}>
                No parent priority
              </div>
            </div>
          </>
        )}
      </div>

      <div className="oz-panel-header" style={{ padding: '14px 20px' }}>
        <D.StatusChip status={run.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: 'var(--cb-text)', fontWeight: 500, lineHeight: 1.3 }}>
            {run.title}
          </div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)', marginTop: 3 }}>
            {run.id} · started {run.startedAt} · cli: {run.cli}
          </div>
        </div>
        <button className="oz-iconbtn" onClick={onClose} title="Close"><D.Icon name="x" size={14} /></button>
      </div>

      {/* Meta strip */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--cb-border)',
        display: 'flex', flexWrap: 'wrap', gap: 16,
        background: 'var(--cb-bg-soft)',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, marginBottom: 3 }}>PERSONAS</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {run.personas.map(p => (
              <span key={p} style={{
                fontSize: 11, color: 'var(--cb-text)',
                padding: '2px 8px', background: 'var(--cb-accent-muted)',
                border: '1px solid var(--cb-accent-15)',
                color: 'var(--cb-accent)',
                borderRadius: 2, fontWeight: 500,
              }}>{p}</span>
            ))}
          </div>
        </div>
        {run.progress != null && (
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, marginBottom: 3 }}>
              PROGRESS · <span style={{ color: 'var(--cb-text)' }}>{Math.round(run.progress * 100)}%</span>
            </div>
            <div style={{ height: 3, background: 'var(--cb-border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${run.progress * 100}%`,
                background: run.status === "blocked" ? 'var(--cb-highlight)' : run.status === "failed" ? 'var(--cb-highlight)' : 'var(--cb-accent)',
              }}></div>
            </div>
          </div>
        )}
        <div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', letterSpacing: 0.5, marginBottom: 3 }}>WATCHED BY</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--cb-text)' }}>
            <D.Icon name="eye" size={13} style={{ color: 'var(--cb-accent)' }} />
            Oz
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--cb-border)', padding: '0 20px' }}>
        {[
          { id: "transcript", label: "Transcript", icon: "chat-text" },
          { id: "evidence", label: `Evidence (${(run.evidence || []).length})`, icon: "file-text" },
          { id: "session", label: "Attach", icon: "terminal-window" },
        ].map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 14px',
            fontSize: 11.5,
            fontFamily: 'var(--cb-font-body)',
            color: tab === t.id ? 'var(--cb-accent)' : 'var(--cb-text-muted)',
            borderBottom: `2px solid ${tab === t.id ? 'var(--cb-accent)' : 'transparent'}`,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: -1,
            fontWeight: tab === t.id ? 500 : 400,
          }}>
            <D.Icon name={t.icon} size={13} />
            {t.label}
          </div>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tab === "transcript" && (
          <div style={{ padding: '8px 20px 16px', fontFamily: 'var(--cb-font-mono)', fontSize: 11.5, lineHeight: 1.7, position: 'relative' }}>
            <D.DevNote n={11} anchor="top-right" />
            <div style={{ color: 'var(--cb-text-muted)', padding: '8px 0' }}>
              {/* External terminal disclaimer */}
              <D.Icon name="info" size={12} /> read-only window — session runs externally in iterm
            </div>
            {(run.transcript || []).map((line, i) => {
              const isSystem = line.role === "system";
              const roleColor = isSystem ? 'var(--cb-text-muted)' :
                                line.role === "Oz" ? 'var(--cb-accent)' :
                                line.role === "Builder" ? 'var(--cb-success)' :
                                line.role === "Reviewer" ? 'var(--cb-highlight)' :
                                'var(--cb-text-secondary)';
              return (
                <div key={i} style={{ marginBottom: 10, display: 'flex', gap: 12 }}>
                  <span style={{
                    color: roleColor, minWidth: 80,
                    fontWeight: 500,
                    fontFamily: 'var(--cb-font-mono)',
                    fontSize: 10.5, paddingTop: 2,
                  }}>{isSystem ? "system" : line.role.toLowerCase()}</span>
                  <span style={{
                    color: isSystem ? 'var(--cb-text-muted)' : 'var(--cb-text)',
                    fontStyle: isSystem ? 'italic' : 'normal',
                    fontFamily: 'var(--cb-font-body)', fontSize: 12.5, lineHeight: 1.6,
                  }}>{line.body}</span>
                </div>
              );
            })}
            {isLive && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, color: 'var(--cb-accent)' }}>
                <span style={{ width: 6, height: 6, background: 'var(--cb-accent)', borderRadius: '50%', animation: 'ozPulse 1.6s infinite' }}></span>
                <span style={{ fontSize: 11, fontFamily: 'var(--cb-font-mono)' }}>streaming…</span>
              </div>
            )}
          </div>
        )}

        {tab === "evidence" && (
          <div style={{ padding: '12px 20px' }}>
            {(run.evidence || []).length === 0 ? (
              <div className="oz-empty"><div className="oz-empty-body">No evidence yet.</div></div>
            ) : (
              run.evidence.map((e, i) => {
                const iconName = e.kind === "diff" ? "git-diff" :
                                 e.kind === "pr" ? "git-pull-request" :
                                 e.kind === "error" ? "warning-circle" : "note";
                const accentColor = e.kind === "error" ? 'var(--cb-highlight)' :
                                    e.kind === "pr" ? 'var(--cb-success)' : 'var(--cb-accent)';
                return (
                  <div key={i} style={{
                    padding: 12, marginBottom: 8,
                    background: 'var(--cb-bg-soft)',
                    border: '1px solid var(--cb-border)',
                    borderRadius: 'var(--cb-radius-md)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: e.body ? 6 : 0 }}>
                      <D.Icon name={iconName} size={14} style={{ color: accentColor }} />
                      <span style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500 }}>{e.label}</span>
                      {e.lines && <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)', marginLeft: 'auto' }}>{e.lines}</span>}
                    </div>
                    {e.body && <div style={{ fontSize: 12, color: 'var(--cb-text-secondary)', lineHeight: 1.6 }}>{e.body}</div>}
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === "session" && (
          <div style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--cb-text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
              The orchestration session runs in iTerm. Copy the attach command to drop into the live shell.
              {' '}<span style={{ color: 'var(--cb-text-muted)' }}>Embedded terminal coming in v2.</span>
            </div>
            <div style={{
              fontFamily: 'var(--cb-font-mono)', fontSize: 12,
              background: 'var(--cb-bg)', border: '1px solid var(--cb-border)',
              padding: '12px 14px', borderRadius: 'var(--cb-radius-md)',
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
            }}>
              <span style={{ color: 'var(--cb-accent)' }}>$</span>
              <span style={{ flex: 1, color: 'var(--cb-text)' }}>{run.attachCmd || `cocoder attach ${run.id}`}</span>
              <button className="oz-iconbtn" style={{ width: 28, height: 28 }} title="Copy"><D.Icon name="copy" size={13} /></button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <D.Button variant="secondary" size="sm" icon="terminal-window">Open in iTerm</D.Button>
              <D.Button variant="ghost" size="sm" icon="copy">Copy command</D.Button>
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div style={{ borderTop: '1px solid var(--cb-border)', padding: '12px 20px', display: 'flex', gap: 8 }}>
        {isLive ? (
          <>
            <D.Button variant="destructive" size="sm" icon="stop" onClick={() => onAction("stop", run.id)}>Stop run</D.Button>
            <D.Button variant="ghost" size="sm" icon="terminal-window" onClick={() => onAction("attach", run.id)}>Attach</D.Button>
            <D.Button variant="ghost" size="sm" icon="chat-circle-text" onClick={() => onAction("ask-oz", run.id)} style={{ marginLeft: 'auto' }}>Ask Oz</D.Button>
          </>
        ) : run.status === "failed" ? (
          <>
            <D.Button variant="secondary" size="sm" icon="arrow-clockwise" onClick={() => onAction("retry", run.id)}>Retry</D.Button>
            <D.Button variant="ghost" size="sm" icon="chat-circle-text" onClick={() => onAction("ask-oz", run.id)}>Ask Oz why</D.Button>
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--cb-text-muted)' }}>
              Last event: {run.lastEvent}
            </div>
          </>
        ) : (
          <>
            <D.Button variant="ghost" size="sm" icon="arrow-clockwise" onClick={() => onAction("retry", run.id)}>Re-run</D.Button>
            <D.Button variant="ghost" size="sm" icon="chat-circle-text" onClick={() => onAction("ask-oz", run.id)} style={{ marginLeft: 'auto' }}>Ask Oz</D.Button>
          </>
        )}
      </div>
    </div>
  );
};

// ───────── Run history modal ─────────
const RunHistoryModal = ({ open, onClose, runs, onSelectRun, priorities }) => {
  const [filter, setFilter] = useState("all");
  if (!open) return null;

  const filtered = runs.filter(r => {
    if (filter === "all") return true;
    if (filter === "active") return r.status === "running" || r.status === "blocked";
    if (filter === "complete") return r.status === "complete";
    if (filter === "failed") return r.status === "failed" || r.status === "stopped";
    return true;
  });
  const counts = {
    all: runs.length,
    active: runs.filter(r => r.status === "running" || r.status === "blocked").length,
    complete: runs.filter(r => r.status === "complete").length,
    failed: runs.filter(r => r.status === "failed" || r.status === "stopped").length,
  };

  return (
    <D.Modal
      open={open} onClose={onClose}
      title="Run history"
      subtitle="Every run in this workspace, ordered by recency. Click a run to open its detail."
      icon="clock-counter-clockwise"
      width={820}
    >
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, padding: 2, background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', alignSelf: 'flex-start', width: 'fit-content' }}>
        {[
          { id: "all", label: "All" },
          { id: "active", label: "Active" },
          { id: "complete", label: "Complete" },
          { id: "failed", label: "Failed / stopped" },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '5px 12px',
            fontSize: 11.5,
            background: filter === f.id ? 'var(--cb-accent-muted)' : 'transparent',
            color: filter === f.id ? 'var(--cb-accent)' : 'var(--cb-text-muted)',
            border: 'none', borderRadius: 3,
            cursor: 'pointer',
            fontFamily: 'var(--cb-font-body)',
            fontWeight: filter === f.id ? 500 : 400,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {f.label}
            <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, opacity: 0.7 }}>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="oz-empty" style={{ padding: '32px 0' }}>
          <div className="oz-empty-icon" style={{ width: 44, height: 44 }}><D.Icon name="clock-counter-clockwise" size={22} /></div>
          <div className="oz-empty-title">No runs match</div>
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--cb-border)' }}>
          {filtered.map(run => {
            const parentPriority = run.priorityId ? priorities.find(p => p.id === run.priorityId) : null;
            return (
              <div
                key={run.id}
                onClick={() => { onSelectRun(run.id); onClose(); }}
                style={{
                  padding: '12px 4px',
                  borderBottom: '1px solid var(--cb-border)',
                  cursor: 'pointer',
                  display: 'grid', gridTemplateColumns: '110px 1fr 120px 100px 20px',
                  gap: 16, alignItems: 'center',
                  transition: 'background 120ms ease-out',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--cb-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <D.StatusChip status={run.status} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500, lineHeight: 1.4 }}>
                    {run.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', marginTop: 3 }}>
                    {parentPriority ? <>priority · <span style={{ color: 'var(--cb-text-secondary)' }}>{parentPriority.name}</span></> : <span style={{ color: 'var(--cb-accent)' }}>ad-hoc</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {run.personas.slice(0, 3).map(p => (
                    <span key={p} style={{
                      fontSize: 9.5, fontFamily: 'var(--cb-font-mono)',
                      color: 'var(--cb-text-secondary)',
                      padding: '1px 5px', background: 'var(--cb-bg-soft)',
                      borderRadius: 2, border: '1px solid var(--cb-border)',
                    }}>{p}</span>
                  ))}
                </div>
                <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)', textAlign: 'right' }}>
                  {run.startedAt}
                </div>
                <D.Icon name="arrow-right" size={12} style={{ color: 'var(--cb-text-muted)' }} />
              </div>
            );
          })}
        </div>
      )}
    </D.Modal>
  );
};

// ───────── Dashboard root ─────────
const Dashboard = ({
  workspace, priorities, runs, ozMessages,
  selectedRunId, setSelectedRunId,
  onReorder, onLaunch, onAdhoc, onAddPriority,
  onSend, onDecision, onRunAction,
  ozTyping,
  emptyState,
  runHistoryOpen, setRunHistoryOpen,
}) => {
  const selectedRun = selectedRunId ? runs.find(r => r.id === selectedRunId) : null;

  // Empty state: workspace has nothing configured yet
  if (emptyState === "first-run") {
    return (
      <div style={{ height: '100%', overflow: 'hidden', padding: 24, display: 'grid', placeItems: 'center' }}>
        <Card style={{ padding: 36, maxWidth: 540, textAlign: 'center', position: 'relative' }}>
          <div style={{ position: 'absolute', top: -1, left: -1, width: 16, height: 16, borderTop: '1px solid var(--cb-accent)', borderLeft: '1px solid var(--cb-accent)' }} />
          <div style={{ position: 'absolute', bottom: -1, right: -1, width: 16, height: 16, borderBottom: '1px solid var(--cb-accent)', borderRight: '1px solid var(--cb-accent)' }} />
          <D.Icon name="cube" size={40} style={{ color: 'var(--cb-accent)', marginBottom: 16 }} />
          <h1 style={{ margin: 0, fontFamily: 'var(--cb-font-display)', fontSize: 18, letterSpacing: 1.8, textTransform: 'uppercase', color: 'var(--cb-text)', fontWeight: 600 }}>
            Welcome to CoCoder
          </h1>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 11, color: 'var(--cb-accent)', letterSpacing: 0.5, marginTop: 6, marginBottom: 24 }}>
            FIRST-RUN SETUP · 4 steps
          </div>
          <div style={{ textAlign: 'left', marginBottom: 24 }}>
            {[
              { n: 1, t: "Install system dependencies", body: "iTerm2 and cmux. CoCoder runs orchestration sessions inside these.", done: false, current: true },
              { n: 2, t: "Register a CLI", body: "Add at least one coding CLI (Claude Code, Codex, Cursor-agent) and authenticate it.", done: false },
              { n: 3, t: "Create your workspace", body: "Name it. Describe it. This becomes the context Oz holds.", done: false },
              { n: 4, t: "Add root folders", body: "One primary repo, plus any reference roots.", done: false },
              { n: 5, t: "Assign personas", body: "Pick the team. Oz is set up by default.", done: false },
            ].map(s => (
              <div key={s.n} style={{
                display: 'flex', alignItems: 'flex-start', gap: 14, padding: '12px 0',
                borderBottom: '1px solid var(--cb-border)',
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: s.current ? 'var(--cb-accent)' : 'var(--cb-bg-soft)',
                  color: s.current ? 'var(--cb-text-on-accent)' : 'var(--cb-text-muted)',
                  border: '1px solid var(--cb-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--cb-font-mono)', fontSize: 11, fontWeight: 600,
                  flexShrink: 0,
                }}>{s.n}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--cb-text)', fontWeight: 500 }}>{s.t}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', marginTop: 3, lineHeight: 1.5 }}>{s.body}</div>
                </div>
                {s.current && <D.Icon name="arrow-right" size={14} style={{ color: 'var(--cb-accent)', marginTop: 6 }} />}
              </div>
            ))}
          </div>
          <D.Button variant="primary" icon="plus">Begin setup</D.Button>
        </Card>
      </div>
    );
  }

  return (
    <>
    <div style={{
      display: 'grid',
      gridTemplateColumns: selectedRun ? '380px 460px 1fr' : '380px 1fr',
      gap: 16,
      padding: 16,
      height: '100%',
      overflow: 'hidden',
      transition: 'grid-template-columns 250ms ease-out',
    }}>
      <PrioritiesPanel
        priorities={priorities}
        runs={runs}
        onReorder={onReorder}
        onLaunch={onLaunch}
        onAdhoc={onAdhoc}
        onAddPriority={onAddPriority}
        onSelectRun={setSelectedRunId}
        onOpenRunHistory={() => setRunHistoryOpen(true)}
        selectedRunId={selectedRunId}
      />
      {selectedRun && (
        <RunDetail
          run={selectedRun}
          parentPriority={selectedRun.priorityId ? priorities.find(p => p.id === selectedRun.priorityId) : null}
          parentPriorityIndex={selectedRun.priorityId ? priorities.findIndex(p => p.id === selectedRun.priorityId) : -1}
          onClose={() => setSelectedRunId(null)}
          onAction={onRunAction}
        />
      )}
      <OzChatPanel
        messages={ozMessages}
        runs={runs}
        workspaceName={workspace.name}
        onSend={onSend}
        onSelectRun={setSelectedRunId}
        onDecision={onDecision}
        ozTyping={ozTyping}
      />
    </div>
    <RunHistoryModal
      open={runHistoryOpen}
      onClose={() => setRunHistoryOpen(false)}
      runs={runs}
      priorities={priorities}
      onSelectRun={setSelectedRunId}
    />
    </>
  );
};

Object.assign(window, {
  Dashboard, OzChatPanel, RunsPanel, RunDetail, PrioritiesPanel, RunHistoryModal,
});
