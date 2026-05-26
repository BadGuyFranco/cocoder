import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const templateRoot = path.join(repoRoot, 'templates/workspace-cocoder/cocoder');
const dogfoodRoot = path.join(repoRoot, 'cocoder');

/** Dogfood-only paths that legitimately exist under cocoder/ but not in the workspace template. */
const DOGFOOD_ONLY_ALLOWLIST = new Set([
  'personas/bob.json',
  'personas/talia.json',
  'personas/oscar.json',
  'personas/phil.json',
  'personas/quinn.json',
  'personas/ian.json',
  'personas/verifier.json',
  'personas/AGENTS.md',
  'personas/PORT-NOTES.md',
  'personas/prompts/manifest.json',
  'personas/prompts/personas/bob.md',
  'personas/prompts/personas/talia.md',
  'personas/prompts/personas/oscar.md',
  'personas/prompts/personas/phil.md',
  'personas/prompts/personas/quinn.md',
  'personas/prompts/shared/startup-packet.md',
  'personas/prompts/shared/write-boundaries.md',
  'personas/prompts/shared/result-contract.md',
  'personas/prompts/shared/closeout.md',
  'personas/prompts/shared/private-playbook-boundary.md',
  'personas/prompts/shared/evidence-classes.md',
  'personas/prompts/shared/session-wrap.md',
  'personas/playbooks/bob.md',
  'personas/playbooks/talia.md',
  'personas/playbooks/oscar.md',
  'personas/playbooks/phil.md',
  'personas/playbooks/quinn.md',
  'personas/playbooks/README-private-operator-pattern.md',
  'profiles',
  'routes',
  'priority-boundaries',
  'priorities/v0.1-foundation',
  'priorities/v0.2-adapter-extensibility',
  'priorities/v0.3-workspace-lifecycle',
  'priorities/AGENTS.md',
  'priorities/v0.1-foundation/README.md',
  'plans/AGENTS.md',
  'plans/v0.2-backlog.md',
  'plans/zArchive/.gitkeep',
  'tickets/open/.gitkeep',
  'tickets/closed',
  'tickets/AGENTS.md',
  'decisions/0001-storage-and-license.md',
  'decisions/0002-talia-quinn-boundary.md',
  'decisions/0003-binary-name-and-env-prefix.md',
  'decisions/0004-typescript-validation-toolchain.md',
  'decisions/0005-oz-improvement-target-routing.md',
  'decisions/0006-no-nested-workspaces-inside-install.md',
  'decisions/0007-workspace-files-and-multiroot-description.md',
  '.quinn-credentials.example.json'
]);

async function collectRelativePaths(root, prefix = '') {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      paths.push({ relative, kind: 'directory' });
      paths.push(...(await collectRelativePaths(full, relative)));
    } else if (entry.isFile()) {
      paths.push({ relative, kind: 'file' });
    }
  }
  return paths;
}

async function dogfoodHasPath(relativePath, kind) {
  if (relativePath.endsWith('/.gitkeep')) {
    const parent = relativePath.slice(0, -('/.gitkeep'.length));
    return dogfoodHasPath(parent, 'directory');
  }
  const full = path.join(dogfoodRoot, relativePath);
  try {
    const info = await stat(full);
    if (kind === 'directory') return info.isDirectory();
    return info.isFile();
  } catch {
    return false;
  }
}

test('every template cocoder/ path exists in dogfood cocoder/ (file or directory)', async () => {
  const templatePaths = await collectRelativePaths(templateRoot);
  const missing = [];
  for (const item of templatePaths) {
    if (!(await dogfoodHasPath(item.relative, item.kind))) {
      missing.push(item);
    }
  }
  assert.deepEqual(missing, [], `template paths missing from dogfood: ${JSON.stringify(missing, null, 2)}`);
});

test('dogfood-only allowlist entries are not required in the workspace template', async () => {
  const templatePaths = new Set((await collectRelativePaths(templateRoot)).map((item) => item.relative));
  for (const allowed of DOGFOOD_ONLY_ALLOWLIST) {
    assert.equal(
      templatePaths.has(allowed),
      false,
      `dogfood-only path ${allowed} should not appear in template (move to allowlist reason if intentional)`
    );
  }
});

test('template and dogfood both define standards/AGENTS.md and tickets/INDEX.md', async () => {
  assert.ok(await dogfoodHasPath('standards/AGENTS.md', 'file'));
  assert.ok(await dogfoodHasPath('tickets/INDEX.md', 'file'));
  assert.ok(await dogfoodHasPath('memory/tech-stack.md', 'file'));
});

test('template .gitignore matches ARCHITECTURE workspace-zone secrets pattern', async () => {
  const gitignorePath = path.join(templateRoot, '.gitignore');
  const body = await import('node:fs/promises').then(({ readFile }) => readFile(gitignorePath, 'utf8'));
  for (const needle of ['secrets/', '*.env', '.env.*', 'local/*']) {
    assert.ok(body.includes(needle), `expected ${needle} in template .gitignore`);
  }
});
