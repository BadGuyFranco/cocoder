import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOzServer, ozTokenPath } from 'oz-daemon';

const DEFAULT_PORT = 7878;

async function fixtureInstall() {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-auth-'));
  return createOzServer({ cocoderHome, port: DEFAULT_PORT });
}

function validHost() {
  return `127.0.0.1:${DEFAULT_PORT}`;
}

test('C-S2: POST without Bearer token returns 401', async () => {
  const { app } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: { host: validHost() }
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('C-S2: POST with wrong Bearer token returns 401', async () => {
  const { app, token } = await fixtureInstall();
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: {
      host: validHost(),
      authorization: 'Bearer wrong-token'
    }
  });
  assert.equal(response.statusCode, 401);
  assert.notEqual(token, 'wrong-token');
  await app.close();
});

test('C-S2: GET /health does not require Bearer token', async () => {
  const { app } = await fixtureInstall();
  const response = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { host: validHost() }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
  await app.close();
});

test('C-S2: oz-token file is created mode 0600', async () => {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-auth-'));
  const { app } = await createOzServer({ cocoderHome, port: DEFAULT_PORT });
  const tokenPath = ozTokenPath(cocoderHome);
  const tokenStat = await stat(tokenPath);
  assert.equal(tokenStat.mode & 0o777, 0o600);
  await app.close();
});
