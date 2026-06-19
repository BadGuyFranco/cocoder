#!/usr/bin/env node
// Proof harness - workspace scaffold reconciliation.
//
//   node scripts/proof-scaffold-reconciliation.mjs
//
// Scaffolds a throwaway workspace governance zone with the real scaffold primitive, validates the
// files the create/launch path hard-requires, and proves the scaffolded cocoder/ tree matches the
// shipped template exactly. Any red row means the runtime scaffold path and template have diverged.

import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { tsImport } from 'tsx/esm/api'

const { installRoot, scaffoldCocoderZone, workspaceTemplateDir } = await tsImport(
  '../packages/core/src/scaffold/scaffold.ts',
  import.meta.url,
)
const { loadAssignments } = await tsImport('../packages/core/src/personas/loader.ts', import.meta.url)
const { loadPriority } = await tsImport('../packages/core/src/priorities/loader.ts', import.meta.url)

const REQUIRED_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'personas/assignments.json',
  'priorities/adhoc-session.md',
]

const checks = []

function record(name, ok, detail) {
  checks.push({ name, ok, detail })
}

async function exists(path) {
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

async function fileTree(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true })
  const rows = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      rows.push(...await fileTree(root, path))
    } else if (entry.isFile()) {
      rows.push(relative(root, path).split('\\').join('/'))
    }
  }
  return rows
}

async function nonEmpty(path) {
  return (await readFile(path, 'utf8')).trim().length > 0
}

async function compareBytes(templateRoot, outputRoot, files) {
  const mismatched = []
  for (const file of files) {
    const [templateBytes, outputBytes] = await Promise.all([
      readFile(join(templateRoot, file)),
      readFile(join(outputRoot, file)),
    ])
    if (!templateBytes.equals(outputBytes)) mismatched.push(file)
  }
  return mismatched
}

function compareSets(templateFiles, outputFiles) {
  const template = new Set(templateFiles)
  const output = new Set(outputFiles)
  return {
    missing: templateFiles.filter((file) => !output.has(file)),
    extra: outputFiles.filter((file) => !template.has(file)),
  }
}

async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'cocoder-proof-scaffold-reconciliation-'))
  try {
    const targetRoot = join(temp, 'workspace')
    await mkdir(targetRoot, { recursive: true })
    await writeFile(join(targetRoot, 'package.json'), '{"private":true}\n', 'utf8')

    const templateRoot = workspaceTemplateDir()
    const outputRoot = join(targetRoot, 'cocoder')
    const result = scaffoldCocoderZone({
      templateDir: templateRoot,
      targetRoot,
      installRoot: installRoot(),
    })

    const templateFiles = await fileTree(templateRoot)
    const outputFiles = await fileTree(outputRoot)
    const created = [...result.created].sort()
    const expectedCreated = outputFiles.map((file) => `cocoder/${file}`).sort()

    const requiredMissing = []
    for (const file of REQUIRED_FILES) {
      if (!(await exists(join(outputRoot, file)))) requiredMissing.push(file)
    }
    record(
      'hard-required files exist',
      requiredMissing.length === 0,
      requiredMissing.length === 0 ? REQUIRED_FILES.join(', ') : `missing: ${requiredMissing.join(', ')}`,
    )

    const assignmentsPath = join(outputRoot, 'personas', 'assignments.json')
    JSON.parse(await readFile(assignmentsPath, 'utf8'))
    const assignments = loadAssignments(assignmentsPath)
    record(
      'assignments.json parses and validates',
      Boolean(assignments.personas.oscar && assignments.personas.bob),
      `personas: ${Object.keys(assignments.personas).sort().join(', ')}`,
    )

    const priority = loadPriority(join(outputRoot, 'priorities'), 'adhoc-session')
    record(
      'adhoc priority parses and is launchable',
      priority.id === 'adhoc-session' && priority.title.trim().length > 0 && priority.goal.trim().length > 0,
      `id=${priority.id}; title=${priority.title}`,
    )

    const agentsOk = (await nonEmpty(join(outputRoot, 'AGENTS.md'))) && (await nonEmpty(join(outputRoot, 'CLAUDE.md')))
    const claudePointer = (await readFile(join(outputRoot, 'CLAUDE.md'), 'utf8')).includes('AGENTS.md')
    record('AGENTS and CLAUDE pointer are present', agentsOk && claudePointer, 'AGENTS.md non-empty; CLAUDE.md points at AGENTS.md')

    const setDiff = compareSets(templateFiles, outputFiles)
    record(
      'template file set equals scaffold output',
      setDiff.missing.length === 0 && setDiff.extra.length === 0,
      setDiff.missing.length === 0 && setDiff.extra.length === 0
        ? `${outputFiles.length} governance files`
        : `missing=${setDiff.missing.join(', ') || '(none)'}; extra=${setDiff.extra.join(', ') || '(none)'}`,
    )

    const byteMismatches = await compareBytes(templateRoot, outputRoot, templateFiles)
    record(
      'template bytes equal scaffold output bytes',
      byteMismatches.length === 0,
      byteMismatches.length === 0 ? 'all copied files match' : `mismatched: ${byteMismatches.join(', ')}`,
    )

    record(
      'scaffold reported exactly created governance files',
      JSON.stringify(created) === JSON.stringify(expectedCreated),
      `created=${created.length}; output=${expectedCreated.length}`,
    )

    console.log('Scaffold reconciliation proof')
    console.log(`template: ${templateRoot}`)
    console.log(`target:   ${targetRoot}`)
    console.log('')
    for (const check of checks) {
      console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name} - ${check.detail}`)
    }

    const failed = checks.filter((check) => !check.ok)
    console.log('')
    if (failed.length === 0) {
      console.log('PASS VERDICT: runtime scaffold output matches templates/workspace-cocoder/cocoder for the governance set, and the hard-required launch files parse.')
      process.exitCode = 0
    } else {
      console.log(`FAIL VERDICT: ${failed.length} scaffold reconciliation check(s) failed.`)
      process.exitCode = 1
    }
  } catch (err) {
    console.log('Scaffold reconciliation proof')
    console.log(`FAIL VERDICT: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}

await main()
