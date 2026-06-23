export interface RunDisplayInput {
  readonly id: string
  readonly displayNumber?: number | null
}

export function runDisplayNumber(run: RunDisplayInput): number | null {
  const value = run.displayNumber
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

export function runDisplayName(run: RunDisplayInput): string {
  const displayNumber = runDisplayNumber(run)
  return displayNumber === null ? run.id : `workspace run ${displayNumber}`
}

export function coCoderRunReference(run: RunDisplayInput): string {
  const displayNumber = runDisplayNumber(run)
  return displayNumber === null ? run.id : `workspace run ${displayNumber} (technical id: ${run.id})`
}
