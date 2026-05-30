// Oz chat — THE command center. A real working conversation (not a help bot) that drives the system.
// Today it talks to a main-process stub (chat.ts) because the daemon has no chat endpoint yet (see
// ENDPOINTS OWED: POST /oz/messages + GET /oz/stream). The seam is window.oz.chatSend, so when the
// endpoint lands the renderer is unchanged. One Oz per workspace: switching workspace resets the thread.
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../electron/ipc-contract.ts'

const GREETING = (ws: string): ChatMessage => ({
  role: 'oz',
  text: `Oz here — the command center for ${ws}. Ask me to launch a priority, start an ad-hoc run, reorder work, or for status. Every button on this Dashboard is also something you can ask me (GUI⇄Oz parity).`,
  at: 0,
})

export function OzChat({ wsId, wsName }: { wsId: string; wsName: string }): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING(wsName)])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  // one Oz per workspace — reset the conversation when the workspace context switches
  useEffect(() => {
    setMessages([GREETING(wsName)])
  }, [wsId, wsName])

  useEffect(() => {
    // jsdom (tests) has no scrollTo; guard so a missing method never throws in the render commit phase
    const el = logRef.current
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight })
  }, [messages])

  async function send(): Promise<void> {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    setMessages((m) => [...m, { role: 'founder', text, at: 0 }])
    try {
      const reply = await window.oz.chatSend(wsId, text)
      setMessages((m) => [...m, reply])
    } catch (e) {
      setMessages((m) => [...m, { role: 'oz', text: `(chat error: ${(e as Error).message})`, at: 0 }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            <span className="msg-who">{m.role === 'oz' ? 'Oz' : 'You'}</span>
            <div className="msg-text">{m.text}</div>
          </div>
        ))}
        {busy && <div className="msg msg-oz"><span className="msg-who">Oz</span><div className="msg-text typing">…</div></div>}
      </div>
      <div className="chat-note">
        Thin chat shell — wired to a local Oz stub. Full command execution + a live watcher arrive with the daemon's <span className="mono">POST /oz/messages</span> + <span className="mono">GET /oz/stream</span>.
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Message Oz about ${wsName}…`}
          aria-label="Message Oz"
        />
        <button className="btn" type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
