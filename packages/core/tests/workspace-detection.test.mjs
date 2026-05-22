import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertWorkspaceNotNestedInsideInstall,
  resolveActiveWorkspaceRoot
} from '../lib/paths.mjs';
import { planWorkspaceMerge } from '../lib/init-merge.mjs';

// M4.24 / ADR-0006.
// Workspaces nested inside the CoCoder install repository are forbidden.
// The install's own cocoder/ meta-project IS the install dogfood workspace
// (the only legitimate "workspace inside install" instance) — represented
// here by the install root itself serving as the workspace root.

async function tmpRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function makeInstallRoot(root) {
  await mkdir(path.join(root, 'cocoder'), { recursive: true });
  await writeFile(path.join(root, 'cocoder', 'AGENTS.md'), '# install dogfood\n');
  await writeFile(path.join(root, 'ARCHITECTURE.md'), '# install marker\n');
}

async function makeWorkspaceMarker(root) {
  await mkdir(path.join(root, 'cocoder'), { recursive: true });
  await writeFile(path.join(root, 'cocoder', 'AGENTS.md'), '# workspace marker\n');
}

test('assertWorkspaceNotNestedInsideInstall: out-of-tree workspace passes', async () => {
  const workspace = await tmpRoot('cocoder-ws-out');
  try {
    await makeWorkspaceMarker(workspace);
    await assertWorkspaceNotNestedInsideInstall(workspace); // does not throw
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('assertWorkspaceNotNestedInsideInstall: install root itself is allowed (dogfood)', async () => {
  // The install is its own dogfood workspace; assertion walks UP from
  // dirname(installRoot), finds no markers above, returns clean.
  const install = await tmpRoot('cocoder-install-dogfood');
  try {
    await makeInstallRoot(install);
    await assertWorkspaceNotNestedInsideInstall(install); // does not throw
  } finally {
    await rm(install, { recursive: true, force: true });
  }
});

test('assertWorkspaceNotNestedInsideInstall: nested workspace inside install is refused', async () => {
  const install = await tmpRoot('cocoder-install-with-nested');
  try {
    await makeInstallRoot(install);
    const nested = path.join(install, 'sub', 'my-app');
    await mkdir(nested, { recursive: true });
    await makeWorkspaceMarker(nested);
    await assert.rejects(
      () => assertWorkspaceNotNestedInsideInstall(nested),
      (error) => {
        assert.equal(error.code, 'COCODER_NESTED_WORKSPACE_FORBIDDEN');
        assert.equal(error.workspaceRoot, path.resolve(nested));
        assert.equal(error.installRoot, path.resolve(install));
        assert.match(error.message, /refusing to operate on a workspace nested inside the CoCoder install repository/);
        assert.match(error.message, /--workspace-root/);
        assert.match(error.message, /v0\.2/); // mentions the upgrade path
        return true;
      }
    );
  } finally {
    await rm(install, { recursive: true, force: true });
  }
});

test('resolveActiveWorkspaceRoot: explicit workspaceRoot wins when out-of-tree', async () => {
  const workspace = await tmpRoot('cocoder-explicit-ws');
  try {
    await makeWorkspaceMarker(workspace);
    const resolved = await resolveActiveWorkspaceRoot({ workspaceRoot: workspace });
    assert.equal(resolved, path.resolve(workspace));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('resolveActiveWorkspaceRoot: explicit workspaceRoot raises when nested', async () => {
  const install = await tmpRoot('cocoder-install-x');
  try {
    await makeInstallRoot(install);
    const nested = path.join(install, 'inner-app');
    await mkdir(nested, { recursive: true });
    await makeWorkspaceMarker(nested);
    await assert.rejects(
      () => resolveActiveWorkspaceRoot({ workspaceRoot: nested }),
      { code: 'COCODER_NESTED_WORKSPACE_FORBIDDEN' }
    );
  } finally {
    await rm(install, { recursive: true, force: true });
  }
});

test('resolveActiveWorkspaceRoot: cwd ancestor walk finds the workspace', async () => {
  const workspace = await tmpRoot('cocoder-walk-ws');
  try {
    await makeWorkspaceMarker(workspace);
    const sub = path.join(workspace, 'src', 'deep');
    await mkdir(sub, { recursive: true });
    const resolved = await resolveActiveWorkspaceRoot({ startDir: sub });
    assert.equal(resolved, path.resolve(workspace));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('resolveActiveWorkspaceRoot: cwd ancestor walk returns null when no workspace exists', async () => {
  const empty = await tmpRoot('cocoder-empty');
  try {
    assert.equal(await resolveActiveWorkspaceRoot({ startDir: empty }), null);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test('resolveActiveWorkspaceRoot: dogfood case — install root resolves as its own workspace', async () => {
  const install = await tmpRoot('cocoder-install-dogfood-walk');
  try {
    await makeInstallRoot(install);
    const sub = path.join(install, 'packages', 'core', 'lib');
    await mkdir(sub, { recursive: true });
    const resolved = await resolveActiveWorkspaceRoot({ startDir: sub });
    assert.equal(resolved, path.resolve(install));
  } finally {
    await rm(install, { recursive: true, force: true });
  }
});

test('planWorkspaceMerge: refuses to run when workspaceRoot is nested inside install', async () => {
  const install = await tmpRoot('cocoder-merge-nested');
  try {
    await makeInstallRoot(install);
    const template = await tmpRoot('cocoder-merge-template');
    await mkdir(path.join(template, 'cocoder'), { recursive: true });
    await writeFile(path.join(template, 'cocoder', 'AGENTS.md'), '# template\n');

    const nested = path.join(install, 'apps', 'web');
    await mkdir(nested, { recursive: true });

    try {
      await assert.rejects(
        () => planWorkspaceMerge({ templateDir: template, workspaceRoot: nested }),
        { code: 'COCODER_NESTED_WORKSPACE_FORBIDDEN' }
      );
    } finally {
      await rm(template, { recursive: true, force: true });
    }
  } finally {
    await rm(install, { recursive: true, force: true });
  }
});

test('planWorkspaceMerge: proceeds normally for out-of-tree workspaces', async () => {
  const template = await tmpRoot('cocoder-merge-template-ok');
  const workspace = await tmpRoot('cocoder-merge-workspace-ok');
  try {
    await mkdir(path.join(template, 'cocoder'), { recursive: true });
    await writeFile(path.join(template, 'cocoder', 'AGENTS.md'), '# template\n');
    const result = await planWorkspaceMerge({ templateDir: template, workspaceRoot: workspace });
    assert.equal(result.ok, true);
    assert.ok(result.add.includes('cocoder/AGENTS.md'));
  } finally {
    await rm(template, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test('planWorkspaceMerge: requires workspaceRoot', async () => {
  await assert.rejects(
    () => planWorkspaceMerge({ templateDir: '/tmp/whatever' }),
    /requires workspaceRoot/
  );
});
