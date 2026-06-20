export interface ComposePriorityMarkdownInput {
  readonly id: string
  readonly title: string
  readonly goal: string
}

export function composePriorityMarkdown(input: ComposePriorityMarkdownInput): string {
  const body = input.goal.endsWith('\n') ? input.goal : `${input.goal}\n`
  return `---\nid: ${input.id}\ntitle: ${input.title}\n---\n${body}`
}
