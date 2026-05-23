import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOzServer, OZ_CSRF_HEADER } from 'oz-daemon';

async function fixtureInstall(port = 7878) {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-csrf-'));
  return createOzServer({ cocoderHome, port });
}

function hostHeader(port) {
  return `127.0.0.1:${port}`;
}

async function fetchCsrfToken(app, port) {
  const response = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { host: hostHeader(port) }
  });
  assert.equal(response.statusCode, 200);
  return response.json().csrfToken;
}

function bearerHeaders(token, port, csrfToken) {
  return {
    host: hostHeader(port),
    authorization: `Bearer ${token}`,
    [OZ_CSRF_HEADER]: csrfToken
  };
}

test('C-S4: GET /auth/session returns csrfToken and bearerToken', async () => {
  const { app, port, csrfToken, token } = await fixtureInstall();
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

test('C-S4: valid Bearer with missing CSRF is rejected on POST', async () => {
  const { app, port, token } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: {
      host: hostHeader(port),
      authorization: `Bearer ${token}`
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'missing or invalid csrf token');
  await app.close();
});

test('C-S4: valid Bearer with mismatched CSRF is rejected on POST', async () => {
  const { app, port, token } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: bearerHeaders(token, port, 'not-the-real-csrf-token')
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'missing or invalid csrf token');
  await app.close();
});

test('C-S4: valid Bearer and valid CSRF succeed on POST /runs stub', async () => {
  const { app, port, token } = await fixtureInstall();
  const csrfToken = await fetchCsrfToken(app, port);
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: bearerHeaders(token, port, csrfToken),
    payload: {
      workspaceId: 'sample-app',
      runId: 'run-csrf-stub',
      outcome: 'accepted'
    }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().stub, true);
  await app.close();
});

test('C-S4: CSRF required on DELETE even when Bearer is valid', async () => {
  const { app, port, token } = await fixtureInstall();
  const response = await app.inject({
    method: 'DELETE',
    url: '/runs/run-test',
    headers: {
      host: hostHeader(port),
      authorization: `Bearer ${token}`
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'missing or invalid csrf token');
  await app.close();
});

test('C-S4: adversarial Host still rejected before CSRF succeeds', async () => {
  const { app, port, token, csrfToken } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: {
      host: 'evil.com',
      authorization: `Bearer ${token}`,
      [OZ_CSRF_HEADER]: csrfToken
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'invalid host');
  await app.close();
});
