import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { createOzServer, OZ_CSRF_HEADER, workspacesRegistryPath } from 'oz-daemon';
import { handleOzRegister } from '../cli/oz.mjs';

const CORE_CLI = path.resolve('cli.mjs');

async function fixtureInstall(port = 7878) {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-workspaces-'));
  return createOzServer({ cocoderHome, port });
}

function hostHeader(port) {
  return `127.0.0.1:${port}`;
}

async function authHeaders(app, port) {
  const session = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { host: hostHeader(port) }
  });
  assert.equal(session.statusCode, 200);
  const { bearerToken, csrfToken } = session.json();
  return {
    host: hostHeader(port),
    authorization: `Bearer ${bearerToken}`,
    [OZ_CSRF_HEADER]: csrfToken
  };
}

test('GET /workspaces returns empty registry', async () => {
  const { app, port } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/workspaces',
    headers: { host: hostHeader(port) }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().workspaces, []);
  await app.close();
});

test('POST /workspaces creates entry with resolved path', async () => {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-workspaces-post-'));
  const { app, port } = await createOzServer({ cocoderHome, port: 7878 });
  const headers = await authHeaders(app, port);
  const response = await app.inject({
    method: 'POST',
    url: '/workspaces',
    headers,
    payload: {
      id: 'sample-app',
      name: 'Sample App',
      path: '${COCODER_HOME}/workspaces/sample-app',
      tmuxSocket: 'cocoder-sample-app'
    }
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().id, 'sample-app');
  assert.equal(
    response.json().resolvedPath,
    path.join(cocoderHome, 'workspaces/sample-app')
  );
  await app.close();
});

test('GET /workspaces/:id returns one entry', async () => {
  const { app, port } = await fixtureInstall();
  const headers = await authHeaders(app, port);
  await app.inject({
    method: 'POST',
    url: '/workspaces',
    headers,
    payload: {
      id: 'demo',
      path: '${COCODER_HOME}/workspaces/demo'
    }
  });
  const response = await app.inject({
    method: 'GET',
    url: '/workspaces/demo',
    headers: { host: hostHeader(port) }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().id, 'demo');
  await app.close();
});

test('PUT /workspaces/:id updates registry entry', async () => {
  const { app, port } = await fixtureInstall();
  const headers = await authHeaders(app, port);
  await app.inject({
    method: 'POST',
    url: '/workspaces',
    headers,
    payload: {
      id: 'demo',
      path: '${COCODER_HOME}/workspaces/demo',
      tmuxSocket: 'cocoder-demo'
    }
  });
  const response = await app.inject({
    method: 'PUT',
    url: '/workspaces/demo',
    headers,
    payload: {
      name: 'Demo Workspace',
      tmuxSocket: 'cocoder-demo-v2'
    }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().name, 'Demo Workspace');
  assert.equal(response.json().tmuxSocket, 'cocoder-demo-v2');
  await app.close();
});

test('DELETE /workspaces/:id removes entry', async () => {
  const { app, port } = await fixtureInstall();
  const headers = await authHeaders(app, port);
  await app.inject({
    method: 'POST',
    url: '/workspaces',
    headers,
    payload: {
      id: 'demo',
      path: '${COCODER_HOME}/workspaces/demo'
    }
  });
  const deleted = await app.inject({
    method: 'DELETE',
    url: '/workspaces/demo',
    headers
  });
  assert.equal(deleted.statusCode, 200);
  const list = await app.inject({
    method: 'GET',
    url: '/workspaces',
    headers: { host: hostHeader(port) }
  });
  assert.deepEqual(list.json().workspaces, []);
  await app.close();
});

test('POST /workspaces rejects duplicate id', async () => {
  const { app, port } = await fixtureInstall();
  const headers = await authHeaders(app, port);
  const payload = {
    id: 'demo',
    path: '${COCODER_HOME}/workspaces/demo'
  };
  await app.inject({ method: 'POST', url: '/workspaces', headers, payload });
  const duplicate = await app.inject({ method: 'POST', url: '/workspaces', headers, payload });
  assert.equal(duplicate.statusCode, 409);
  await app.close();
});

test('GET /workspaces/:id returns 404 for unknown id', async () => {
  const { app, port } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/workspaces/missing',
    headers: { host: hostHeader(port) }
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test('POST /workspaces rejects invalid env path token', async () => {
  const { app, port } = await fixtureInstall();
  const headers = await authHeaders(app, port);
  const response = await app.inject({
    method: 'POST',
    url: '/workspaces',
    headers,
    payload: {
      id: 'bad',
      path: '${env:SECRET}/workspace'
    }
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /env references are not allowed|Path must be absolute/);
  await app.close();
});

test('cocoder oz register writes tokenized workspace to registry', async () => {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-register-cli-'));
  const workspaceRoot = path.join(cocoderHome, 'workspaces', 'cli-app');
  await mkdir(workspaceRoot, { recursive: true });

  await handleOzRegister({
    id: 'cli-app',
    workspaceRoot,
    cocoderHome
  });

  const raw = await readFile(workspacesRegistryPath(cocoderHome), 'utf8');
  const registry = JSON.parse(raw);
  assert.equal(registry.workspaces.length, 1);
  assert.equal(registry.workspaces[0].id, 'cli-app');
  assert.equal(registry.workspaces[0].path, '${COCODER_HOME}/workspaces/cli-app');
  assert.equal(registry.workspaces[0].tmuxSocket, 'cocoder-cli-app');
});

test('cocoder oz register upserts existing workspace id', async () => {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-register-upsert-'));
  const firstRoot = path.join(cocoderHome, 'workspaces', 'first');
  const secondRoot = path.join(cocoderHome, 'workspaces', 'second');
  await mkdir(firstRoot, { recursive: true });
  await mkdir(secondRoot, { recursive: true });

  await handleOzRegister({ id: 'app', workspaceRoot: firstRoot, cocoderHome });
  await handleOzRegister({ id: 'app', workspaceRoot: secondRoot, cocoderHome, tmuxSocket: 'custom-socket' });

  const raw = await readFile(workspacesRegistryPath(cocoderHome), 'utf8');
  const registry = JSON.parse(raw);
  assert.equal(registry.workspaces.length, 1);
  assert.equal(registry.workspaces[0].path, '${COCODER_HOME}/workspaces/second');
  assert.equal(registry.workspaces[0].tmuxSocket, 'custom-socket');
});

test('cocoder oz register CLI entrypoint is listed in help baseline', async () => {
  const child = spawn(process.execPath, [CORE_CLI, 'help'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(exitCode, 0);
  assert.match(stdout, /oz register --id ID --workspace-root PATH/);
});
