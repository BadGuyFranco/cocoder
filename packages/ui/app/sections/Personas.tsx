// Personas screen — the AI team (Oz · Oscar · Bob · Deb · Talia · Quinn). Each persona has CLI + Model
// linked dropdowns, a visible/headless run-mode toggle (Oz locked headless), and a Skills (Plays) hierarchy
// (each sub independently CLI+Model configurable). "Craft a new persona" files a priority. Ported from
// design-ref/screens.jsx.
import { useState } from 'react'
import { Icon, Button, Card, ScreenHeader } from '../ui/primitives.tsx'
import { SessionNote } from '../ui/PendingBanner.tsx'
import { modelIsStale } from '../adapter.ts'
import { phicon, type Cli, type Persona, type Play, type SubAgent } from '../model.ts'
import { ScopeChips } from './Plays.tsx'

// Sentinel select value: "type a model name yourself". Enumerable CLIs (claude/codex curated aliases,
// cursor-agent --list-models) get a dropdown; "Custom…" keeps the free-text escape hatch so a full model
// id (e.g. claude-opus-4-8) can still be pinned. A model not in the list is treated as a custom value.
const CUSTOM_MODEL = '__custom__'
const HEADLESS_CLI_WARNING = 'Headless Play on an interactive-only CLI — would hang'

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

