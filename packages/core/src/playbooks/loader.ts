// Onboarding Playbook loader (ADR-0020). Playbooks are shipped with the base personas
// package and passed in by directory so core never reaches into @cocoder/personas itself.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'

export type OnboardingPlaybookMode = 'bootstrap' | 'takeover' | 'drift'

export interface OnboardingPlaybook {
  readonly id: string
  readonly title: string
  readonly mode: OnboardingPlaybookMode
  readonly writeScope: readonly string[]
  readonly modelPin: string
  readonly objective: string | null
}

function parseObjective(body: string): string | null {
  const heading = /^##\s+Objective\s*$/im.exec(body)
  if (!heading) return null
  const rest = body.slice(heading.index + heading[0].length)
  const nextHeading = /^#{1,2}\s+/m.exec(rest)
  const objective = (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim()
  return objective === '' ? null : objective
}

function asString(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asMode(value: string | string[] | undefined): OnboardingPlaybookMode | null {
  return value === 'bootstrap' || value === 'takeover' || value === 'drift' ? value : null
}

function asWriteScope(value: string | string[] | undefined): readonly string[] | null {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || value === '') return null
  const inlineList = value.match(/^\[(.*)\]$/)
  if (!inlineList) return [value]
  const items = inlineList[1]!
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter((item) => item !== '')
  return items.length > 0 ? items : null
}

function loadPlaybook(file: string, id: string): OnboardingPlaybook | null {
  try {
    const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'))
    if (data.type !== 'onboarding-playbook' || data.id !== id) return null
    const title = asString(data.title)
    const mode = asMode(data.mode)
    const writeScope = asWriteScope(data.writeScope)
    const modelPin = asString(data.modelPin)
    if (!title || !mode || !writeScope || !modelPin) return null
    return { id, title, mode, writeScope, modelPin, objective: parseObjective(body) }
  } catch {
    return null
  }
}

export function loadOnboardingPlaybooks(playbooksDir: string): readonly OnboardingPlaybook[] {
  try {
    if (!existsSync(playbooksDir) || !statSync(playbooksDir).isDirectory()) return []
    return readdirSync(playbooksDir)
      .filter((entry) => entry.endsWith('.md'))
      .sort()
      .map((entry) => {
        const id = entry.slice(0, -'.md'.length)
        return loadPlaybook(join(playbooksDir, entry), id)
      })
      .filter((playbook): playbook is OnboardingPlaybook => playbook !== null)
  } catch {
    return []
  }
}
