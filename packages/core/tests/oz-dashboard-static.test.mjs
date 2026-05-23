import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOzServer, resolveDashboardDistRoot } from 'oz-daemon';

const DEFAULT_PORT = 7878;

test('oz-dashboard static: GET / serves index.html when dist is built', async (t) => {
  const distRoot = resolveDashboardDistRoot();
  if (!distRoot) {
    t.skip('oz-dashboard dist not built; run pnpm --filter oz-dashboard build');
    return;
  }

  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-static-'));
  const { app } = await createOzServer({ cocoderHome, port: DEFAULT_PORT });

  const response = await app.inject({
    method: 'GET',
    url: '/',
    headers: { host: `127.0.0.1:${DEFAULT_PORT}`, accept: 'text/html' }
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] ?? '', /text\/html/);
  assert.match(response.body, /<div id="root"><\/div>/);
  await app.close();
});

test('oz-dashboard static: API routes still win over static (GET /workspaces JSON)', async (t) => {
  const distRoot = resolveDashboardDistRoot();
  if (!distRoot) {
    t.skip('oz-dashboard dist not built; run pnpm --filter oz-dashboard build');
    return;
  }

  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-static-api-'));
  const { app } = await createOzServer({ cocoderHome, port: DEFAULT_PORT });

  const response = await app.inject({
    method: 'GET',
    url: '/workspaces',
    headers: { host: `127.0.0.1:${DEFAULT_PORT}`, accept: 'application/json' }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { workspaces: [] });
  await app.close();
});
