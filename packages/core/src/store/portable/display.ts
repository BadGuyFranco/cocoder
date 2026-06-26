export interface RunDisplayInput {
  readonly id: string
  readonly displayNumber?: number | null
  readonly workspaceName?: string | null
}

export function runDisplayNumber(run: RunDisplayInput): number | null {
  const value = run.displayNumber
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function runDisplayBase(run: RunDisplayInput, displayNumber: number): string {
  const workspaceName = run.workspaceName?.trim() || 'workspace'
  return `${workspaceName} run ${displayNumber}`
}

export function runDisplayName(run: RunDisplayInput): string {
  const displayNumber = runDisplayNumber(run)
  return displayNumber === null ? run.id : runDisplayBase(run, displayNumber)
}

export function coCoderRunReference(run: RunDisplayInput): string {
  const displayNumber = runDisplayNumber(run)
  return displayNumber === null ? run.id : `${runDisplayBase(run, displayNumber)} (technical id: ${run.id})`
}
