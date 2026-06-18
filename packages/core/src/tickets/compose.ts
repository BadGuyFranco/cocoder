export const TICKET_OWNER = 'founder-session'

export interface ComposeTicketMarkdownInput {
  readonly title: string
  readonly type: string
  readonly priority: string
  readonly description: string
}

export function composeTicketMarkdown(id: string, input: ComposeTicketMarkdownInput, created: string): string {
  const body = input.description === '' ? '## Context\n' : `${input.description}\n`
  return `---\nid: ${id}\ntitle: ${input.title}\ntype: ${input.type}\nstatus: Open\npriority: ${input.priority}\nowner: ${TICKET_OWNER}\ncreated: ${created}\n---\n\n# ${id} — ${input.title}\n\n${body}`
}
