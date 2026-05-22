import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertExplicitWorkspaceContextWhenInsideInstall } from '../lib/paths.mjs';

// M4.27 / pending-decisions Q6=A.
// When a workspace-scope command runs from inside the CoCoder install repo
// without an explicit `--workspace-root` or `--workspace-slug`, the CLI must
// surface a friendly error pointing the user at one of three actions (cd,
// pass --workspace-root for dogfood, pass --workspace-root for another path).

async function tmpRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'cocoder-cwd-'));
}

async function makeInstallRoot(root) {
  await mkdir(path.join(root, 'cocoder'), { recursive: true });
  await writeFile(path.join(root, 'cocoder', 'AGENTS.md'), '# install marker\n');
  await writeFile(path.join(root, 'ARCHITECTURE.md'), '# install marker\n');
}

test('no-op when --workspace-root is provided (explicit dogfood opt-in)', async () => {
  const install = await tmpRoot();
  try {
    await makeInstallRoot(install);
    // Should NOT throw even though startDir is inside install.
    await assertExplicitWorkspaceContextWhenInsideInstall({
      workspaceRoot: install,
      startDir: install
    });
  } finally {
    await rm(install, { recursive: true, force: true });
  }
});

test('no-op when --workspace-slug is provided', async () => {
  const install = await tmpRoot();
  try {
    await makeInstallRoot(install);
    await assertExplicitWorkspaceContextWhenInsideInstall({
      workspaceSlug: 'cocoder-dogfood',
      startDir: install
    });
  } finally {
    await rm(install, { recursive: true, force: true });
  }
});

test('no-op when cwd is outside any CoCoder install (normal user-app cwd)', async () => {
  const elsewhere = await tmpRoot();
  try {
    await assertExplicitWorkspaceContextWhenInsideInstall({ startDir: elsewhere });
  } finally {
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test('throws friendly error when cwd is inside install and no workspace context is given', async () => {
  const install = await tmpRoot();
  try {
    await makeInstallRoot(install);
    const sub = path.join(install, 'packages', 'core', 'lib');
    await mkdir(sub, { recursive: true });
    await assert.rejects(
      () => assertExplicitWorkspaceContextWhenInsideInstall({ startDir: sub }),
      (error) => {
        assert.equal(error.code, 'COCODER_WORKSPACE_CONTEXT_REQUIRED');
        assert.equal(error.installRoot, path.resolve(install));
        assert.equal(error.cwd, path.resolve(sub));
        assert.match(error.message, /you are inside the CoCoder install/);
        assert.match(error.message, /cd into your project/);
        assert.match(error.message, new RegExp(`--workspace-root="${path.resolve(install).replace(/[/\\]/g, '[/\\\\]')}"`));
        assert.match(error.message, /ADR-0006/);
        return true;
      }
    );
  } finally {
    await rm(install, { recursive: true, force: true });
  }
});

test('treats parseArgs sentinel string "true" as missing (so --workspace-root with no value still trips the gate)', async () => {
  const install = await tmpRoot();
  try {
    await makeInstallRoot(install);
    // parseArgs assigns the literal string 'true' to flag-without-value tokens.
    // The friendly error must still fire so the user doesn't silently bind to
    // a nonsense workspace path.
    await assert.rejects(
      () => assertExplicitWorkspaceContextWhenInsideInstall({
        workspaceRoot: 'true',
        startDir: install
      }),
      { code: 'COCODER_WORKSPACE_CONTEXT_REQUIRED' }
    );
  } finally {
    await rm(install, { recursive: true, force: true });
  }
});

test('treats empty-string workspaceRoot as missing', async () => {
  const install = await tmpRoot();
  try {
    await makeInstallRoot(install);
    await assert.rejects(
      () => assertExplicitWorkspaceContextWhenInsideInstall({
        workspaceRoot: '   ',
        startDir: install
      }),
      { code: 'COCODER_WORKSPACE_CONTEXT_REQUIRED' }
    );
  } finally {
    await rm(install, { recursive: true, force: true });
  }
});
