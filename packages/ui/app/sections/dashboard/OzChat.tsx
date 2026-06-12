// Oz Terminal — THE command center. A live conversation with the workspace's headless Oz. Messages
// can carry inline run cards (pivot to inspection) and a decision callout (resolve a blocked run
// without leaving the thread). Quick-prompt pills pre-fill common ops. Ported from design-ref.
import { useEffect, useRef, useState } from 'react'
import { Icon, Button, StatusChip } from '../../ui/primitives.tsx'
import type { ChatMessage, Run } from '../../model.ts'

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
      <div style={{ fontSize: 13.5, color: 'var(--cb-text)', lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: msg.body.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--cb-text);font-weight:600">$1</strong>') }} />
      {msg.attachments?.map((a, i) => {
        if (a.kind !== 'run-card') return null
        const run = runs.find((r) => r.id === a.runId)
        if (!run) return null
        return (
          <div key={i} onClick={() => onSelectRun(run.id)} style={{ marginTop: 10, padding: 12, background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--cb-accent-30)')} onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--cb-border)')}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><StatusChip status={run.status} /><span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10, color: 'var(--cb-text-muted)' }}>{run.id}</span></div>
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

export function OzChatPanel({ messages, runs, workspaceName, onSend, onSelectRun, onDecision, ozTyping, live = false, prefill = null, onPrefillConsumed }: {
  messages: ChatMessage[]; runs: Run[]; workspaceName: string; onSend: (text: string) => void
  onSelectRun: (id: string) => void; onDecision: (choice: string) => void; ozTyping: boolean; live?: boolean
  prefill?: string | null; onPrefillConsumed?: () => void
}) {
  const [text, setText] = useState('')
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
  const send = () => { if (!text.trim()) return; onSend(text); setText('') }
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
        <button className="oz-iconbtn" title="Conversation menu" style={{ width: 28, height: 28 }}><Icon name="dots-three" size={14} /></button>
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
        {live && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '7px 10px', background: 'var(--cb-highlight-muted)', border: '1px solid rgba(212,118,110,0.25)', borderRadius: 'var(--cb-radius-md)', fontSize: 10.5, color: 'var(--cb-text-secondary)', lineHeight: 1.5 }}>
            <Icon name="warning-circle" size={13} style={{ color: 'var(--cb-highlight)', flexShrink: 0 }} />
            <span>Oz commands run through the daemon. Use <code>launch &lt;priorityId&gt;</code>, <code>adhoc &lt;task&gt;</code>, <code>status</code>, or the dashboard shortcuts.</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {QUICK_PROMPTS.map((qp) => (
            <button key={qp.label} onClick={() => fillPrompt(qp.prompt)} style={{ background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', color: 'var(--cb-text-secondary)', padding: '4px 10px', borderRadius: 'var(--cb-radius-pill)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--cb-font-body)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--cb-accent-15)'; e.currentTarget.style.color = 'var(--cb-accent)' }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--cb-border)'; e.currentTarget.style.color = 'var(--cb-text-secondary)' }}>{qp.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, background: 'var(--cb-bg-soft)', border: '1px solid var(--cb-border)', borderRadius: 'var(--cb-radius-md)', padding: '10px 12px' }}>
          <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12, color: 'var(--cb-accent)', userSelect: 'none' }}>›</span>
          <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="Tell Oz what to do — launch a run, reorder, ask for status…" rows={1} aria-label="Message Oz" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--cb-text)', resize: 'none', fontFamily: 'var(--cb-font-body)', fontSize: 13.5, lineHeight: 1.5, maxHeight: 120 }} />
          <button onClick={send} className="oz-btn oz-btn-primary oz-btn-sm" style={{ padding: '6px 10px' }} disabled={!text.trim()}><Icon name="paper-plane-tilt" size={13} />Send</button>
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
