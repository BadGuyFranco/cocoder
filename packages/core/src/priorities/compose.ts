export interface ComposePriorityMarkdownInput {
  readonly id: string
  readonly title: string
  readonly goal: string
}

export interface ComposePriorityBodyInput {
  readonly objective: string
  readonly details?: string
}

export function composePriorityBody(input: ComposePriorityBodyInput): string {
  const objective = input.objective.trim()
  const details = input.details?.trim()
  if (details === undefined || details === '') return `## Objective\n\n${objective}`
  return `## Objective\n\n${objective}\n\n${details}`
}

export function composePriorityMarkdown(input: ComposePriorityMarkdownInput): string {
  const body = input.goal.endsWith('\n') ? input.goal : `${input.goal}\n`
  return `---\nid: ${input.id}\ntitle: ${input.title}\n---\n${body}`
}
