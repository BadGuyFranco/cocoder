export interface DebTerminalReader {
  readonly label: 'oscar' | 'bob'
  readonly refId: string
  readonly readScreen: () => Promise<string>
}

export interface DebTerminalSnapshotPersona {
  readonly label: 'oscar' | 'bob'
  readonly refId: string
  readonly available: boolean
  readonly screen: string
  readonly error: string | null
}

export interface DebTerminalSnapshot {
  readonly runId: string
  readonly generatedAt: number
  readonly personas: readonly DebTerminalSnapshotPersona[]
}

export async function captureDebTerminalSnapshot(input: {
  readonly runId: string
  readonly readers: readonly DebTerminalReader[]
  readonly now?: () => number
}): Promise<DebTerminalSnapshot> {
  const personas = await Promise.all(
    input.readers.map(async (reader): Promise<DebTerminalSnapshotPersona> => {
      try {
        return {
          label: reader.label,
          refId: reader.refId,
          available: true,
          screen: await reader.readScreen(),
          error: null,
        }
      } catch (err) {
        return {
          label: reader.label,
          refId: reader.refId,
          available: false,
          screen: '',
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )

  return {
    runId: input.runId,
    generatedAt: (input.now ?? Date.now)(),
    personas,
  }
}

export function renderDebTerminalSnapshotMarkdown(snapshot: DebTerminalSnapshot): string {
  const lines: string[] = []
  lines.push(`# Terminal snapshot — ${snapshot.runId}`, '')
  lines.push(`Generated: ${new Date(snapshot.generatedAt).toISOString()}`, '')
  for (const persona of snapshot.personas) {
    lines.push(`## ${persona.label}`, '')
    lines.push(`- **Ref:** \`${persona.refId}\``)
    lines.push(`- **Available:** ${persona.available ? 'yes' : 'no'}`)
    if (persona.error) lines.push(`- **Read error:** ${persona.error}`)
    lines.push('', '```text', persona.screen.trimEnd(), '```', '')
  }
  return lines.join('\n')
}
