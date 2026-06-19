import { ozReply } from './chat.ts'
import { ozChat } from './daemon-client.ts'
import type { ChatMessage } from './ipc-contract.ts'

export async function sendChatMessage(workspaceId: string, text: string, at = Date.now()): Promise<ChatMessage> {
  const reply = await ozChat(workspaceId, text)
  if (reply.ok) return { role: 'oz', text: reply.data.reply, at }
  return ozReply(text, at)
}