function PersonaRow({ persona, plays, clis, onChange, onAddSub, onRemoveSub, onUpdateSub }: {
  persona: Persona; plays: Play[]; clis: Cli[]; onChange: (p: Persona) => void
  onAddSub: (pid: string, playId: string) => void; onRemoveSub: (pid: string, sid: string) => void; onUpdateSub: (pid: string, sid: string, sa: SubAgent) => void
}) {
  const isOz = persona.id === 'oz'
  const cliEntry = clis.find((c) => c.id === persona.cli)
  const [expanded, setExpanded] = useState(false)
  const [playId, setPlayId] = useState('')
  const boundPlayIds = new Set(persona.subAgents.map((sa) => sa.id))
  const availablePlays = plays.filter((play) => !boundPlayIds.has(play.id))
  const playIdTaken = boundPlayIds.has(playId)
  const canAddPlay = playId.length > 0 && !playIdTaken && availablePlays.some((play) => play.id === playId)
  const pickerHint = plays.length === 0 ? 'No Skills (Plays) available' : availablePlays.length === 0 ? 'All Skills (Plays) bound' : 'Select Skill (Play)'
  const addPlay = () => {
    if (!canAddPlay) return
    onAddSub(persona.id, playId)
    setPlayId('')
  }
  return (
    <Card style={{ marginBottom: 12, borderColor: isOz ? 'var(--cb-accent-15)' : 'var(--cb-border)', background: isOz ? 'var(--cb-surface)' : undefined }}>
      <div style={{ padding: '16px 18px' }}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`Toggle ${persona.name} persona details`}
          onClick={() => setExpanded((open) => !open)}
          style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 14, padding: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--cb-font-body)' }}
        >
          <div style={{ width: 44, height: 44, background: isOz ? 'var(--cb-accent-muted)' : 'var(--cb-bg-soft)', border: `1px solid ${isOz ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`, borderRadius: 'var(--cb-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOz ? 'var(--cb-accent)' : 'var(--cb-text-secondary)', flexShrink: 0 }}>
            <Icon name={phicon(persona.icon)} size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <span style={{ fontSize: 15, color: 'var(--cb-text)', fontWeight: 500 }}>{persona.name}</span>
              {isOz && <span className="oz-chip oz-chip-running"><span className="dot" />HEADLESS</span>}
              {persona.runMode === 'headless' && !isOz && <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, padding: '2px 6px', background: 'var(--cb-bg-soft)', color: 'var(--cb-text-muted)', borderRadius: 2 }}>HEADLESS</span>}
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--cb-font-display)', fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--cb-text-muted)' }}>Skills (Plays) · {persona.subAgents.length}</span>
              <Icon name="caret-down" size={14} style={{ color: 'var(--cb-text-muted)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform var(--cb-duration-fast) var(--cb-ease-default)' }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--cb-text-secondary)', marginBottom: 6 }}>{persona.role}</div>
            <div style={{ fontSize: 12, color: 'var(--cb-text-muted)', lineHeight: 1.55 }}>{persona.description}</div>
          </div>
        </button>
        {expanded && (
          <>
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
                  <select className="oz-select" aria-label={`${persona.name} Skill (Play)`} value={playId} disabled={availablePlays.length === 0} onChange={(e) => setPlayId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addPlay() }} style={{ width: 190, padding: '4px 24px 4px 7px', fontSize: 11 }}>
                    <option value="">{pickerHint}</option>
                    {availablePlays.map((play) => <option key={play.id} value={play.id}>{play.label} ({play.id})</option>)}
                  </select>
                  <button onClick={addPlay} disabled={!canAddPlay} style={{ fontSize: 11, padding: '2px 8px', background: 'transparent', border: '1px solid var(--cb-border)', borderRadius: 3, color: canAddPlay ? 'var(--cb-text-muted)' : 'var(--cb-text-disabled)', cursor: canAddPlay ? 'pointer' : 'not-allowed', fontFamily: 'var(--cb-font-body)', letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>+ Add</button>
                </div>
              </div>
              {persona.subAgents.length === 0 ? (
                <div style={{ padding: '10px 14px', background: 'var(--cb-bg-soft)', border: '1px dashed var(--cb-border)', borderRadius: 'var(--cb-radius-md)', fontSize: 11.5, color: 'var(--cb-text-muted)', textAlign: 'center' }}>No Skills (Plays) bound. {persona.name} runs everything itself. (A Play is a shared procedure — binding one here grants {persona.name} permission to run it.)</div>
              ) : persona.subAgents.map((sa) => {
                const subCli = clis.find((c) => c.id === sa.cli)
                const play = plays.find((p) => p.id === sa.id)
                return <BoundPlayRow key={sa.id} persona={persona} subAgent={sa} play={play} clis={clis} subCli={subCli} onRemoveSub={onRemoveSub} onUpdateSub={onUpdateSub} />
              })}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

function BoundPlayRow({ persona, subAgent, play, clis, subCli, onRemoveSub, onUpdateSub }: {
  persona: Persona; subAgent: SubAgent; play: Play | undefined; clis: Cli[]; subCli: Cli | undefined
  onRemoveSub: (pid: string, sid: string) => void; onUpdateSub: (pid: string, sid: string, sa: SubAgent) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const cliCanHeadless = subCli?.headlessCapable ?? true
  const misconfigured = play?.kind === 'headless' && subCli !== undefined && !cliCanHeadless
  return (
    <div data-testid="bound-play-row" style={{ padding: '10px 12px', background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', marginBottom: 6 }}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`Toggle ${subAgent.id} Skill (Play) details`}
        onClick={() => setExpanded((open) => !open)}
        style={{ width: '100%', display: 'grid', gridTemplateColumns: '20px 1fr auto 16px', gap: 10, alignItems: 'center', padding: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--cb-font-body)' }}
      >
        <Icon name="git-fork" size={12} style={{ color: 'var(--cb-text-muted)', transform: 'rotate(180deg)' }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12, color: 'var(--cb-text)' }}>{subAgent.id}</div>
          {play && <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--cb-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{play.label}</div>}
        </div>
        {misconfigured && <Icon name="warning-circle" size={13} style={{ color: 'var(--cb-highlight)' }} />}
        <Icon name="caret-down" size={13} style={{ color: 'var(--cb-text-muted)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform var(--cb-duration-fast) var(--cb-ease-default)' }} />
      </button>
      {expanded && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '20px 1.5fr 1fr 1fr 30px', gap: 10, alignItems: 'center', marginTop: 10 }}>
            <div />
            <input className="oz-input" value={subAgent.id} readOnly style={{ padding: '5px 8px', fontSize: 12, background: 'transparent', border: 'none', fontFamily: 'var(--cb-font-mono)' }} />
            <select className="oz-select" value={subAgent.cli} style={{ padding: '5px 24px 5px 8px', fontSize: 11.5 }} onChange={(e) => onUpdateSub(persona.id, subAgent.id, { ...subAgent, cli: e.target.value, model: 'Default' })}>
              {clis.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <ModelControl cli={subCli} model={subAgent.model} compact onChange={(model) => onUpdateSub(persona.id, subAgent.id, { ...subAgent, model })} />
            <button className="oz-iconbtn" style={{ width: 24, height: 24 }} onClick={() => onRemoveSub(persona.id, subAgent.id)}><Icon name="x" size={11} /></button>
          </div>
          {play && (
            <div style={{ marginTop: 8, paddingLeft: 30 }}>
              <ScopeChips writeScope={play.writeScope} />
            </div>
          )}
          {misconfigured && (
            <div style={{ marginTop: 8, marginLeft: 30, padding: '7px 9px', background: 'var(--cb-highlight-muted)', border: '1px solid rgba(212,118,110,0.2)', borderRadius: 3, fontSize: 11.5, color: 'var(--cb-highlight)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Icon name="warning-circle" size={13} />
              <span>{HEADLESS_CLI_WARNING}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function PersonasScreen({ personas, plays, clis, onChange, onAddSub, onRemoveSub, onUpdateSub, onNewPersonaAsPriority, live = false }: {
  personas: Persona[]; plays: Play[]; clis: Cli[]; onChange: (id: string, p: Persona) => void
  onAddSub: (pid: string, playId: string) => void; onRemoveSub: (pid: string, sid: string) => void; onUpdateSub: (pid: string, sid: string, sa: SubAgent) => void; onNewPersonaAsPriority: () => void; live?: boolean
}) {
  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <ScreenHeader title="Personas" subtitle="The AI team. Each persona has a CLI + model and may use Skills (Plays). Building a new persona becomes a priority for the team itself." actions={<Button variant="primary" icon="hammer" onClick={onNewPersonaAsPriority}>Craft a new persona</Button>} />
      <div style={{ padding: '0 28px 24px', overflowY: 'auto', minHeight: 0 }}>
        <div style={{ padding: '14px 16px', background: 'var(--cb-accent-subtle)', border: '1px solid var(--cb-accent-15)', borderRadius: 'var(--cb-radius-md)', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <Icon name="lightbulb" size={18} style={{ color: 'var(--cb-accent)', marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500, marginBottom: 3 }}>New personas are built, not configured.</div>
            <div style={{ fontSize: 11.5, color: 'var(--cb-text-secondary)', lineHeight: 1.55 }}>Sketch what the persona should do. Oz files it as a priority and the team scaffolds the new role — prompts, Skills (Plays), and tests included.</div>
          </div>
        </div>
        <SessionNote live={live}>CLI, model, and Skills (Plays) assignments save to the workspace. Browse the full catalog on the <strong>Skills (Plays)</strong> screen. Run-mode currently takes effect for <strong>Oscar and Bob</strong> only — for other personas it’s a preview the runner doesn’t honor yet.</SessionNote>
        {personas.map((p) => <PersonaRow key={p.id} persona={p} plays={plays} clis={clis} onChange={(next) => onChange(p.id, next)} onAddSub={onAddSub} onRemoveSub={onRemoveSub} onUpdateSub={onUpdateSub} />)}
      </div>
    </div>
  )
}
