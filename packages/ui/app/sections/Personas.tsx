// Personas screen — the AI team (Oz · Oscar · Bob · Talia · Quinn · Doc). Each persona has CLI + Model
// linked dropdowns, a visible/headless run-mode toggle (Oz locked headless), and a sub-agent hierarchy
// (each sub independently CLI+Model configurable). "Craft a new persona" files a priority. Ported from
// design-ref/screens.jsx.
import { Icon, Button, Card, ScreenHeader } from '../ui/primitives.tsx'
import { PendingBanner } from '../ui/PendingBanner.tsx'
import { modelIsStale } from '../adapter.ts'
import { phicon, type Cli, type Persona, type SubAgent } from '../model.ts'

function ModelControl({ cli, model, onChange, compact = false }: { cli: Cli | undefined; model: string; onChange: (model: string) => void; compact?: boolean }) {
  const stale = modelIsStale(cli, model)
  const models = cli?.models ?? ['Default']
  const options = stale ? [...models, model] : models
  const inputStyle = compact ? { padding: '5px 8px', fontSize: 11.5 } : undefined
  const stateNote = stale
    ? <span style={{ color: 'var(--cb-highlight)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5 }}><Icon name="warning-circle" size={11} />Unavailable</span>
    : cli && !cli.canEnumerate
      ? <span style={{ color: 'var(--cb-text-muted)', fontSize: 10.5 }}>free text</span>
      : null
  const label = (
    <label className="oz-field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      Model
      {stateNote && <span style={{ fontFamily: 'var(--cb-font-body)', letterSpacing: 0, textTransform: 'none' }}>{stateNote}</span>}
    </label>
  )
  if (cli && !cli.canEnumerate) {
    const input = <input className="oz-input" value={model === 'Default' ? '' : model} placeholder="Default" style={inputStyle} onChange={(e) => onChange(e.target.value || 'Default')} />
    if (compact) return <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{input}{stateNote}</div>
    return (
      <>
        {label}
        {input}
      </>
    )
  }
  const select = (
    <select className="oz-select" value={model} style={compact ? { padding: '5px 24px 5px 8px', fontSize: 11.5 } : undefined} onChange={(e) => onChange(e.target.value)}>
      {options.map((m) => <option key={m} value={m}>{m}{stale && m === model ? ' (unavailable)' : ''}</option>)}
    </select>
  )
  if (compact) return <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{select}{stateNote}</div>
  return (
    <>
      {label}
      {select}
    </>
  )
}

function PersonaRow({ persona, clis, onChange, onAddSub, onRemoveSub, onUpdateSub }: {
  persona: Persona; clis: Cli[]; onChange: (p: Persona) => void
  onAddSub: (pid: string) => void; onRemoveSub: (pid: string, sid: string) => void; onUpdateSub: (pid: string, sid: string, sa: SubAgent) => void
}) {
  const isOz = persona.id === 'oz'
  const cliEntry = clis.find((c) => c.id === persona.cli)
  return (
    <Card style={{ marginBottom: 12, borderColor: isOz ? 'var(--cb-accent-15)' : 'var(--cb-border)', background: isOz ? 'linear-gradient(180deg, var(--cb-accent-subtle) 0%, var(--cb-surface-glass) 60%)' : undefined }}>
      <div style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ width: 44, height: 44, background: isOz ? 'var(--cb-accent-muted)' : 'var(--cb-bg-soft)', border: `1px solid ${isOz ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`, borderRadius: 'var(--cb-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOz ? 'var(--cb-accent)' : 'var(--cb-text-secondary)', flexShrink: 0 }}>
            <Icon name={phicon(persona.icon)} size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <span style={{ fontSize: 15, color: 'var(--cb-text)', fontWeight: 500 }}>{persona.name}</span>
              {isOz && <span className="oz-chip oz-chip-running"><span className="dot" />HEADLESS</span>}
              {persona.runMode === 'headless' && !isOz && <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, padding: '2px 6px', background: 'var(--cb-bg-soft)', color: 'var(--cb-text-muted)', borderRadius: 2 }}>HEADLESS</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--cb-text-secondary)', marginBottom: 6 }}>{persona.role}</div>
            <div style={{ fontSize: 12, color: 'var(--cb-text-muted)', lineHeight: 1.55 }}>{persona.description}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--cb-border)' }}>
          <div>
            <label className="oz-field-label">CLI</label>
            <select className="oz-select" value={persona.cli} onChange={(e) => onChange({ ...persona, cli: e.target.value, model: 'Default' })}>
              {clis.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <ModelControl cli={cliEntry} model={persona.model} onChange={(model) => onChange({ ...persona, model })} />
          </div>
          <div>
            <label className="oz-field-label">Run mode</label>
            <div style={{ display: 'flex', gap: 6, padding: 2, background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)' }}>
              {(['visible', 'headless'] as const).map((m) => (
                <button key={m} onClick={() => !isOz && onChange({ ...persona, runMode: m })} disabled={isOz && m === 'visible'} style={{ flex: 1, padding: '6px 10px', background: persona.runMode === m ? 'var(--cb-accent-muted)' : 'transparent', color: persona.runMode === m ? 'var(--cb-accent)' : 'var(--cb-text-muted)', border: 'none', borderRadius: 3, fontSize: 11.5, fontWeight: persona.runMode === m ? 500 : 400, cursor: isOz ? 'not-allowed' : 'pointer', textTransform: 'capitalize', opacity: isOz && m === 'visible' ? 0.4 : 1 }}>{m}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--cb-font-display)', fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text-muted)', marginBottom: 10 }}>
            <Icon name="tree-structure" size={12} />Sub-agents · {persona.subAgents.length}
            <button onClick={() => onAddSub(persona.id)} style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', background: 'transparent', border: '1px solid var(--cb-border)', borderRadius: 3, color: 'var(--cb-text-muted)', cursor: 'pointer', fontFamily: 'var(--cb-font-body)', letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>+ Add</button>
          </div>
          {persona.subAgents.length === 0 ? (
            <div style={{ padding: '10px 14px', background: 'var(--cb-bg-soft)', border: '1px dashed var(--cb-border)', borderRadius: 'var(--cb-radius-md)', fontSize: 11.5, color: 'var(--cb-text-muted)', textAlign: 'center' }}>No sub-agents. {persona.name} runs everything itself.</div>
          ) : persona.subAgents.map((sa) => {
            const subCli = clis.find((c) => c.id === sa.cli)
            return (
              <div key={sa.id} style={{ display: 'grid', gridTemplateColumns: '20px 1.5fr 1fr 1fr 30px', gap: 10, alignItems: 'center', padding: '10px 12px', background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', marginBottom: 6 }}>
                <Icon name="git-fork" size={12} style={{ color: 'var(--cb-text-muted)', transform: 'rotate(180deg)' }} />
                <input className="oz-input" value={sa.name} style={{ padding: '5px 8px', fontSize: 12, background: 'transparent', border: 'none' }} onChange={(e) => onUpdateSub(persona.id, sa.id, { ...sa, name: e.target.value })} />
                <select className="oz-select" value={sa.cli} style={{ padding: '5px 24px 5px 8px', fontSize: 11.5 }} onChange={(e) => onUpdateSub(persona.id, sa.id, { ...sa, cli: e.target.value, model: 'Default' })}>
                  {clis.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ModelControl cli={subCli} model={sa.model} compact onChange={(model) => onUpdateSub(persona.id, sa.id, { ...sa, model })} />
                <button className="oz-iconbtn" style={{ width: 24, height: 24 }} onClick={() => onRemoveSub(persona.id, sa.id)}><Icon name="x" size={11} /></button>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

export function PersonasScreen({ personas, clis, onChange, onAddSub, onRemoveSub, onUpdateSub, onNewPersonaAsPriority, live = false }: {
  personas: Persona[]; clis: Cli[]; onChange: (id: string, p: Persona) => void
  onAddSub: (pid: string) => void; onRemoveSub: (pid: string, sid: string) => void; onUpdateSub: (pid: string, sid: string, sa: SubAgent) => void; onNewPersonaAsPriority: () => void; live?: boolean
}) {
  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <ScreenHeader title="Personas" subtitle="The AI team. Each persona has a CLI + model and may delegate work to sub-agents. Building a new persona becomes a priority for the team itself." actions={<Button variant="primary" icon="hammer" onClick={onNewPersonaAsPriority}>Craft a new persona</Button>} />
      <div style={{ padding: '0 28px 24px', overflowY: 'auto', minHeight: 0 }}>
        <div style={{ padding: '14px 16px', background: 'var(--cb-accent-subtle)', border: '1px solid var(--cb-accent-15)', borderRadius: 'var(--cb-radius-md)', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <Icon name="lightbulb" size={18} style={{ color: 'var(--cb-accent)', marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500, marginBottom: 3 }}>New personas are built, not configured.</div>
            <div style={{ fontSize: 11.5, color: 'var(--cb-text-secondary)', lineHeight: 1.55 }}>Sketch what the persona should do. Oz files it as a priority and the team scaffolds the new role — prompts, sub-agents, and tests included.</div>
          </div>
        </div>
        <PendingBanner live={live}>The roster (and each persona’s CLI) is live from the daemon, but editing here isn’t saved yet: run-mode/sub-agents need the assignment schema extended (<code>PUT …/assignments</code> with <code>{'{'}mode, subAgents{'}'}</code> owed). Edits below are local previews.</PendingBanner>
        {personas.map((p) => <PersonaRow key={p.id} persona={p} clis={clis} onChange={(next) => onChange(p.id, next)} onAddSub={onAddSub} onRemoveSub={onRemoveSub} onUpdateSub={onUpdateSub} />)}
      </div>
    </div>
  )
}
