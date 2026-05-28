// Oz — App root. State, routing, Oz chat simulation, Tweaks wiring.

const { useState, useEffect, useRef, useMemo, useCallback } = React;
const A = window;

// ───────── Default tweaks ─────────
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "comfortable",
  "workspaceState": "configured",
  "devMode": false,
  "showInlineFlows": false
}/*EDITMODE-END*/;

// ───────── Tiny Oz bot ─────────
function buildOzReply(userText, ctx) {
  const t = userText.toLowerCase();
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const runs = ctx.runs;
  const activeCount = runs.filter(r => r.status === "running" || r.status === "blocked").length;

  if (/^status|how.*we doing|what.*going on/.test(t)) {
    return {
      role: "oz",
      body: `**Workspace status:** ${activeCount} active run${activeCount === 1 ? '' : 's'} · ${ctx.priorities.length} priorities queued. Run-1 is blocked on your call about replay scope. Run-2 (ad-hoc audit) is also waiting on a Grok question.`,
      time,
    };
  }
  if (/launch.*next|launch.*top|launch the next/.test(t)) {
    const next = ctx.priorities[0];
    if (!next) return { role: "oz", body: "Nothing on the priority list. Want to draft one?", time };
    return {
      role: "oz",
      body: `Launching **${next.name}**. Spinning up Planner → Builder → Reviewer on claude-code. Visible mode (iTerm).`,
      time,
      attachments: [{ kind: "queued-run", priorityId: next.id, title: next.name }],
    };
  }
  if (/ad-?hoc|review|refactor|audit|investigate/.test(t)) {
    return {
      role: "oz",
      body: `Drafting an ad-hoc run for that. Recommended team: Reviewer + Researcher. Approve?`,
      time,
    };
  }
  if (/reorder|promote|move .* to (top|first)/.test(t)) {
    const m = t.match(/#?(\d+)/);
    return {
      role: "oz",
      body: m ? `Moved priority #${m[1]} to the top. Run order updated.` : "Got it — which priority would you like to promote? Send `promote #4` or drag it in the list.",
      time,
    };
  }
  if (/decision|full plan|partial/.test(t) || t === "full" || t === "partial") {
    const choice = /partial/.test(t) ? "partial" : "full";
    return {
      role: "oz",
      body: `Decision recorded: replay **${choice} plan** on sub-agent handoffs. Resuming run-1 — Reviewer is finishing its audit now.`,
      time,
    };
  }
  if (/new persona|craft.*persona|build.*persona/.test(t)) {
    return {
      role: "oz",
      body: "Filed it as a priority. Builder + Architect will scaffold prompts, sub-agents, and tests. ETA depends on the role you sketch.",
      time,
    };
  }
  // default
  return {
    role: "oz",
    body: "Heard. I'm thinking — give me a moment.",
    time,
  };
}

// ───────── App ─────────
const App = () => {
  const [tweaks, setTweaks] = useState({ ...TWEAK_DEFAULTS });
  const [route, setRoute] = useState("dashboard");
  const [theme, setTheme] = useState(tweaks.theme);

  // Mutable data state (cloned from window.OZ_DATA)
  const seed = window.OZ_DATA;
  const [activeWsId, setActiveWsId] = useState(seed.activeWorkspaceId);
  const [loadedWsIds, setLoadedWsIds] = useState([seed.activeWorkspaceId]);
  const [workspaces, setWorkspaces] = useState(seed.workspaces);
  const [prioritiesMap, setPrioritiesMap] = useState(seed.priorities);
  const [runsMap, setRunsMap] = useState(seed.runs);
  const [ozChatMap, setOzChatMap] = useState(seed.ozChat);
  const [clis, setClis] = useState(seed.clis);
  const [personas, setPersonas] = useState(seed.personas);
  const [settings, setSettings] = useState(seed.settings);
  const [dependencies, setDependencies] = useState(seed.dependencies || []);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [ozTyping, setOzTyping] = useState(false);

  // Modals
  const [newWsOpen, setNewWsOpen] = useState(false);
  const [craftPersonaOpen, setCraftPersonaOpen] = useState(false);
  const [devNotesOpen, setDevNotesOpen] = useState(false);
  const [runHistoryOpen, setRunHistoryOpen] = useState(false);

  // Theme sync (tweaks + manual toggle in topbar)
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => { setTheme(tweaks.theme); }, [tweaks.theme]);

  // Density via CSS var
  useEffect(() => {
    document.documentElement.style.setProperty('--oz-density-scale', tweaks.density === 'compact' ? '0.92' : '1');
  }, [tweaks.density]);

  // Active workspace ctx
  const activeWs = workspaces.find(w => w.id === activeWsId);
  const priorities = prioritiesMap[activeWsId] || [];
  const runs = runsMap[activeWsId] || [];
  const ozMessages = ozChatMap[activeWsId] || [];

  // First-run / empty workspace state
  const emptyState = tweaks.workspaceState === "first-run" ? "first-run" : null;

  // ───────── Handlers ─────────

  const updateWs = (next) => {
    setWorkspaces(ws => ws.map(w => w.id === next.id ? next : w));
  };
  const createWs = () => { setNewWsOpen(true); };

  const handleCreateWs = ({ name, description, root }) => {
    const id = "ws-" + Math.random().toString(36).slice(2, 7);
    const newWs = {
      id, name, description,
      icon: "ph-thin ph-cube",
      roots: [{ id: "r-" + Math.random().toString(36).slice(2, 6), name: root.name, path: root.path, role: "primary" }],
      created: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
    };
    setWorkspaces(ws => [...ws, newWs]);
    setPrioritiesMap(m => ({ ...m, [id]: [] }));
    setRunsMap(m => ({ ...m, [id]: [] }));
    setOzChatMap(m => ({ ...m, [id]: [{
      id: "init",
      role: "oz",
      body: `Workspace **${name}** is up. Primary root is \`${root.path}\`. Tell me what we're building first.`,
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    }] }));
    setLoadedWsIds(arr => arr.includes(id) ? arr : [...arr, id]);
    setActiveWsId(id);
    setSelectedRunId(null);
    setRoute("dashboard");
  };
  const deleteWs = (id) => {
    setWorkspaces(ws => ws.filter(w => w.id !== id));
    if (activeWsId === id && workspaces.length > 1) {
      setActiveWsId(workspaces.find(w => w.id !== id).id);
    }
  };

  const loadWorkspaceTab = (id) => {
    if (!loadedWsIds.includes(id)) setLoadedWsIds(arr => [...arr, id]);
    setActiveWsId(id);
    setSelectedRunId(null);
  };
  const closeWorkspaceTab = (id) => {
    if (loadedWsIds.length <= 1) return;
    const nextLoaded = loadedWsIds.filter(x => x !== id);
    setLoadedWsIds(nextLoaded);
    if (activeWsId === id) {
      setActiveWsId(nextLoaded[Math.max(0, nextLoaded.length - 1)]);
      setSelectedRunId(null);
    }
  };
  const selectWorkspaceTab = (id) => { setActiveWsId(id); setSelectedRunId(null); };

  const reorderPriorities = (from, to) => {
    setPrioritiesMap(m => {
      const arr = [...(m[activeWsId] || [])];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return { ...m, [activeWsId]: arr };
    });
  };

  const onLaunchPriority = (priority) => {
    // Launch a new run from this priority
    const runId = "run-" + Math.random().toString(36).slice(2, 6);
    const newRun = {
      id: runId, title: priority.name, priorityId: priority.id,
      status: "running",
      personas: ["Planner", "Builder", "Reviewer"],
      cli: "claude-code",
      startedAt: "just now", progress: 0.05,
      lastEvent: "Run started. Planner is decomposing the priority.",
      attachCmd: `cocoder attach ${runId}`,
      transcript: [
        { role: "system", body: `Run started against ${activeWs.roots.find(r => r.role === "primary")?.name || "primary root"}.` },
        { role: "Planner", body: "Reading the priority spec. Decomposing into steps." },
      ],
      evidence: [],
    };
    setRunsMap(m => ({ ...m, [activeWsId]: [newRun, ...(m[activeWsId] || [])] }));
    setPrioritiesMap(m => {
      const arr = (m[activeWsId] || []).map(p => p.id === priority.id ? { ...p, status: "in-progress", runId } : p);
      return { ...m, [activeWsId]: arr };
    });
    // Oz announces the launch
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setOzChatMap(m => ({
      ...m, [activeWsId]: [...(m[activeWsId] || []),
        { id: "u-" + runId, role: "user", body: `Launch "${priority.name}"`, time },
        { id: "o-" + runId, role: "oz", body: `Launching **${priority.name}**. Planner is up. I'll watch.`, time, attachments: [{ kind: "run-card", runId }] },
      ]
    }));
  };

  const onAdhoc = () => {
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setOzChatMap(m => ({
      ...m, [activeWsId]: [...(m[activeWsId] || []),
        { id: "ad-" + Date.now(), role: "user", body: "Run something ad-hoc — describe the task here.", time },
        { id: "or-" + Date.now(), role: "oz", body: "Tell me what to do. Common ad-hocs: **code review** of a PR, **refactor** a module, **research** prior-art, **audit** a surface. What's the task?", time },
      ]
    }));
  };

  const onAddPriority = () => {
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setOzChatMap(m => ({
      ...m, [activeWsId]: [...(m[activeWsId] || []),
        { id: "ap-" + Date.now(), role: "oz", body: "What's the priority? Sketch it in a sentence — I'll write it up and add it to the list.", time },
      ]
    }));
  };

  const onSend = (text) => {
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const userMsg = { id: "u-" + Date.now(), role: "user", body: text, time };
    setOzChatMap(m => ({ ...m, [activeWsId]: [...(m[activeWsId] || []), userMsg] }));
    setOzTyping(true);
    setTimeout(() => {
      const reply = buildOzReply(text, { priorities, runs });
      reply.id = "o-" + Date.now();
      setOzChatMap(m => ({ ...m, [activeWsId]: [...(m[activeWsId] || []), reply] }));
      setOzTyping(false);
    }, 700 + Math.random() * 500);
  };

  const onDecision = (choice) => {
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setOzChatMap(m => ({
      ...m, [activeWsId]: [...(m[activeWsId] || []),
        { id: "ud-" + Date.now(), role: "user", body: choice === "full" ? "Replay the full plan." : "Just replay the last 2 messages.", time },
        { id: "od-" + Date.now(), role: "oz", body: `Decision recorded — **${choice === "full" ? "full plan" : "partial"} replay** on fallback. Resuming run-1.`, time },
      ]
    }));
    // Unblock run-1
    setRunsMap(m => {
      const arr = (m[activeWsId] || []).map(r => r.id === "run-1" ? { ...r, status: "running", lastEvent: "Decision received. Builder continuing." } : r);
      return { ...m, [activeWsId]: arr };
    });
  };

  const onRunAction = (action, runId) => {
    if (action === "stop") {
      setRunsMap(m => ({ ...m, [activeWsId]: (m[activeWsId] || []).map(r => r.id === runId ? { ...r, status: "stopped", lastEvent: "Stopped by founder." } : r) }));
    } else if (action === "ask-oz") {
      const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const run = runs.find(r => r.id === runId);
      setOzChatMap(m => ({
        ...m, [activeWsId]: [...(m[activeWsId] || []),
          { id: "aoz-" + Date.now(), role: "user", body: `What's going on with ${runId}?`, time },
          { id: "aor-" + Date.now(), role: "oz", body: `${runId} — ${run?.title}. Last event: ${run?.lastEvent}`, time, attachments: [{ kind: "run-card", runId }] },
        ]
      }));
    } else if (action === "retry") {
      setRunsMap(m => ({ ...m, [activeWsId]: (m[activeWsId] || []).map(r => r.id === runId ? { ...r, status: "running", startedAt: "just now", lastEvent: "Retrying." } : r) }));
    }
  };

  const onTestCli = (id) => {
    setClis(cs => cs.map(c => {
      if (c.id !== id) return c;
      if (c.status === "auth-failed") return { ...c, status: "auth-failed", lastTested: "just now" };
      if (c.status === "not-installed") return { ...c, status: "not-installed", lastTested: "just now" };
      return { ...c, status: "ok", lastTested: "just now" };
    }));
  };

  const onChangePersona = (id, next) => {
    setPersonas(ps => ps.map(p => p.id === id ? next : p));
  };
  const onAddSub = (pid) => {
    const subId = "sub-" + Math.random().toString(36).slice(2, 6);
    setPersonas(ps => ps.map(p => p.id === pid ? { ...p, subAgents: [...p.subAgents, { id: subId, name: "New sub-agent", cli: "claude-code", model: "Default" }] } : p));
  };
  const onRemoveSub = (pid, sid) => {
    setPersonas(ps => ps.map(p => p.id === pid ? { ...p, subAgents: p.subAgents.filter(s => s.id !== sid) } : p));
  };
  const onUpdateSub = (pid, sid, next) => {
    setPersonas(ps => ps.map(p => p.id === pid ? { ...p, subAgents: p.subAgents.map(s => s.id === sid ? next : s) } : p));
  };
  const onNewPersonaAsPriority = () => {
    setCraftPersonaOpen(true);
  };

  const handleSubmitNewPersona = ({ name, summary, spec, placeAtTop }) => {
    const newP = {
      id: "np-" + Date.now(),
      name, summary,
      status: "ready",
      labels: ["persona-build"],
      spec,
    };
    setPrioritiesMap(m => {
      const arr = m[activeWsId] || [];
      return { ...m, [activeWsId]: placeAtTop ? [newP, ...arr] : [...arr, newP] };
    });
    // Oz acknowledges
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setOzChatMap(m => ({
      ...m, [activeWsId]: [...(m[activeWsId] || []),
        { id: "cp-" + Date.now(), role: "oz",
          body: `Filed **${name}** as a ${placeAtTop ? 'top' : 'queued'} priority. Oscar will scaffold the persona—prompt, sub-agents, tests included.`,
          time,
        },
      ]
    }));
    setRoute("dashboard");
  };

  const onRecheckDep = (id) => {
    setDependencies(deps => deps.map(d => d.id === id ? { ...d, lastChecked: "just now" } : d));
  };

  // ───────── Tweaks panel ─────────
  const setTweak = (key, val) => {
    if (typeof key === "object") {
      setTweaks(t => ({ ...t, ...key }));
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: key }, '*');
    } else {
      setTweaks(t => ({ ...t, [key]: val }));
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
    }
  };

  // Tweaks host protocol
  const [tweaksOpen, setTweaksOpen] = useState(false);
  useEffect(() => {
    const handler = (e) => {
      if (!e?.data) return;
      if (e.data.type === "__activate_edit_mode") setTweaksOpen(true);
      else if (e.data.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener("message", handler);
  }, []);

  // ───────── Render ─────────
  const screenTitle = NAV_ITEMS.find(n => n.id === route)?.label || "Oz";

  const devCtxValue = useMemo(() => ({ on: !!tweaks.devMode }), [tweaks.devMode]);

  return (
    <DevModeContext.Provider value={devCtxValue}>
    <div className="oz-app" data-route={route} data-screen-label={`Oz · ${screenTitle}`}>
      <Sidebar route={route} setRoute={(r) => { setRoute(r); setSelectedRunId(null); }}
               runs={runs} priorities={priorities} user={seed.user} />
      <div className="oz-main">
        <TopBar
          title={screenTitle}
          workspaces={workspaces}
          activeId={activeWsId}
          loadedIds={loadedWsIds}
          runsMap={runsMap}
          onSelectWs={selectWorkspaceTab}
          onCloseWs={closeWorkspaceTab}
          onLoadWs={loadWorkspaceTab}
          onCreateWs={createWs}
          theme={theme}
          setTheme={setTheme}
          route={route}
        />
        <div className="oz-content" data-screen-label={`${route}`}>
          {route === "dashboard" && (
            <Dashboard
              workspace={activeWs}
              priorities={priorities} runs={runs}
              ozMessages={ozMessages}
              selectedRunId={selectedRunId} setSelectedRunId={setSelectedRunId}
              onReorder={reorderPriorities}
              onLaunch={onLaunchPriority}
              onAdhoc={onAdhoc}
              onAddPriority={onAddPriority}
              onSend={onSend}
              onDecision={onDecision}
              onRunAction={onRunAction}
              ozTyping={ozTyping}
              emptyState={emptyState}
              runHistoryOpen={runHistoryOpen}
              setRunHistoryOpen={setRunHistoryOpen}
            />
          )}
          {route === "workspaces" && (
            <WorkspacesScreen workspaces={workspaces} activeId={activeWsId}
                              onChange={updateWs} onSetActive={loadWorkspaceTab}
                              onCreate={createWs} onDelete={deleteWs}
                              onGotoDashboard={() => setRoute("dashboard")} />
          )}
          {route === "clis" && (
            <CLIsScreen clis={clis} onTest={onTestCli} onAdd={() => alert("Add CLI flow (mock)")} />
          )}
          {route === "personas" && (
            <PersonasScreen personas={personas} clis={clis}
                            onChange={onChangePersona}
                            onAddSub={onAddSub} onRemoveSub={onRemoveSub} onUpdateSub={onUpdateSub}
                            onNewPersonaAsPriority={onNewPersonaAsPriority} />
          )}
          {route === "settings" && (
            <SettingsScreen settings={settings} clis={clis} personas={personas}
                            dependencies={dependencies} onRecheckDep={onRecheckDep}
                            onChange={setSettings} />
          )}
        </div>
      </div>

      {/* Modals */}
      <NewWorkspaceModal
        open={newWsOpen}
        onClose={() => setNewWsOpen(false)}
        onCreate={handleCreateWs}
      />
      <CraftPersonaModal
        open={craftPersonaOpen}
        onClose={() => setCraftPersonaOpen(false)}
        clis={clis}
        onSubmit={handleSubmitNewPersona}
      />

      {/* Dev notes panel + floating toggle */}
      <DevNotesPanel
        open={tweaks.devMode && devNotesOpen}
        onClose={() => setDevNotesOpen(false)}
        notes={window.DEV_NOTES || []}
      />
      {tweaks.devMode && !devNotesOpen && (
        <button
          onClick={() => setDevNotesOpen(true)}
          style={{
            position: 'fixed', right: 16, bottom: 16, zIndex: 500,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px',
            background: 'var(--cb-accent)',
            color: 'var(--cb-text-on-accent)',
            border: 'none', borderRadius: 'var(--cb-radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            cursor: 'pointer',
            fontFamily: 'var(--cb-font-display)', fontSize: 11,
            letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600,
          }}
        >
          <Icon name="code" size={14} /> Dev notes ({(window.DEV_NOTES || []).length})
        </button>
      )}

      {tweaksOpen && (
        <TweaksPanel title="Tweaks" onClose={() => setTweaksOpen(false)}>
          <TweakSection title="Theme">
            <TweakRadio
              label="Mode"
              value={tweaks.theme}
              options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
              onChange={v => setTweak("theme", v)}
            />
          </TweakSection>
          <TweakSection title="State">
            <TweakRadio
              label="Workspace state"
              value={tweaks.workspaceState}
              options={[
                { value: "configured", label: "Configured" },
                { value: "first-run", label: "First run" },
              ]}
              onChange={v => setTweak("workspaceState", v)}
            />
          </TweakSection>
          <TweakSection title="Density">
            <TweakRadio
              label="Layout density"
              value={tweaks.density}
              options={[
                { value: "comfortable", label: "Comfort" },
                { value: "compact", label: "Compact" },
              ]}
              onChange={v => setTweak("density", v)}
            />
          </TweakSection>
          <TweakSection title="Dev mode">
            <TweakToggle
              label="Show dev annotations"
              value={tweaks.devMode}
              onChange={v => { setTweak("devMode", v); if (v) setDevNotesOpen(true); }}
            />
            {tweaks.devMode && (
              <TweakButton onClick={() => setDevNotesOpen(o => !o)}>
                {devNotesOpen ? "Hide notes panel" : "Show notes panel"}
              </TweakButton>
            )}
          </TweakSection>
          <TweakSection title="Demo">
            <TweakButton onClick={() => setRoute("dashboard")}>Go to Dashboard</TweakButton>
            <TweakButton onClick={() => setSelectedRunId("run-1")}>Open run-1 (active)</TweakButton>
            <TweakButton onClick={() => setSelectedRunId("run-4")}>Open run-4 (failed)</TweakButton>
            <TweakButton onClick={() => { setRoute("dashboard"); setActiveWsId("ws-vault"); }}>Switch to quiet workspace</TweakButton>
          </TweakSection>
        </TweaksPanel>
      )}
    </div>
    </DevModeContext.Provider>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
