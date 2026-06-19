// Creation modals: NewWorkspace, NewPriority, and CraftPersona (sketches a role and files it as a
// priority for the team to build, not a config form). Ported from design-ref.
import { useEffect, useState } from 'react'
import { Icon, Button, Modal } from '../ui/primitives.tsx'
import type { Cli } from '../model.ts'

export function NewWorkspaceModal({
  open,
  onClose,
  onCreate,
  onPickRoot,
  onValidateRoot,
}: {
  open: boolean
  onClose: () => void
  onCreate: (w: { name: string; description: string; root: { name: string; path: string } }) => boolean | Promise<boolean>
  onPickRoot?: () => Promise<{ readonly path: string | null; readonly error?: string }>
  onValidateRoot?: (path: string) => Promise<string | null>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rootName, setRootName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [rootError, setRootError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => { if (open) { setName(''); setDescription(''); setRootName(''); setRootPath(''); setRootError(null); setPicking(false); setSubmitting(false) } }, [open])
  const valid = Boolean(name.trim() && rootName.trim() && rootPath.trim() && !rootError)
  const pickRoot = async () => {
    if (!onPickRoot || picking || submitting) return
    setPicking(true)
    setRootError(null)
    const picked = await onPickRoot()
    setPicking(false)
    if (picked.error) setRootError(picked.error)
    else if (picked.path) setRootPath(picked.path)
  }
  const submit = async () => {
    if (!name.trim() || !rootName.trim() || !rootPath.trim() || submitting) return
    setSubmitting(true)
    setRootError(null)
    const validationError = onValidateRoot ? await onValidateRoot(rootPath.trim()) : null
    if (validationError) {
      setRootError(validationError)
      setSubmitting(false)
      return
    }
    const ok = await onCreate({ name: name.trim(), description: description.trim(), root: { name: rootName.trim(), path: rootPath.trim() } })
    setSubmitting(false)
    if (ok) onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="New workspace" subtitle="A workspace bundles one or more root folders and runs its own Oz, priorities, and runs." icon="cube" width={620}
      footer={<>
        <div style={{ flex: 1, fontSize: 11, color: 'var(--cb-text-muted)' }}>You can add more roots and assign Writable / Read-only roles after creating it.</div>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="cube" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? 'Creating...' : 'Create & open'}</Button>
      </>}>
      <div style={{ marginBottom: 16 }}><label className="oz-field-label">Workspace name</label><input className="oz-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AcmeCRM, Vault, Internal Tools" /></div>
      <div style={{ marginBottom: 20 }}><label className="oz-field-label">Description</label><textarea className="oz-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this workspace for? Oz reads this on every conversation." rows={2} /></div>
      <div className="oz-section-marker lhs">Primary root</div>
      <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', marginBottom: 12, lineHeight: 1.55 }}>The main working repo. Where CoCoder picks up and writes freely. Exactly one Primary per workspace.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
        <div><label className="oz-field-label">Name</label><input className="oz-input" value={rootName} onChange={(e) => setRootName(e.target.value)} placeholder="cocoder-cli" /></div>
        <div>
          <label className="oz-field-label">Path</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="oz-input" value={rootPath} style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12 }} onChange={(e) => { setRootPath(e.target.value); setRootError(null) }} placeholder="~/dev/cocoder-cli" />
            <button className="oz-iconbtn" type="button" title="Pick folder" aria-label="Pick primary root folder" disabled={!onPickRoot || picking || submitting} onClick={() => void pickRoot()}><Icon name="folder-notch-open" size={14} /></button>
          </div>
          {rootError && <div className="oz-field-help" style={{ color: 'var(--cb-error)', marginTop: 6 }}>{rootError}</div>}
        </div>
      </div>
    </Modal>
  )
}

