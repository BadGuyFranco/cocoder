export class StopRequestedError extends Error {
  constructor() {
    super('stop requested')
    this.name = 'StopRequestedError'
  }
}

export function throwIfStopRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw new StopRequestedError()
}

export function isStopRequestedError(error: unknown): error is StopRequestedError {
  return error instanceof StopRequestedError
}
