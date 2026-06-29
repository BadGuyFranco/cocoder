import { chmod, cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function prepareProofInstall(home, root) {
  await mkdir(home, { recursive: true })
  await cp(join(root, 'packages'), join(home, 'packages'), { recursive: true, verbatimSymlinks: true })
  await cp(join(root, 'scripts'), join(home, 'scripts'), { recursive: true, verbatimSymlinks: true })
  await chmod(join(home, 'scripts', 'oz.sh'), 0o755)
  await writeFile(join(home, '.gitignore'), '/node_modules\n/local/*\n!/local/README.md\n')
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'tsconfig.json']) {
    await writeFile(join(home, file), await readFile(join(root, file), 'utf8'))
  }
  await symlink(join(root, 'node_modules'), join(home, 'node_modules'))
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(home, 'local', 'README.md'), 'proof harness local state\n')
  await writeWorkspaceGovernance(home)
  await writeFakeClis(join(home, 'fake-bin'))
}

async function writeWorkspaceGovernance(home) {
  await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'personas'), { recursive: true })
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'Proof CoCoder', path: '${COCODER_HOME}' }] }))
  await writeFile(join(home, 'cocoder', 'priorities', 'daemon-reload-proof.md'), [
    '---',
    'id: daemon-reload-proof',
    'title: Daemon Reload Proof',
    '---',
    '',
    '## Objective',
    '',
    'Add a trivial daemon proof route and let the daemon auto-reload onto it.',
    '',
  ].join('\n'))
  await writeFile(join(home, 'cocoder', 'personas', 'assignments.json'), JSON.stringify({
    personas: {
      oscar: { cli: 'claude', model: '', mode: 'headless', plays: { 'wrap-up': { cli: 'codex', model: '' } } },
      bob: { cli: 'codex', model: '', mode: 'headless' },
      deb: { cli: 'codex', model: '', enabled: false },
    },
  }, null, 2))
}

async function writeFakeClis(binDir) {
  await mkdir(binDir, { recursive: true })
  await writeExecutable(join(binDir, 'claude'), claudeFake())
  await writeExecutable(join(binDir, 'codex'), codexFake())
  await writeExecutable(join(binDir, 'cursor-agent'), cursorFake())
}

function claudeFake() {
  return `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('claude proof fake 1.0.0'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'status') { console.log('{"loggedIn": true}'); process.exit(0) }
const prompt = args.at(-1) ?? ''
const writeJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value) + '\\n') }
const verify = prompt.match(/(\\/[^\\s\`]+verify-\\d+\\.json)/)
if (verify) { writeJson(verify[1], { verdict: 'pass', reason: 'proof route added and checked' }); console.log('verified'); process.exit(0) }
const directive = prompt.match(/(\\/[^\\s\`]+directive-\\d+\\.json)/)
if (!directive) { console.log('ok'); process.exit(0) }
if (/directive-0\\.json/.test(directive[1])) writeJson(directive[1], { kind: 'delegate', task: 'Add GET /proof/daemon-reload to packages/daemon/src/server.ts and report completion.' })
else writeJson(directive[1], { kind: 'wrapup', pickup: 'Proof route committed; wrap up.' })
console.log('artifact written')
`
}

function codexFake() {
  return `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex proof fake 1.0.0'); process.exit(0) }
if (args[0] === 'login' && args[1] === 'status') { console.error('Logged in as proof'); process.exit(0) }
const outFlag = args.indexOf('--output-last-message')
const outPath = outFlag >= 0 ? args[outFlag + 1] : ''
const prompt = args.at(-1) ?? ''
const writeOut = (text) => { if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, text) } console.log(text) }
if (/One-shot builder turn|PROCEED/.test(prompt)) {
  const serverPath = join(process.cwd(), 'packages', 'daemon', 'src', 'server.ts')
  const marker = "      if (pathname === '/health') return sendJson(res, 200, { ok: true, sha: ctx.bootSha })"
  const route = "      if (pathname === '/proof/daemon-reload') return sendJson(res, 200, { ok: true, proof: 'daemon-reload' })"
  let source = readFileSync(serverPath, 'utf8')
  if (!source.includes("pathname === '/proof/daemon-reload'")) {
    if (!source.includes(marker)) throw new Error('proof insertion marker not found')
    source = source.replace(marker, marker + "\\n" + route)
    writeFileSync(serverPath, source)
  }
  writeOut("Added proof daemon route.\\n<<<COCODER-ATOM-0-DONE>>>\\n")
  process.exit(0)
}
writeOut(\`**Founder Completion Brief**

**Atom Complete**
Yes.

**Run Status**
continue.
The proof route was added and committed; the harness is waiting for daemon reload evidence.

**What Changed**
The isolated daemon gained a proof route for reload verification.

**Judgment:**
Oscar stopped because the proof atom reached a clean commit boundary and the harness owns the remaining live check.

**What Remains**
- Live daemon reload evidence must be collected by the harness.

**Founder Decision Needed**
None.

**Commit State**
Committed — 1 commit was recorded by the runner.

**Recommended Next Step**
Priority: \\\`daemon-reload-proof\\\` - verify the isolated daemon serves the proof route after reload.

**Teardown Readiness**
The run is standing by and teardown requires an explicit founder request.

I'm standing by...
\`)
`
}

function cursorFake() {
  return `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('cursor-agent proof fake 1.0.0'); process.exit(0) }
if (args[0] === '--list-models') { console.log('proof-model'); process.exit(0) }
console.log('ok')
`
}

async function writeExecutable(path, text) {
  await writeFile(path, text)
  await chmod(path, 0o755)
}
