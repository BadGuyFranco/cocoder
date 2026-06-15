// Personas screen — the AI team (Oz · Oscar · Bob · Talia · Quinn · Doc). Each persona has CLI + Model
// linked dropdowns, a visible/headless run-mode toggle (Oz locked headless), and a sub-agent hierarchy
// (each sub independently CLI+Model configurable). "Craft a new persona" files a priority. Ported from
// design-ref/screens.jsx.
import { useState } from 'react'
import { Icon, Button, Card, ScreenHeader } from '../ui/primitives.tsx'
import { SessionNote } from '../ui/PendingBanner.tsx'
import { modelIsStale } from '../adapter.ts'
import { phicon, type Cli, type Persona, type Play, type SubAgent } from '../model.ts'

// Sentinel select value: "type a model name yourself". Enumerable CLIs (claude/codex curated aliases,
// cursor-agent --list-models) get a dropdown; "Custom…" keeps the free-text escape hatch so a full model
// id (e.g. claude-opus-4-8) can still be pinned. A model not in the list is treated as a custom value.
const CUSTOM_MODEL = '__custom__'

function ModelControl({ cli, model, onChange, compact = false }: { cli: Cli | undefined; model: string; onChange: (model: string) => void; compact?: boolean }) {
  const canEnumerate = !!cli?.canEnumerate
  const models = cli?.models ?? ['Default']
  // modelIsStale is exactly "canEnumerate && model is non-Default and not in the curated list" — i.e. a
  // custom/free-form value. Start such a value in custom mode so its input is shown, not hidden.
  const isCustomValue = modelIsStale(cli, model)
  const [customMode, setCustomMode] = useState(isCustomValue)
  const inputStyle = compact ? { padding: '5px 8px', fontSize: 11.5 } : undefined
  const label = <label className="oz-field-label">Model</label>

  // CLIs with no enumerate command and no curated list: a plain free-text input.
  if (cli && !canEnumerate) {
    const input = <input className="oz-input" aria-label="Model" value={model === 'Default' ? '' : model} placeholder="Default" style={inputStyle} onChange={(e) => onChange(e.target.value || 'Default')} />
    if (compact) return <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{input}</div>
    return <>{label}{input}</>
  }

  const usingCustom = customMode || isCustomValue
  const select = (
    <select className="oz-select" aria-label="Model" value={usingCustom ? CUSTOM_MODEL : model} style={compact ? { padding: '5px 24px 5px 8px', fontSize: 11.5 } : undefined}
      onChange={(e) => { if (e.target.value === CUSTOM_MODEL) setCustomMode(true); else { setCustomMode(false); onChange(e.target.value) } }}>
      {models.map((m) => <option key={m} value={m}>{m}</option>)}
      <option value={CUSTOM_MODEL}>Custom…</option>
    </select>
  )
  const customInput = usingCustom
    ? <input className="oz-input" aria-label="Custom model id" placeholder="model id — e.g. claude-opus-4-8" value={model === 'Default' ? '' : model} style={{ ...(inputStyle ?? {}), marginTop: 4 }} onChange={(e) => onChange(e.target.value || 'Default')} />
    : null

  if (compact) return <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{select}{customInput}</div>
  return <>{label}{select}{customInput}</>
}

