// Slice 1 thin Oz chat backend. No daemon chat endpoint exists yet (see ENDPOINTS OWED: POST
// /oz/messages + GET /oz/stream). Until it lands, Oz acknowledges from the MAIN process so the chat is
// a real working shell with GUI⇄Oz parity as the design goal — not a dead box. Deterministic (no
// clock/random) so tests + screenshots are stable; the caller stamps `at`.
import type { ChatMessage } from './ipc-contract.ts'

export function ozReply(text: string, at: number): ChatMessage {
  const t = text.trim().toLowerCase()
  let reply: string
  if (!t) reply = 'Tell me what to do — launch a priority, start an ad-hoc run, or ask for status.'
  else if (t.startsWith('launch') || t.includes('run ')) reply = `Use the Priorities panel's Launch (or tell me which priority) — wiring to POST /oz/messages is owed. For now I echo: "${text}".`
  else if (t.includes('status')) reply = 'Status lives in the Runs panel (timeline + evidence). A live Oz watcher arrives with the /oz/stream endpoint.'
  else reply = `Oz (stub): "${text}". GUI⇄Oz parity is the goal — every button here will also be a thing you ask me, once POST /oz/messages exists.`
  return { role: 'oz', text: reply, at }
}
