import { existsSync, renameSync, rmSync, statSync } from 'node:fs'

export interface RotateLogFileOptions {
  readonly maxBytes: number
  readonly keep: number
}

export function rotateLogFile(path: string, opts: RotateLogFileOptions): { rotated: boolean; sizeBytes: number } {
  if (!Number.isInteger(opts.keep) || opts.keep < 1) {
    throw new Error(`rotateLogFile keep must be >= 1`)
  }
  if (!existsSync(path)) return { rotated: false, sizeBytes: 0 }

  const sizeBytes = statSync(path).size
  if (sizeBytes < opts.maxBytes) return { rotated: false, sizeBytes }

  rmSync(generationPath(path, opts.keep), { force: true })
  for (let generation = opts.keep - 1; generation >= 1; generation -= 1) {
    const from = generationPath(path, generation)
    if (existsSync(from)) renameSync(from, generationPath(path, generation + 1))
  }
  renameSync(path, generationPath(path, 1))
  return { rotated: true, sizeBytes }
}

function generationPath(path: string, generation: number): string {
  return `${path}.${generation}`
}
