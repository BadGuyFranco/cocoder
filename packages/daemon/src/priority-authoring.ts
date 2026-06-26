import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { composePriorityMarkdown, loadPriority, parseFrontmatter, type Priority } from '@cocoder/core'
import { registerLivePriorities } from './priority-order.js'

export interface CreatePriorityInput {
  readonly id: string
  readonly title: string
  readonly goal: string
}

export interface CreatePriorityFilesResult {
  readonly priority: Priority
  readonly files: readonly string[]
}

export class PriorityAuthoringError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'PriorityAuthoringError'
  }
}

const prioritiesDir = (workspacePath: string): string => join(workspacePath, 'cocoder', 'priorities')
const priorityOrderFile = (workspacePath: string): string => join(prioritiesDir(workspacePath), 'order.json')

function validateCreatedPriority(markdown: string, priority: Priority, input: CreatePriorityInput): void {
  const frontmatter = parseFrontmatter(markdown)
  const keys = Object.keys(frontmatter.data).sort()
  if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'title') throw new Error('priority frontmatter must contain exactly id and title')
  if (priority.id !== input.id) throw new Error('priority id did not round-trip')
  if (priority.title !== input.title) throw new Error('priority title did not round-trip')
  if (priority.scopeNarrowing !== null) throw new Error('priority scopeNarrowing must not be set by create')
}

export async function createPriorityFiles(repoPath: string, input: CreatePriorityInput, now: () => number = Date.now): Promise<CreatePriorityFilesResult> {
  const dir = prioritiesDir(repoPath)
  const fileName = `${input.id}.md`
  await mkdir(dir, { recursive: true })
  const existing = await readdir(dir)
  if (existing.some((name) => name.toLowerCase() === fileName.toLowerCase())) {
    throw new PriorityAuthoringError(`priority id "${input.id}" already exists`, 409)
  }

  const markdown = composePriorityMarkdown(input)
  const target = join(dir, fileName)
  const tmpDir = join(dir, `.priority-create-${input.id}-${process.pid}-${now()}`)
  const tmp = join(tmpDir, fileName)
  await mkdir(tmpDir, { recursive: true })
  try {
    parseFrontmatter(markdown)
    await writeFile(tmp, markdown)
    validateCreatedPriority(markdown, loadPriority(tmpDir, input.id), input)
    await rename(tmp, target)
    const priority = loadPriority(dir, input.id)
    validateCreatedPriority(markdown, priority, input)
    await rm(tmpDir, { recursive: true, force: true })
    await registerLivePriorities(dir)
    return { priority, files: [relative(repoPath, target), relative(repoPath, priorityOrderFile(repoPath))] }
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true })
    await rm(target, { force: true })
    throw err
  }
}