export function NewPriorityModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (p: { title: string; goal?: string; placeAtTop: boolean }) => boolean | Promise<boolean> }) {
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [placeAtTop, setPlaceAtTop] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => { if (open) { setTitle(''); setGoal(''); setPlaceAtTop(false); setSubmitting(false) } }, [open])
  const valid = title.trim()
  const submit = async () => {
    if (!valid || submitting) return
    setSubmitting(true)
    const ok = await onSubmit({ title: title.trim(), goal: goal.trim() || undefined, placeAtTop })
    setSubmitting(false)
    if (ok) onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="New priority" subtitle="File a workspace priority for the team to build." icon="plus" width={620}
      footer={<>
        <div style={{ flex: 1, fontSize: 11, color: 'var(--cb-text-muted)' }}>Oz will dispatch from the queue when you launch the priority.</div>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="plus" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? 'Creating…' : 'Create priority'}</Button>
      </>}>
      <div style={{ marginBottom: 16 }}><label className="oz-field-label">Title</label><input className="oz-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Add priority creation UI" /></div>
      <div style={{ marginBottom: 16 }}><label className="oz-field-label">Goal</label><textarea className="oz-textarea" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should be true when this is done?" rows={4} /></div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px 14px', background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)' }}>
        <input type="checkbox" checked={placeAtTop} onChange={(e) => setPlaceAtTop(e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--cb-accent)' }} />
        <span style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500 }}>Place at top</span>
      </label>
    </Modal>
  )
}

export function NewTicketModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (t: { title: string; type: string; priority?: string; description?: string }) => boolean | Promise<boolean> }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('task')
  const [priority, setPriority] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => { if (open) { setTitle(''); setType('task'); setPriority(''); setDescription(''); setSubmitting(false) } }, [open])
  const valid = title.trim()
  const submit = async () => {
    if (!valid || submitting) return
    setSubmitting(true)
    const ok = await onSubmit({ title: title.trim(), type, priority: priority.trim() || undefined, description: description.trim() || undefined })
    setSubmitting(false)
    if (ok) onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="New ticket" subtitle="File a workspace ticket." icon="ticket" width={620}
      footer={<>
        <div style={{ flex: 1, fontSize: 11, color: 'var(--cb-text-muted)' }}>Tickets track bugs, questions, spikes, and follow-up tasks outside the priority queue.</div>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="ticket" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? 'Creating…' : 'Create ticket'}</Button>
      </>}>
      <div style={{ marginBottom: 16 }}><label className="oz-field-label">Title</label><input className="oz-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dashboard count is stale" /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div><label className="oz-field-label">Type</label><select className="oz-select" value={type} onChange={(e) => setType(e.target.value)}><option value="bug">bug</option><option value="task">task</option><option value="question">question</option><option value="spike">spike</option></select></div>
        <div><label className="oz-field-label">Priority</label><input className="oz-input" value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="priority slug (optional)" /></div>
      </div>
      <div><label className="oz-field-label">Description</label><textarea className="oz-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why does this ticket exist?" rows={4} /></div>
    </Modal>
  )
}

