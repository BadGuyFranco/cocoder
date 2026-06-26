// Size-based log rotation (design point #5). Pure decision (`planLogRotation`) + a gated apply
// (`rotateLogFile`). INERT unless enabled — when disabled, ZERO filesystem access. Rotation shifts the
// live file to `.1`, `.1`→`.2`, … keeping at most `maxGenerations` numbered generations; the oldest is
// deleted. Renames are emitted highest-generation-first so applying them in order never clobbers a file.

import { rename, rm, stat } from 'node:fs/promises'

export interface LogRotationPlan {
  readonly rotate: boolean
  readonly deletes: readonly string[] // paths to unlink (oldest beyond maxGenerations), in delete order
  readonly renames: readonly { readonly from: string; readonly to: string }[] // ordered highest-gen first to avoid clobber
}

export function planLogRotation(opts: {
  path: string
  sizeBytes: number
  thresholdBytes: number
  maxGenerations: number
}): LogRotationPlan {
  if (!Number.isInteger(opts.thresholdBytes) || opts.thresholdBytes < 1) {
    throw new RangeError(`thresholdBytes must be an integer >= 1, got ${opts.thresholdBytes}`)
  }
  if (!Number.isInteger(opts.maxGenerations) || opts.maxGenerations < 1) {
    throw new RangeError(`maxGenerations must be an integer >= 1, got ${opts.maxGenerations}`)
  }

  if (opts.sizeBytes < opts.thresholdBytes) {
    return { rotate: false, deletes: [], renames: [] }
  }

  const { path, maxGenerations } = opts

  // The highest-numbered generation would be pushed out of the retained window → delete it.
  const deletes: string[] = [`${path}.${maxGenerations}`]

  // Shift generations from highest down so each target slot is free before we write to it.
  const renames: { readonly from: string; readonly to: string }[] = []
  for (let g = maxGenerations - 1; g >= 1; g--) {
    renames.push({ from: `${path}.${g}`, to: `${path}.${g + 1}` })
  }
  renames.push({ from: path, to: `${path}.1` })

  return { rotate: true, deletes, renames }
}

export async function rotateLogFile(opts: {
  path: string
  thresholdBytes: number
  maxGenerations: number
  enabled: boolean
  log?: (m: string) => void
}): Promise<LogRotationPlan & { rotated: boolean }> {
  const log = opts.log ?? (() => {})

  if (!opts.enabled) {
    return { rotate: false, deletes: [], renames: [], rotated: false }
  }

  let size: number
  try {
    const stats = await stat(opts.path)
    size = stats.size
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { rotate: false, deletes: [], renames: [], rotated: false }
    }
    throw err
  }

  const plan = planLogRotation({
    path: opts.path,
    sizeBytes: size,
    thresholdBytes: opts.thresholdBytes,
    maxGenerations: opts.maxGenerations,
  })
  if (!plan.rotate) {
    return { ...plan, rotated: false }
  }

  for (const del of plan.deletes) {
    await rm(del, { force: true })
  }
  for (const { from, to } of plan.renames) {
    // A generation file may not exist yet (e.g. first rotation has no `path.1`) — skip ENOENT.
    try {
      await rename(from, to)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
  }

  log(`[retention] rotated ${opts.path}`)
  return { ...plan, rotated: true }
}
