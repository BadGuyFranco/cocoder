// Oz Terminal — THE command center. A live conversation with the workspace's headless Oz. Messages
// can carry inline run cards (pivot to inspection) and a decision callout (resolve a blocked run
// without leaving the thread). Quick-prompt pills pre-fill common ops. Ported from design-ref.
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Icon, Button, StatusChip } from '../../ui/primitives.tsx'
import { OzGlobalControls, type ShellTheme } from '../../ui/ShellControls.tsx'
import { runDisplayName, type ChatMessage, type Run, type Workspace } from '../../model.ts'

const markdownTextStyle = { fontSize: 13.5, color: 'var(--cb-text)', lineHeight: 1.65 } as const
const inlineCodeStyle = { fontFamily: 'var(--cb-font-mono)', fontSize: '0.92em', background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 3, padding: '1px 4px' } as const
const OZ_ITEM_MIME = 'application/x-oz-item'

type OzItemPointer = {
  readonly itemType: 'priority' | 'ticket' | 'run'
  readonly id: string
  readonly label: string
}

function hasOzItem(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(OZ_ITEM_MIME)
}

function parseOzItem(raw: string): OzItemPointer | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const itemType = value.itemType
    if (itemType !== 'priority' && itemType !== 'ticket' && itemType !== 'run') return null
    if (typeof value.id !== 'string' || typeof value.label !== 'string') return null
    if (!value.id.trim() || !value.label.trim()) return null
    return { itemType, id: value.id, label: value.label }
  } catch {
    return null
  }
}

function contextLine(pointer: OzItemPointer): string {
  return `[context: ${pointer.itemType} ${pointer.id} — ${pointer.label}]`
}

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? url.href : null
  } catch {
    return null
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  const pushText = (end: number) => {
    if (end > i) out.push(text.slice(i, end))
    i = end
  }
  while (i < text.length) {
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i) {
        out.push(<code key={`${keyPrefix}-code-${i}`} style={inlineCodeStyle}>{text.slice(i + 1, end)}</code>)
        i = end + 1
        continue
      }
    }
    if (text.startsWith('**', i) || text.startsWith('__', i)) {
      const marker = text.slice(i, i + 2)
      const end = text.indexOf(marker, i + 2)
      if (end > i) {
        out.push(<strong key={`${keyPrefix}-strong-${i}`} style={{ color: 'var(--cb-text)', fontWeight: 600 }}>{renderInline(text.slice(i + 2, end), `${keyPrefix}-strong-${i}`)}</strong>)
        i = end + 2
        continue
      }
    }
    if (text[i] === '[') {
      const labelEnd = text.indexOf(']', i + 1)
      const hrefStart = labelEnd >= 0 && text[labelEnd + 1] === '(' ? labelEnd + 2 : -1
      const hrefEnd = hrefStart >= 0 ? text.indexOf(')', hrefStart) : -1
      if (labelEnd > i && hrefEnd > hrefStart) {
        const label = renderInline(text.slice(i + 1, labelEnd), `${keyPrefix}-link-${i}`)
        const href = safeHref(text.slice(hrefStart, hrefEnd).trim())
        out.push(href
          ? <a key={`${keyPrefix}-link-${i}`} href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cb-accent)', textDecoration: 'underline' }}>{label}</a>
          : <span key={`${keyPrefix}-link-${i}`}>{label}</span>)
        i = hrefEnd + 1
        continue
      }
    }
    if (text[i] === '*' || text[i] === '_') {
      const marker = text[i]!
      if (text[i + 1] !== marker) {
        const end = text.indexOf(marker, i + 1)
        if (end > i) {
          out.push(<em key={`${keyPrefix}-em-${i}`}>{renderInline(text.slice(i + 1, end), `${keyPrefix}-em-${i}`)}</em>)
          i = end + 1
          continue
        }
      }
    }
    const next = ['`', '*', '_', '['].map((marker) => text.indexOf(marker, i + 1)).filter((idx) => idx >= 0).sort((a, b) => a - b)[0] ?? text.length
    pushText(next)
  }
  return out
}

