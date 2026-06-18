import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { portableWorkspacePaths } from './paths.js'
import { isMissingFile, readJsonLines, readOptionalJson, writeJson, writeJsonAtomic } from './json.js'

export interface PortableCountersFile {
  readonly schemaVersion: 1
  readonly nextTicketNumber: number
  readonly nextRunDisplayNumber: number
  readonly nextSessionDisplayNumber: number
}

export type PortableCounterName = 'nextTicketNumber' | 'nextRunDisplayNumber' | 'nextSessionDisplayNumber'

const LOCK_RETRY_MS = 10
const LOCK_RETRIES = 500

export const DEFAULT_PORTABLE_COUNTERS: PortableCountersFile = {
  schemaVersion: 1,
  nextTicketNumber: 1,
  nextRunDisplayNumber: 1,
  nextSessionDisplayNumber: 1,
}

export async function readPortableCounters(primaryRoot: string): Promise<PortableCountersFile> {
  return (await readOptionalJson<PortableCountersFile>(portableWorkspacePaths(primaryRoot).countersFile)) ?? DEFAULT_PORTABLE_COUNTERS
}

export async function writePortableCounters(primaryRoot: string, counters: PortableCountersFile): Promise<void> {
  await writeJson(portableWorkspacePaths(primaryRoot).countersFile, counters)
}

export async function allocatePortableCounter(primaryRoot: string, counter: PortableCounterName): Promise<number> {
  return withCountersLock(primaryRoot, async () => {
    const current = await readPortableCounters(primaryRoot)
    const allocated = current[counter]
    await writeJsonAtomic(portableWorkspacePaths(primaryRoot).countersFile, {
      ...current,
      [counter]: allocated + 1,
    })
    return allocated
  })
}

export function allocatePortableTicketNumber(primaryRoot: string): Promise<number> {
  return allocatePortableCounter(primaryRoot, 'nextTicketNumber')
}

export function allocatePortableRunDisplayNumber(primaryRoot: string): Promise<number> {
  return allocatePortableCounter(primaryRoot, 'nextRunDisplayNumber')
}

export function allocatePortableSessionDisplayNumber(primaryRoot: string): Promise<number> {
  return allocatePortableCounter(primaryRoot, 'nextSessionDisplayNumber')
}

export async function rebuildPortableCounters(primaryRoot: string): Promise<PortableCountersFile> {
  const counters: PortableCountersFile = {
    schemaVersion: 1,
    nextTicketNumber: (await maxTicketNumber(primaryRoot)) + 1,
    nextRunDisplayNumber: (await maxRunDisplayNumber(primaryRoot)) + 1,
    nextSessionDisplayNumber: (await maxSessionDisplayNumber(primaryRoot)) + 1,
  }
  await writePortableCounters(primaryRoot, counters)
  return counters
}

async function withCountersLock<T>(primaryRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockDir = `${portableWorkspacePaths(primaryRoot).countersFile}.lock`
  await acquireLock(lockDir)
  try {
    return await fn()
  } finally {
    await rm(lockDir, { recursive: true, force: true })
  }
}

async function acquireLock(lockDir: string): Promise<void> {
  await mkdir(dirname(lockDir), { recursive: true })
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      await mkdir(lockDir, { recursive: false })
      return
    } catch (error: unknown) {
      if (!isLockHeld(error)) throw error
      await sleep(LOCK_RETRY_MS)
    }
  }
  throw new Error(`Timed out waiting for portable counters lock: ${lockDir}`)
}

function isLockHeld(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

async function maxRunDisplayNumber(primaryRoot: string): Promise<number> {
  const runsDir = portableWorkspacePaths(primaryRoot).runsDir
  let entries: string[]
  try {
    entries = await readdir(runsDir)
  } catch (error: unknown) {
    if (isMissingFile(error)) return 0
    throw error
  }

  return entries.reduce((max, name) => Math.max(max, leadingNumber(name)), 0)
}

async function maxTicketNumber(primaryRoot: string): Promise<number> {
  const ticketDirs = [join(primaryRoot, 'cocoder', 'tickets', 'open'), join(primaryRoot, 'cocoder', 'tickets', 'closed')]
  const maxima = await Promise.all(ticketDirs.map((dir) => maxTicketNumberInDir(dir)))
  return Math.max(...maxima)
}

async function maxSessionDisplayNumber(primaryRoot: string): Promise<number> {
  const runsDir = portableWorkspacePaths(primaryRoot).runsDir
  let entries: string[]
  try {
    entries = await readdir(runsDir)
  } catch (error: unknown) {
    if (isMissingFile(error)) return 0
    throw error
  }

  const maxima = await Promise.all(entries.map((entry) => maxSessionDisplayNumberInRun(join(runsDir, entry, 'sessions.jsonl'))))
  return Math.max(0, ...maxima)
}

async function maxSessionDisplayNumberInRun(path: string): Promise<number> {
  const rows = await readJsonLines<unknown>(path)
  return rows.reduce<number>((max, row) => Math.max(max, sessionDisplayNumber(row)), 0)
}

async function maxTicketNumberInDir(dir: string): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error: unknown) {
    if (isMissingFile(error)) return 0
    throw error
  }

  return entries.reduce((max, name) => Math.max(max, leadingNumber(name)), 0)
}

function leadingNumber(name: string): number {
  const match = /^(\d+)/.exec(name)
  return match === null ? 0 : Number(match[1])
}

function sessionDisplayNumber(value: unknown): number {
  if (!isRecord(value) || !isRecord(value.session)) return 0
  return typeof value.session.displayNumber === 'number' ? value.session.displayNumber : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
