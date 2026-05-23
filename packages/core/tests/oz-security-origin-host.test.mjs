import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOzServer } from 'oz-daemon';

async function fixtureInstall(port = 7878) {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-origin-'));
  return createOzServer({ cocoderHome, port });
}

function hostHeader(port) {
  return `127.0.0.1:${port}`;
}

test('C-S3: rejects Host evil.example on state-changing request', async () => {
  const { app, port } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: { host: 'evil.example' }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'invalid host');
  await app.close();
});

test('C-S3: rejects Host evil.com on state-changing request', async () => {
  const { app } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: { host: 'evil.com' }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'invalid host');
  await app.close();
});

test('C-S3: rejects mismatched Host evil.com even when Origin looks local', async () => {
  const { app, port } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: {
      host: 'evil.com',
      origin: `http://127.0.0.1:${port}`
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'invalid host');
  await app.close();
});

test('C-S3: rejects Origin http://evil.example', async () => {
  const { app, port } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: {
      host: hostHeader(port),
      origin: 'http://evil.example'
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'invalid origin');
  await app.close();
});

test('C-S3: allows Host 127.0.0.1:<port> on GET /health', async () => {
  const { app, port } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { host: hostHeader(port) }
  });
  assert.equal(response.statusCode, 200);
  await app.close();
});

test('C-S3: allows Host localhost:<port> on GET /health', async () => {
  const { app, port } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { host: `localhost:${port}` }
  });
  assert.equal(response.statusCode, 200);
  await app.close();
});

test('C-S3: state-changing request with valid Host reaches Bearer check (401 not 403)', async () => {
  const { app, port } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: { host: hostHeader(port) }
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error, 'missing bearer token');
  await app.close();
});
