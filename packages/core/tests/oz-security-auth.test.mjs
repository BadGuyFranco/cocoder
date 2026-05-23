import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOzServer, ozTokenPath } from 'oz-daemon';

async function fixtureInstall() {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-auth-'));
  return createOzServer({ cocoderHome });
}

test('C-S2: POST without Bearer token returns 401', async () => {
  const { app } = await fixtureInstall();
  const response = await app.inject({ method: 'POST', url: '/runs' });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('C-S2: POST with wrong Bearer token returns 401', async () => {
  const { app, token } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: { authorization: 'Bearer wrong-token' }
  });
  assert.equal(response.statusCode, 401);
  assert.notEqual(token, 'wrong-token');
  await app.close();
});

test('C-S2: POST with valid Bearer token succeeds on state-changing route', async () => {
  const { app, token } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, stub: true });
  await app.close();
});

test('C-S2: GET /health does not require Bearer token', async () => {
  const { app } = await fixtureInstall();
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
  await app.close();
});

test('C-S2: oz-token file is created mode 0600', async () => {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-auth-'));
  const { app } = await createOzServer({ cocoderHome });
  const tokenPath = ozTokenPath(cocoderHome);
  const tokenStat = await stat(tokenPath);
  assert.equal(tokenStat.mode & 0o777, 0o600);
  await app.close();
});
