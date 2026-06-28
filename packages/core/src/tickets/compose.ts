export const TICKET_OWNER = 'founder-session'

export interface ComposeTicketMarkdownInput {
  readonly title: string
  readonly type: string
  readonly priority: string
  readonly bindingReason?: string | null
  readonly provenance?: string | null
  readonly description: string
}

function optionalLine(key: string, value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? `${key}: ${trimmed}\n` : ''
}

export function composeTicketMarkdown(id: string, input: ComposeTicketMarkdownInput, created: string): string {
  const body = input.description === '' ? '## Context\n' : `${input.description}\n`
  return `---\nid: ${id}\ntitle: ${input.title}\ntype: ${input.type}\nstatus: Open\npriority: ${input.priority}\n${optionalLine('binding-reason', input.bindingReason)}${optionalLine('provenance', input.provenance)}owner: ${TICKET_OWNER}\ncreated: ${created}\n---\n\n# ${id} — ${input.title}\n\n${body}`
}