export function CraftPersonaModal({ open, onClose, clis, onSubmit }: { open: boolean; onClose: () => void; clis: Cli[]; onSubmit: (p: { name: string; summary: string; placeAtTop: boolean }) => boolean | Promise<boolean> }) {
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [description, setDescription] = useState('')
  const [cli, setCli] = useState('claude')
  const [model, setModel] = useState('Default')
  const [runMode, setRunMode] = useState<'visible' | 'headless'>('visible')
  const [capabilities, setCapabilities] = useState('')
  const [needsSubAgents, setNeedsSubAgents] = useState(false)
  const [subAgentSketch, setSubAgentSketch] = useState('')
  const [priority, setPriority] = useState('normal')
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => { if (open) { setName(''); setTagline(''); setDescription(''); setCli('claude'); setModel('Default'); setRunMode('visible'); setCapabilities(''); setNeedsSubAgents(false); setSubAgentSketch(''); setPriority('normal'); setSubmitting(false) } }, [open])
  const cliEntry = clis.find((c) => c.id === cli)
  const valid = name.trim() && tagline.trim()
  const submit = async () => {
    if (!valid || submitting) return
    setSubmitting(true)
    const ok = await onSubmit({ name: `Persona: ${name.trim()}`, summary: `${tagline.trim()}${description.trim() ? ' — ' + description.trim() : ''}`, placeAtTop: priority === 'next' })
    setSubmitting(false)
    if (ok) onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Craft a new persona" subtitle="Sketch the role. Oz files it as a workspace priority — the team builds the persona itself (prompt, Skills (Plays), tests)." icon="hammer" width={680}
      footer={<>
        <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', flex: 1, lineHeight: 1.5 }}><Icon name="info" size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />Personas aren't configured — they're <span style={{ color: 'var(--cb-accent)' }}>built</span>. Once Bob ships and Talia / Quinn green-light, the persona appears here.</div>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="plus" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? 'Filing…' : 'File as priority'}</Button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div><label className="oz-field-label">Persona name</label><input className="oz-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Translator, Designer, Auditor" /></div>
        <div><label className="oz-field-label">Role tagline</label><input className="oz-input" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="One line — what they do" /></div>
      </div>
      <div style={{ marginBottom: 16 }}><label className="oz-field-label">Description</label><textarea className="oz-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Couple sentences. When does this persona get pulled in? What's their lane?" rows={3} /></div>
      <div className="oz-section-marker lhs">Default config</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div><label className="oz-field-label">CLI</label><select className="oz-select" value={cli} onChange={(e) => { setCli(e.target.value); setModel('Default') }}>{clis.map((c) => <option key={c.id} value={c.id} disabled={c.status !== 'ok'}>{c.name}{c.status !== 'ok' ? ' (unavailable)' : ''}</option>)}</select></div>
        <div><label className="oz-field-label">Model</label><select className="oz-select" value={model} onChange={(e) => setModel(e.target.value)}>{(cliEntry?.models || ['Default']).map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
        <div><label className="oz-field-label">Run mode</label><div style={{ display: 'flex', gap: 6, padding: 2, background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)' }}>{(['visible', 'headless'] as const).map((m) => <button key={m} onClick={() => setRunMode(m)} style={{ flex: 1, padding: '6px 8px', background: runMode === m ? 'var(--cb-accent-muted)' : 'transparent', color: runMode === m ? 'var(--cb-accent)' : 'var(--cb-text-muted)', border: 'none', borderRadius: 3, fontSize: 11.5, cursor: 'pointer', textTransform: 'capitalize' }}>{m}</button>)}</div></div>
      </div>
      <div style={{ marginBottom: 16 }}><label className="oz-field-label">Capabilities sketch</label><textarea className="oz-textarea" value={capabilities} onChange={(e) => setCapabilities(e.target.value)} placeholder="What should this persona be able to do? Examples, edge cases, things they should never do." rows={3} /><div className="oz-field-help">Free-form. The team uses this to draft the system prompt and design tests.</div></div>
      <div style={{ padding: '12px 14px', background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}><input type="checkbox" checked={needsSubAgents} onChange={(e) => setNeedsSubAgents(e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--cb-accent)' }} /><span style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500 }}>This persona should use Skills (Plays)</span></label>
        {needsSubAgents && <textarea className="oz-textarea" value={subAgentSketch} onChange={(e) => setSubAgentSketch(e.target.value)} placeholder="Sketch the Skills (Plays). e.g. 'a fact-checker Play on Gemini Pro; a formatter Play on Haiku.'" rows={2} style={{ marginTop: 10 }} />}
      </div>
      <div className="oz-section-marker lhs">Priority placement</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {[{ v: 'next', label: 'Next up', help: 'Pin to the top of the priority list.' }, { v: 'normal', label: 'Add to list', help: 'Append at the current position.' }].map((opt) => (
          <div key={opt.v} onClick={() => setPriority(opt.v)} style={{ flex: 1, padding: '12px 14px', background: priority === opt.v ? 'var(--cb-accent-muted)' : 'var(--cb-bg-soft)', border: `1px solid ${priority === opt.v ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`, borderRadius: 'var(--cb-radius-md)', cursor: 'pointer' }}>
            <div style={{ fontSize: 13, color: priority === opt.v ? 'var(--cb-accent)' : 'var(--cb-text)', fontWeight: 500, marginBottom: 3 }}>{opt.label}</div>
            <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', lineHeight: 1.5 }}>{opt.help}</div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
