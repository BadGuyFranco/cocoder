// Personas section (the brief's "Personas", NOT "Settings"). Editable per persona: CLI + Model as two
// LINKED dropdowns ("Default" = empty model). Saved via PUT assignments as a FULL-MAP REPLACE — we send
// the whole map every time or we'd drop personas.
//
// Reality: the daemon returns personas:[] empty; the live data is the `assignments` map
// ({id:{cli,model,enabled?}}). Oz is rendered (it IS a persona, runs headless) but isn't in that map,
// so its row is informational. Sub-agent hierarchy + visible/headless are shown DISABLED ("coming
// soon") — no model backing yet (ENDPOINTS OWED: extend assignment with {mode, subAgents}).
import { useEffect, useState } from 'react'
import type { PersonaAssignment } from '../../electron/ipc-contract.ts'
import { getPersonas, putAssignments } from '../client.ts'
import { Card, Loading, ErrorNote, Pending } from '../components.tsx'

const CLIS = ['claude', 'codex', 'cursor-agent', 'grok', 'gemini']
const MODELS: Record<string, string[]> = {
  claude: ['Opus 4.8', 'Sonnet 4.6', 'Haiku 4.5'],
  codex: ['gpt-5-codex', 'o4-mini'],
  'cursor-agent': [],
  grok: ['grok-4'],
  gemini: ['gemini-2.5-pro'],
}
const DEFAULT = '__default__' // sentinel for the "Default" option => empty model string

type Map_ = Record<string, PersonaAssignment>

export function Personas({ wsId, wsName }: { wsId: string; wsName: string }): JSX.Element {
  const [map, setMap] = useState<Map_ | null>(null)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    let live = true
    setMap(null)
    setErr('')
    setSaved('')
    getPersonas(wsId).then((r) => {
      if (!live) return
      if (r.ok) setMap(r.data.assignments)
      else setErr(r.error)
    })
    return () => {
      live = false
    }
  }, [wsId])

  function setCli(id: string, cli: string): void {
    // linked dropdowns: changing CLI resets model to Default (models are CLI-specific)
    setMap((m) => (m ? { ...m, [id]: { ...m[id], cli, model: '' } } : m))
    setSaved('')
  }
  function setModel(id: string, sel: string): void {
    setMap((m) => (m ? { ...m, [id]: { ...m[id], model: sel === DEFAULT ? '' : sel } } : m))
    setSaved('')
  }

  async function save(): Promise<void> {
    if (!map) return
    setSaved('Saving…')
    const r = await putAssignments(wsId, map) // FULL map — replace, not patch
    setSaved(r.ok ? 'Saved ✓' : `Save failed: ${r.error}`)
  }

  if (err) return <div className="section"><h2>Personas — {wsName}</h2><ErrorNote>{err}</ErrorNote></div>
  if (!map) return <div className="section"><h2>Personas — {wsName}</h2><Loading what="Loading personas" /></div>

  const ids = Object.keys(map)

  return (
    <div className="section">
      <h2>Personas — {wsName}</h2>
      <p className="muted">Edits write the governance assignments (full-map replace), not the database.</p>

      <Card title={<>Oz <span className="tag-active">headless · in-app</span></>}>
        <p className="muted">Oz is itself a persona — the in-app command-center chatbot and the watcher for every run. It runs headless inside this app, so it has no CLI/model row to assign here.</p>
      </Card>

      <div className="list">
        {ids.map((id) => {
          const a = map[id]
          const cli = a.cli || 'claude'
          const models = MODELS[cli] ?? []
          const modelOptions = a.model && !models.includes(a.model) ? [a.model, ...models] : models
          return (
            <Card key={id} title={<>{id} {a.enabled === false && <span className="muted">(disabled)</span>}</>}>
              <div className="persona-row">
                <label className="field">
                  <span>CLI</span>
                  <select value={cli} onChange={(e) => setCli(id, e.target.value)}>
                    {(CLIS.includes(cli) ? CLIS : [cli, ...CLIS]).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Model</span>
                  <select value={a.model || DEFAULT} onChange={(e) => setModel(id, e.target.value)}>
                    <option value={DEFAULT}>Default</option>
                    {modelOptions.map((mo) => (
                      <option key={mo} value={mo}>{mo}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Run mode</span>
                  <select disabled value="headless" title="visible/headless toggle — coming soon">
                    <option value="headless">Headless</option>
                  </select>
                </label>
              </div>
              <div className="subagents-pending">
                <span className="pending-tag">coming soon</span> Sub-agents (persona → its sub-agents, each with its own CLI + Model) and the visible/headless toggle need a core change to the assignment model.
              </div>
            </Card>
          )
        })}
      </div>

      <div className="save-row">
        <button className="btn" onClick={() => void save()}>Save assignments</button>
        <span className="muted">{saved}</span>
      </div>

      <Pending label="Create a persona via a priority" note="Starting “make a new persona” should enqueue a workspace priority for the team to build it (not a raw form). Needs POST /workspaces/:id/priorities." />
    </div>
  )
}