function heading(level: number, children: ReactNode, key: string): ReactNode {
  const style = { margin: '12px 0 6px', color: 'var(--cb-text)', fontWeight: 600, lineHeight: 1.3, fontSize: level === 1 ? 17 : level === 2 ? 15.5 : 14 } as const
  if (level === 1) return <h1 key={key} style={style}>{children}</h1>
  if (level === 2) return <h2 key={key} style={style}>{children}</h2>
  if (level === 3) return <h3 key={key} style={style}>{children}</h3>
  if (level === 4) return <h4 key={key} style={style}>{children}</h4>
  if (level === 5) return <h5 key={key} style={style}>{children}</h5>
  return <h6 key={key} style={style}>{children}</h6>
}

function MarkdownBody({ body }: { body: string }) {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i += 1
      continue
    }
    if (line.trimStart().startsWith('```')) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        code.push(lines[i]!)
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push(<pre key={`pre-${i}`} style={{ margin: '10px 0', overflowX: 'auto', background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', padding: '10px 12px' }}><code style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12, color: 'var(--cb-text)' }}>{code.join('\n')}</code></pre>)
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      blocks.push(heading(h[1]!.length, renderInline(h[2]!, `h-${i}`), `h-${i}`))
      i += 1
      continue
    }
    const list = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/)
    if (list) {
      const ordered = /^\d/.test(list[2]!)
      const items: ReactNode[] = []
      while (i < lines.length) {
        const item = lines[i]!.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/)
        if (!item || /^\d/.test(item[2]!) !== ordered) break
        items.push(<li key={`li-${i}`}>{renderInline(item[3]!, `li-${i}`)}</li>)
        i += 1
      }
      const style = { margin: '8px 0', paddingLeft: 22 } as const
      blocks.push(ordered ? <ol key={`ol-${i}`} style={style}>{items}</ol> : <ul key={`ul-${i}`} style={style}>{items}</ul>)
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.trimStart().startsWith('```') && !/^(#{1,6})\s+/.test(lines[i]!) && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]!)) {
      paragraph.push(lines[i]!)
      i += 1
    }
    blocks.push(<p key={`p-${i}`} style={{ margin: blocks.length === 0 ? 0 : '8px 0 0', whiteSpace: 'pre-wrap' }}>{renderInline(paragraph.join('\n'), `p-${i}`)}</p>)
  }
  return <div style={markdownTextStyle}>{blocks}</div>
}

function PlainBody({ body }: { body: string }) {
  return <div style={{ ...markdownTextStyle, whiteSpace: 'pre-wrap' }}>{body}</div>
}

function ChatMessageView({ msg, runs, onSelectRun, onDecision }: { msg: ChatMessage; runs: Run[]; onSelectRun: (id: string) => void; onDecision: (choice: string) => void }) {
  const isOz = msg.role === 'oz', isUser = msg.role === 'user'
  const roleLabel = isOz ? 'Oz' : isUser ? 'You' : msg.role
  const roleColor = isOz ? 'var(--cb-accent)' : isUser ? 'var(--cb-text)' : 'var(--cb-text-secondary)'
  return (
    <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--cb-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--cb-font-display)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: roleColor, fontWeight: 600 }}>{roleLabel}</span>
        {isOz && <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 9.5, color: 'var(--cb-text-muted)', padding: '1px 6px', border: '1px solid var(--cb-border)', borderRadius: 2 }}>orchestrator · headless</span>}
        <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)', marginLeft: 'auto' }}>{msg.time}</span>
      </div>
      {isOz ? <MarkdownBody body={msg.body} /> : <PlainBody body={msg.body} />}
      {msg.attachments?.map((a, i) => {
        if (a.kind !== 'run-card') return null
        const run = runs.find((r) => r.id === a.runId)
        if (!run) return null
        return (
          <div key={i} onClick={() => onSelectRun(run.id)} style={{ marginTop: 10, padding: 12, background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--cb-accent-30)')} onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--cb-border)')}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><StatusChip status={run.status} /><span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{runDisplayName(run)}</span></div>
              <div style={{ fontSize: 12.5, color: 'var(--cb-text)', fontWeight: 500 }}>{run.title}</div>
              <div style={{ fontSize: 11, color: 'var(--cb-text-muted)', marginTop: 3 }}>{run.personas.join(' · ')} · started {run.startedAt}</div>
            </div>
            <Icon name="arrow-right" size={14} style={{ color: 'var(--cb-text-muted)' }} />
          </div>
        )
      })}
      {msg.flag === 'decision' && (
        <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--cb-highlight-muted)', border: '1px solid rgba(212,118,110,0.20)', borderRadius: 'var(--cb-radius-md)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Icon name="warning-circle" size={18} style={{ color: 'var(--cb-highlight)' }} />
          <div style={{ fontSize: 12, color: 'var(--cb-highlight)', flex: 1, minWidth: 200 }}>Oz is waiting for your call before this run can continue.</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="secondary" size="sm" onClick={() => onDecision('full')}>Replay full plan</Button>
            <Button variant="ghost" size="sm" onClick={() => onDecision('partial')}>Partial</Button>
          </div>
        </div>
      )}
    </div>
  )
}

