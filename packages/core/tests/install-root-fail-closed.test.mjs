import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findCocoderHome, resolveInstallRoot } from '../lib/paths.mjs';
import { setInstallConfigValue, setWorkspaceConfigValue } from '../lib/config.mjs';

// M4.23 / pending-decisions Q2=A + Q4=A.
// findCocoderHome must fail closed when no install root exists in the
// ancestor chain (previously it silently returned process.cwd()).
// setWorkspaceConfigValue routes writes to the workspace-private zone.

async function tmpRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'cocoder-paths-'));
}

async function makeInstallRoot(root) {
  await mkdir(path.join(root, 'cocoder'), { recursive: true });
  await writeFile(path.join(root, 'cocoder', 'AGENTS.md'), '# Install marker\n');
  await writeFile(path.join(root, 'ARCHITECTURE.md'), '# Install marker\n');
}

test('findCocoderHome returns null when ancestors do not contain install markers', async () => {
  const dir = await tmpRoot();
  try {
    assert.equal(await findCocoderHome(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findCocoderHome resolves to the install root when markers are present', async () => {
  const dir = await tmpRoot();
  try {
    await makeInstallRoot(dir);
    const nested = path.join(dir, 'packages', 'core', 'lib');
    await mkdir(nested, { recursive: true });
    assert.equal(await findCocoderHome(nested), path.resolve(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveInstallRoot throws a friendly error when no install root is found', async () => {
  const dir = await tmpRoot();
  try {
    await assert.rejects(
      () => resolveInstallRoot(dir),
      (error) => {
        assert.match(error.message, /Could not locate the CoCoder install root/);
        assert.match(error.message, /--cocoder-home/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveInstallRoot returns the install root when one is present', async () => {
  const dir = await tmpRoot();
  try {
    await makeInstallRoot(dir);
    assert.equal(await resolveInstallRoot(dir), path.resolve(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('setInstallConfigValue writes to <install>/local/config.yaml and tags zone install-local', async () => {
  const dir = await tmpRoot();
  try {
    await makeInstallRoot(dir);
    const result = await setInstallConfigValue('theme.mode', 'dark', { cocoderHome: dir });
    assert.equal(result.zone, 'install-local');
    assert.equal(result.filePath, path.join(dir, 'local', 'config.yaml'));
    const written = await readFile(result.filePath, 'utf8');
    assert.match(written, /theme:/);
    assert.match(written, /mode: dark/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('setWorkspaceConfigValue writes to <workspace>/cocoder/local/config.yaml and tags zone workspace-local', async () => {
  const dir = await tmpRoot();
  try {
    const workspace = path.join(dir, 'my-app');
    await mkdir(workspace, { recursive: true });
    const result = await setWorkspaceConfigValue('theme.mode', 'light', { workspaceRoot: workspace });
    assert.equal(result.zone, 'workspace-local');
    assert.equal(result.filePath, path.join(workspace, 'cocoder', 'local', 'config.yaml'));
    const written = await readFile(result.filePath, 'utf8');
    assert.match(written, /theme:/);
    assert.match(written, /mode: light/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('setWorkspaceConfigValue refuses to run without workspaceRoot', async () => {
  await assert.rejects(
    () => setWorkspaceConfigValue('theme.mode', 'dark', {}),
    /requires options.workspaceRoot/
  );
});
