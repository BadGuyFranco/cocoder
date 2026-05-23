import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOzServer, OZ_CSRF_HEADER } from 'oz-daemon';

async function fixtureInstall(port = 7878) {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-auth-bootstrap-'));
  return createOzServer({ cocoderHome, port });
}

function hostHeader(port) {
  return `127.0.0.1:${port}`;
}

test('C-D1: GET /auth/session returns csrfToken and bearerToken with valid Host', async () => {
  const { app, port, token, csrfToken } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { host: hostHeader(port) }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().csrfToken, csrfToken);
  assert.equal(response.json().bearerToken, token);
  await app.close();
});

test('C-D1: GET /auth/session rejects missing Host', async () => {
  const { app } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/auth/session'
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'invalid host');
  await app.close();
});

test('C-D1: GET /auth/session rejects adversarial Host', async () => {
  const { app } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { host: 'evil.example' }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'invalid host');
  await app.close();
});

test('C-D1: GET /auth/session rejects adversarial Origin even on GET', async () => {
  const { app, port } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: {
      host: hostHeader(port),
      origin: 'http://evil.example'
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'invalid origin');
  await app.close();
});

test('C-D1: GET /auth/session allows absent Origin (Node/curl bootstrap)', async () => {
  const { app, port, token } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { host: hostHeader(port) }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().bearerToken, token);
  await app.close();
});

test('C-D1: GET /auth/session allows loopback Origin', async () => {
  const { app, port } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: {
      host: hostHeader(port),
      origin: `http://127.0.0.1:${port}`
    }
  });
  assert.equal(response.statusCode, 200);
  assert.ok(response.json().bearerToken);
  await app.close();
});

test('C-D1: GET /health does not require Bearer token', async () => {
  const { app, port } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { host: hostHeader(port) }
  });
  assert.equal(response.statusCode, 200);
  await app.close();
});

test('C-D1: state-changing routes still require CSRF after bootstrap exposes Bearer', async () => {
  const { app, port, token } = await fixtureInstall();
  const session = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { host: hostHeader(port) }
  });
  const response = await app.inject({
    method: 'POST',
    url: '/workspaces',
    headers: {
      host: hostHeader(port),
      authorization: `Bearer ${session.json().bearerToken}`
    },
    payload: {
      id: 'sample-app',
      path: '${COCODER_HOME}/workspaces/sample-app'
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'missing or invalid csrf token');
  await app.close();
});

test('C-D1: bootstrap Bearer plus CSRF succeeds on POST /workspaces', async () => {
  const { app, port } = await fixtureInstall();
  const session = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { host: hostHeader(port) }
  });
  const { bearerToken, csrfToken } = session.json();
  const response = await app.inject({
    method: 'POST',
    url: '/workspaces',
    headers: {
      host: hostHeader(port),
      authorization: `Bearer ${bearerToken}`,
      [OZ_CSRF_HEADER]: csrfToken
    },
    payload: {
      id: 'sample-app',
      path: '${COCODER_HOME}/workspaces/sample-app',
      tmuxSocket: 'cocoder-sample-app'
    }
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().id, 'sample-app');
  assert.match(response.json().resolvedPath, /workspaces[/\\]sample-app$/);
  await app.close();
});
