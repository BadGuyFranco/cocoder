import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  readWorkspacesRegistry,
  resolveWorkspaceEntry,
  resolveWorkspaceRegistry,
  workspacesRegistryPath,
  writeWorkspacesRegistry
} from 'oz-daemon';

async function machineRoot(label) {
  return mkdtemp(path.join(os.tmpdir(), `cocoder-oz-registry-${label}-`));
}

test('C-S8: ${COCODER_HOME} token round-trips across simulated machine roots', async () => {
  const machineA = await machineRoot('a');
  const machineB = await machineRoot('b');

  await writeWorkspacesRegistry(machineA, {
    version: '0.1',
    workspaces: [{
      id: 'sample-app',
      path: '${COCODER_HOME}/workspaces/sample-app',
      tmuxSocket: 'cocoder-sample-app'
    }]
  });

  const synced = await readFile(workspacesRegistryPath(machineA), 'utf8');
  await mkdir(path.join(machineB, 'local'), { recursive: true });
  await writeFile(workspacesRegistryPath(machineB), synced);

  const resolved = await resolveWorkspaceEntry(
    { id: 'sample-app', path: '${COCODER_HOME}/workspaces/sample-app', tmuxSocket: 'cocoder-sample-app' },
    { cocoderHome: machineB, roots: {} }
  );

  assert.equal(resolved.resolvedPath, path.join(machineB, 'workspaces/sample-app'));
  assert.equal(resolved.tmuxSocket, 'cocoder-sample-app');
});

test('C-S8: ${root:nas} token round-trips across different named roots', async () => {
  const machineA = await machineRoot('nas-a');
  const machineB = await machineRoot('nas-b');

  await mkdir(path.join(machineA, 'local'), { recursive: true });
  await mkdir(path.join(machineB, 'local'), { recursive: true });
  await writeFile(path.join(machineA, 'local/roots.yaml'), `roots:\n  nas: "${path.join(machineA, 'NAS A')}"\n`);
  await writeFile(path.join(machineB, 'local/roots.yaml'), `roots:\n  nas: "${path.join(machineB, 'NAS B')}"\n`);

  await writeWorkspacesRegistry(machineA, {
    version: '0.1',
    workspaces: [{
      id: 'sample-app',
      path: '${root:nas}/SampleApp',
      tmuxSocket: 'cocoder-sample-app'
    }]
  });

  const synced = await readFile(workspacesRegistryPath(machineA), 'utf8');
  await writeFile(workspacesRegistryPath(machineB), synced);

  const resolved = await resolveWorkspaceEntry(
    { id: 'sample-app', path: '${root:nas}/SampleApp', tmuxSocket: 'cocoder-sample-app' },
    { cocoderHome: machineB }
  );

  assert.equal(resolved.resolvedPath, path.join(machineB, 'NAS B', 'SampleApp'));
});

test('C-S8: invalid ${env:...} registry path fails closed with diagnostic', async () => {
  const cocoderHome = await machineRoot('bad');
  await mkdir(path.join(cocoderHome, 'local'), { recursive: true });
  await writeFile(
    workspacesRegistryPath(cocoderHome),
    `${JSON.stringify({
      version: '0.1',
      workspaces: [{ id: 'bad', path: '${env:UNDEFINED_VAR}/workspace' }]
    }, null, 2)}\n`
  );

  await assert.rejects(
    () => resolveWorkspaceEntry({ id: 'bad', path: '${env:UNDEFINED_VAR}/workspace' }, { cocoderHome }),
    /env references are not allowed/
  );
});

test('C-S8: dual tmuxSocket entries resolve independently', async () => {
  const cocoderHome = await machineRoot('dual');
  await writeWorkspacesRegistry(cocoderHome, {
    version: '0.1',
    workspaces: [
      {
        id: 'app-a',
        path: '${COCODER_HOME}/workspaces/app-a',
        tmuxSocket: 'cocoder-app-a'
      },
      {
        id: 'app-b',
        path: '${COCODER_HOME}/workspaces/app-b',
        tmuxSocket: 'cocoder-app-b'
      }
    ]
  });

  const resolved = await resolveWorkspaceRegistry(cocoderHome);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].tmuxSocket, 'cocoder-app-a');
  assert.equal(resolved[1].tmuxSocket, 'cocoder-app-b');
  assert.notEqual(resolved[0].tmuxSocket, resolved[1].tmuxSocket);
  assert.equal(resolved[0].resolvedPath, path.join(cocoderHome, 'workspaces/app-a'));
  assert.equal(resolved[1].resolvedPath, path.join(cocoderHome, 'workspaces/app-b'));
});

test('C-S8: synced registry bytes survive simulated git-pull no-op rewrite', async () => {
  const machineA = await machineRoot('sync-a');
  const machineB = await machineRoot('sync-b');

  await writeWorkspacesRegistry(machineA, {
    version: '0.1',
    workspaces: [{ id: 'sample-app', path: '${root:nas}/SampleApp', tmuxSocket: 'cocoder-sample-app' }]
  });

  const bytes = await readFile(workspacesRegistryPath(machineA));
  await mkdir(path.join(machineB, 'local'), { recursive: true });
  await writeFile(workspacesRegistryPath(machineB), bytes);
  await writeFile(workspacesRegistryPath(machineB), await readFile(workspacesRegistryPath(machineB)));

  const after = await readFile(workspacesRegistryPath(machineB));
  assert.equal(after.compare(bytes), 0);

  const registry = await readWorkspacesRegistry(machineB);
  assert.equal(registry.workspaces[0].path, '${root:nas}/SampleApp');
});
