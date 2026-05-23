import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import { applyWorkspaceInit, planWorkspaceMerge } from '../lib/init-merge.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const templateDir = path.join(repoRoot, 'templates/workspace-cocoder');
const cliPath = path.join(repoRoot, 'packages/core/cli.mjs');

async function listFiles(root) {
  const { readdir, stat } = await import('node:fs/promises');
  const files = [];
  async function walk(current, prefix = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, relative);
      } else if (entry.isFile()) {
        files.push({ relative, full, content: await readFile(full, 'utf8') });
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function snapshotWorkspaceTree(workspaceRoot) {
  const cocoderRoot = path.join(workspaceRoot, 'cocoder');
  return listFiles(cocoderRoot);
}

test('cocoder init apply is idempotent on consecutive runs', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-init-idempotent-'));
  try {
    const first = await applyWorkspaceInit({ templateDir, workspaceRoot: tmp });
    assert.ok(first.applied.length > 0, 'first init should materialize template files');
    const afterFirst = await snapshotWorkspaceTree(tmp);

    const second = await applyWorkspaceInit({ templateDir, workspaceRoot: tmp });
    assert.deepEqual(second.conflicts, []);
    assert.equal(second.applied.length, 0);
    assert.equal(second.skipped.length, first.applied.length + (first.skipped?.length || 0));
    const afterSecond = await snapshotWorkspaceTree(tmp);
    assert.deepEqual(afterSecond, afterFirst);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('cocoder init --merge preserves user-edited tracked file and reports conflict', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-init-merge-'));
  try {
    await applyWorkspaceInit({ templateDir, workspaceRoot: tmp });
    const prioritiesPath = path.join(tmp, 'cocoder/PRIORITIES.md');
    const edited = '# User priorities\n\n| Slug | Description | Status | Owner |\n|---|---|---|---|\n| demo | user row | Active | me |\n';
    await writeFile(prioritiesPath, edited, 'utf8');

    const plan = await planWorkspaceMerge({ templateDir, workspaceRoot: tmp });
    assert.ok(plan.preserve.includes('cocoder/PRIORITIES.md'));

    const merged = await applyWorkspaceInit({ templateDir, workspaceRoot: tmp, merge: true });
    assert.ok(merged.conflicts.includes('cocoder/PRIORITIES.md'));
    assert.equal(await readFile(prioritiesPath, 'utf8'), edited);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('cocoder init refuses nested workspace inside install with COCODER_NESTED_WORKSPACE_FORBIDDEN', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-init-nested-'));
  try {
    const nested = path.join(repoRoot, 'local', 'workspaces', 'init-nested-test', 'nested-app');
    await mkdir(nested, { recursive: true });
    await assert.rejects(
      () => applyWorkspaceInit({ templateDir, workspaceRoot: nested }),
      { code: 'COCODER_NESTED_WORKSPACE_FORBIDDEN' }
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('cocoder init CLI writes workspace tree matching template projection', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-init-cli-'));
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      'init',
      '--workspace-root',
      tmp,
      '--cocoder-home',
      repoRoot
    ], { cwd: repoRoot, maxBuffer: 1024 * 1024 });
    const payload = JSON.parse(stdout);
    assert.equal(payload.ok, true);
    assert.ok(await readFile(path.join(tmp, 'cocoder/AGENTS.md'), 'utf8'));
    assert.ok(await readFile(path.join(tmp, 'cocoder/local/README.md'), 'utf8'));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
