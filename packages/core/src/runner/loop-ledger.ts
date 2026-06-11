import { readFile } from 'node:fs/promises'

export interface LoopLedgerEntry {
  readonly iteration: number
  readonly result: 'green' | 'red'
  readonly failed: string
  readonly changed: string
  readonly inScope: boolean
}

function parseEntry(line: string): LoopLedgerEntry | null {
  try {
    const data = JSON.parse(line) as {
      iteration?: unknown
      result?: unknown
      failed?: unknown
      changed?: unknown
      inScope?: unknown
    }
    if (!Number.isInteger(data.iteration) || (data.iteration as number) <= 0) return null
    if (data.result !== 'green' && data.result !== 'red') return null
    if (typeof data.failed !== 'string' || typeof data.changed !== 'string' || typeof data.inScope !== 'boolean') return null
    return {
      iteration: data.iteration as number,
      result: data.result,
      failed: data.failed,
      changed: data.changed,
      inScope: data.inScope,
    }
  } catch {
    return null
  }
}

export function parseLoopLedger(raw: string): readonly LoopLedgerEntry[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(parseEntry)
    .filter((entry): entry is LoopLedgerEntry => entry !== null)
}

export async function readLoopLedger(path: string): Promise<readonly LoopLedgerEntry[]> {
  try {
    return parseLoopLedger(await readFile(path, 'utf8'))
  } catch {
    return []
  }
}
