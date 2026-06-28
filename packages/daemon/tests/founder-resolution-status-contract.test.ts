import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const daemonSrcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

async function sourceFiles(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return Promise.resolve(entry.isFile() && entry.name.endsWith('.ts') ? [path] : [])
  }))
  return files.flat()
}

describe('founder-resolution status contract', () => {
  test('daemon code uses the core status predicate instead of a local awaiting-founder status set', async () => {
    const offenders: string[] = []
    for (const file of await sourceFiles(daemonSrcDir)) {
      const source = await readFile(file, 'utf8')
      if (/AWAITING_FOUNDER_STATUSES/.test(source) || /new Set<RunStatus>\s*\(\s*\[\s*['"]awaiting-founder['"]\s*,\s*['"]awaiting-archive-confirmation['"]\s*\]/.test(source)) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })
})