const QUICK_PROMPTS = [
  { label: 'Status check', prompt: 'Status across the workspace?' },
  { label: 'Launch next priority', prompt: 'Launch the next priority.' },
  { label: 'Ad-hoc run', prompt: 'adhoc ' },
  { label: 'Reorder priorities', prompt: 'Promote #4 to the top.' },
]

function ChatTargetPicker({ targets, value, onChange }: { targets: Workspace[]; value: string | null; onChange: (target: string | null) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, minWidth: 0 }}>
      <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, flexShrink: 0 }}>Target</span>
      <select
        aria-label="Oz chat target"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? e.target.value : null)}
        style={{ flex: '0 1 280px', minWidth: 180, maxWidth: '100%', background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', color: 'var(--cb-text)', padding: '6px 9px', fontFamily: 'var(--cb-font-body)', fontSize: 12.5 }}
      >
        <option value="">Global Oz · no workspace</option>
        {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
      </select>
    </div>
  )
}

export function OzChatPanel({ messages, runs, workspaceName, onSend, onSelectRun, onDecision, ozTyping, prefill = null, onPrefillConsumed, theme = 'dark', setTheme = () => undefined, conn = 'fixtures', onRestartOz, chatTarget = null, chatTargets = [], onChatTargetChange = () => undefined }: {
  messages: ChatMessage[]; runs: Run[]; workspaceName: string; onSend: (text: string) => void
  onSelectRun: (id: string) => void; onDecision: (choice: string) => void; ozTyping: boolean; live?: boolean
  prefill?: string | null; onPrefillConsumed?: () => void
  theme?: ShellTheme; setTheme?: (fn: (t: ShellTheme) => ShellTheme) => void; conn?: string; onRestartOz?: () => void
  chatTarget?: string | null; chatTargets?: Workspace[]; onChatTargetChange?: (target: string | null) => void
}) {
  const [text, setText] = useState('')
  const [attachedPointer, setAttachedPointer] = useState<OzItemPointer | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, [messages.length, ozTyping])
  const fillPrompt = (prompt: string) => {
    setText(prompt)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }
  useEffect(() => {
    if (!prefill) return
    fillPrompt(prefill)
    onPrefillConsumed?.()
  }, [prefill, onPrefillConsumed])
  const onPointerDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasOzItem(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }
  const onPointerDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasOzItem(e.dataTransfer)) return
    e.preventDefault()
    setDropActive(false)
    const pointer = parseOzItem(e.dataTransfer.getData(OZ_ITEM_MIME))
    if (pointer) setAttachedPointer(pointer)
  }
  const send = () => {
    const trimmed = text.trim()
    if (!trimmed && !attachedPointer) return
    const outgoing = attachedPointer ? `${contextLine(attachedPointer)}${trimmed ? `\n${text}` : ''}` : text
    onSend(outgoing)
    setText('')
    setAttachedPointer(null)
  }
  return (
    <div className="oz-panel" style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -1, left: -1, width: 14, height: 14, borderTop: '1px solid var(--cb-accent)', borderLeft: '1px solid var(--cb-accent)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -1, right: -1, width: 14, height: 14, borderBottom: '1px solid var(--cb-accent)', borderRight: '1px solid var(--cb-accent)', pointerEvents: 'none' }} />
      <div className="oz-panel-header" style={{ padding: '14px 24px' }}>
        <Icon name="eye" size={16} style={{ color: 'var(--cb-accent)' }} />
        <div>
          <div style={{ fontFamily: 'var(--cb-font-display)', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--cb-text)', fontWeight: 600 }}>Oz Terminal</div>
          <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)', marginTop: 2 }}>headless oz · bound to <span style={{ color: 'var(--cb-accent)' }}>{workspaceName}</span></div>
        </div>
        <span className="oz-chip oz-chip-running" style={{ marginLeft: 'auto' }}><span className="dot" />watching</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <OzGlobalControls theme={theme} setTheme={setTheme} conn={conn} onRestartOz={onRestartOz} />
        </div>
      </div>
      <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {messages.map((m) => <ChatMessageView key={m.id} msg={m} runs={runs} onSelectRun={onSelectRun} onDecision={onDecision} />)}
        {ozTyping && (
          <div style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--cb-font-display)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--cb-accent)', fontWeight: 600 }}>Oz</span>
            <span style={{ display: 'inline-flex', gap: 3 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--cb-accent)', opacity: 0.5, animation: `ozPulse 1.2s ${i * 0.15}s infinite` }} />)}</span>
          </div>
        )}
      </div>
      <div style={{ borderTop: '1px solid var(--cb-border)', padding: '12px 24px 14px' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {QUICK_PROMPTS.map((qp) => (
            <button key={qp.label} onClick={() => fillPrompt(qp.prompt)} style={{ background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', color: 'var(--cb-text-secondary)', padding: '4px 10px', borderRadius: 'var(--cb-radius-pill)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--cb-font-body)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--cb-accent-15)'; e.currentTarget.style.color = 'var(--cb-accent)' }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--cb-border)'; e.currentTarget.style.color = 'var(--cb-text-secondary)' }}>{qp.label}</button>
          ))}
        </div>
        <ChatTargetPicker targets={chatTargets} value={chatTarget} onChange={onChatTargetChange} />
        {attachedPointer && (
          <div style={{ display: 'inline-flex', maxWidth: '100%', alignItems: 'center', gap: 7, marginBottom: 8, padding: '4px 8px', border: '1px solid var(--cb-accent-30)', borderRadius: 4, background: 'var(--cb-accent-muted)', color: 'var(--cb-text)', fontSize: 11.5 }}>
            <span style={{ fontFamily: 'var(--cb-font-mono)', color: 'var(--cb-accent)' }}>{attachedPointer.itemType}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachedPointer.label}</span>
            <span style={{ fontFamily: 'var(--cb-font-mono)', color: 'var(--cb-text-muted)' }}>{attachedPointer.id}</span>
            <button type="button" aria-label="Remove attached context" onClick={() => setAttachedPointer(null)} style={{ border: 'none', background: 'transparent', color: 'var(--cb-text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
          </div>
        )}
        <div aria-label="Oz message composer" onDragEnter={onPointerDragOver} onDragOver={onPointerDragOver} onDragLeave={() => setDropActive(false)} onDrop={onPointerDrop} style={{ display: 'flex', alignItems: 'flex-end', gap: 10, background: 'var(--cb-bg-soft)', border: `1px solid ${dropActive ? 'var(--cb-accent)' : 'var(--cb-border)'}`, boxShadow: dropActive ? '0 0 0 2px var(--cb-accent-30)' : 'none', borderRadius: 'var(--cb-radius-md)', padding: '10px 12px', transition: 'border-color 120ms ease-out, box-shadow 120ms ease-out' }}>
          <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12, color: 'var(--cb-accent)', userSelect: 'none' }}>›</span>
          <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="Tell Oz what to do — launch a run, reorder, ask for status…" rows={1} aria-label="Message Oz" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--cb-text)', resize: 'none', fontFamily: 'var(--cb-font-body)', fontSize: 13.5, lineHeight: 1.5, maxHeight: 120 }} />
          <button onClick={send} className="oz-btn oz-btn-primary oz-btn-sm" style={{ padding: '6px 10px' }} disabled={!text.trim() && !attachedPointer}><Icon name="paper-plane-tilt" size={13} />Send</button>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>
          <span><span className="oz-kbd" style={{ fontSize: 9 }}>⏎</span> send</span>
          <span><span className="oz-kbd" style={{ fontSize: 9 }}>⇧⏎</span> new line</span>
          <span style={{ marginLeft: 'auto' }}>oz model: claude opus 4.5 · ctx 28k / 200k</span>
        </div>
      </div>
    </div>
  )
}