function PersonaRow({ persona, clis, onChange, onAddSub, onRemoveSub, onUpdateSub }: {
  persona: Persona; clis: Cli[]; onChange: (p: Persona) => void
  onAddSub: (pid: string, playId: string) => void; onRemoveSub: (pid: string, sid: string) => void; onUpdateSub: (pid: string, sid: string, sa: SubAgent) => void
}) {
  const isOz = persona.id === 'oz'
  const cliEntry = clis.find((c) => c.id === persona.cli)
  const [playId, setPlayId] = useState('')
  const trimmedPlayId = playId.trim()
  const playIdTaken = persona.subAgents.some((sa) => sa.id === trimmedPlayId)
  const canAddPlay = trimmedPlayId.length > 0 && !playIdTaken
  const addPlay = () => {
    if (!canAddPlay) return
    onAddSub(persona.id, trimmedPlayId)
    setPlayId('')
  }
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
                <button key={m} aria-label={`${persona.name} ${m} run mode`} onClick={() => !isOz && onChange({ ...persona, runMode: m })} disabled={isOz && m === 'visible'} style={{ flex: 1, padding: '6px 10px', background: persona.runMode === m ? 'var(--cb-accent-muted)' : 'transparent', color: persona.runMode === m ? 'var(--cb-accent)' : 'var(--cb-text-muted)', border: 'none', borderRadius: 3, fontSize: 11.5, fontWeight: persona.runMode === m ? 500 : 400, cursor: isOz ? 'not-allowed' : 'pointer', textTransform: 'capitalize', opacity: isOz && m === 'visible' ? 0.4 : 1 }}>{m}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--cb-font-display)', fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text-muted)', marginBottom: 10 }}>
            <Icon name="tree-structure" size={12} />Skills (Plays) · {persona.subAgents.length}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input className="oz-input" aria-label={`${persona.name} play id`} value={playId} placeholder="play id" onChange={(e) => setPlayId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addPlay() }} style={{ width: 130, padding: '4px 7px', fontSize: 11, fontFamily: 'var(--cb-font-mono)' }} />
              <button onClick={addPlay} disabled={!canAddPlay} style={{ fontSize: 11, padding: '2px 8px', background: 'transparent', border: '1px solid var(--cb-border)', borderRadius: 3, color: canAddPlay ? 'var(--cb-text-muted)' : 'var(--cb-text-disabled)', cursor: canAddPlay ? 'pointer' : 'not-allowed', fontFamily: 'var(--cb-font-body)', letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>+ Add</button>
            </div>
          </div>
          {persona.subAgents.length === 0 ? (
            <div style={{ padding: '10px 14px', background: 'var(--cb-bg-soft)', border: '1px dashed var(--cb-border)', borderRadius: 'var(--cb-radius-md)', fontSize: 11.5, color: 'var(--cb-text-muted)', textAlign: 'center' }}>No Plays bound. {persona.name} runs everything itself. (A Play is a shared procedure — binding one here grants {persona.name} permission to run it.)</div>
          ) : persona.subAgents.map((sa) => {
            const subCli = clis.find((c) => c.id === sa.cli)
            return (
              <div key={sa.id} style={{ display: 'grid', gridTemplateColumns: '20px 1.5fr 1fr 1fr 30px', gap: 10, alignItems: 'center', padding: '10px 12px', background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', marginBottom: 6 }}>
                <Icon name="git-fork" size={12} style={{ color: 'var(--cb-text-muted)', transform: 'rotate(180deg)' }} />
                <input className="oz-input" value={sa.id} readOnly style={{ padding: '5px 8px', fontSize: 12, background: 'transparent', border: 'none', fontFamily: 'var(--cb-font-mono)' }} />
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

function PlaysCatalog({ plays }: { plays: Play[] }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--cb-font-display)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-text-muted)', marginBottom: 10 }}>
          <Icon name="tree-structure" size={13} />Plays catalog · {plays.length}
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {plays.map((play) => (
            <div key={play.id} data-testid="play-row" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.5fr 110px minmax(160px, 2fr)', gap: 10, alignItems: 'center', padding: '10px 12px', background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)' }}>
              <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12, color: 'var(--cb-text)' }}>{play.id}</div>
              <div style={{ fontSize: 12, color: 'var(--cb-text-secondary)', minWidth: 0 }}>{play.label}</div>
              <div style={{ justifySelf: 'start', fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, padding: '2px 6px', background: 'var(--cb-surface)', color: 'var(--cb-text-muted)', border: '1px solid var(--cb-border)', borderRadius: 2, textTransform: 'uppercase' }}>{play.kind}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, minWidth: 0 }}>
                {play.writeScope.length === 0 ? (
                  <span style={{ fontSize: 11.5, color: 'var(--cb-text-muted)' }}>read-only</span>
                ) : play.writeScope.map((scope) => (
                  <span key={scope} style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)', padding: '2px 5px', background: 'var(--cb-surface-glass)', border: '1px solid var(--cb-border)', borderRadius: 3 }}>{scope}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

export function PersonasScreen({ personas, plays, clis, onChange, onAddSub, onRemoveSub, onUpdateSub, onNewPersonaAsPriority, live = false }: {
  personas: Persona[]; plays: Play[]; clis: Cli[]; onChange: (id: string, p: Persona) => void
  onAddSub: (pid: string, playId: string) => void; onRemoveSub: (pid: string, sid: string) => void; onUpdateSub: (pid: string, sid: string, sa: SubAgent) => void; onNewPersonaAsPriority: () => void; live?: boolean
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
        <SessionNote live={live}>CLI, model, and Play (skill) assignments save to the workspace. Run-mode currently takes effect for <strong>Oscar and Bob</strong> only — for other personas it’s a preview the runner doesn’t honor yet.</SessionNote>
        <PlaysCatalog plays={plays} />
        {personas.map((p) => <PersonaRow key={p.id} persona={p} clis={clis} onChange={(next) => onChange(p.id, next)} onAddSub={onAddSub} onRemoveSub={onRemoveSub} onUpdateSub={onUpdateSub} />)}
      </div>
    </div>
  )
}
