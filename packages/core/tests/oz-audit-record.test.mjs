import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ozAuditRecordSchema } from 'schemas';
import {
  createOzServer,
  OZ_CSRF_HEADER,
  ozAuditLogPath
} from 'oz-daemon';

const DEFAULT_PORT = 7878;

async function makeInstall(options = {}) {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-audit-record-'));
  const server = await createOzServer({ cocoderHome, port: DEFAULT_PORT, ...options });
  return { cocoderHome, ...server };
}

function hostHeader() {
  return `127.0.0.1:${DEFAULT_PORT}`;
}

async function authHeaders(app, token) {
  const session = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { host: hostHeader() }
  });
  return {
    host: hostHeader(),
    authorization: `Bearer ${token}`,
    [OZ_CSRF_HEADER]: session.json().csrfToken,
    'content-type': 'application/json'
  };
}

test('C-S9: first POST /runs creates oz-actions.jsonl with schema-valid ADR-0005 routing fields', async () => {
  const { app, token, cocoderHome } = await makeInstall();

  await assert.rejects(() => access(ozAuditLogPath(cocoderHome)), { code: 'ENOENT' });

  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: await authHeaders(app, token),
    payload: {
      workspaceId: 'dogfood',
      persona: 'bob',
      runId: 'run-first-launch',
      outcome: 'accepted',
      routing: { target: 'cocoder-product', generality: 'generalizable' }
    }
  });
  assert.equal(response.statusCode, 200);

  const raw = await readFile(ozAuditLogPath(cocoderHome), 'utf8');
  const lines = raw.trim().split('\n');
  assert.equal(lines.length, 1);

  const record = ozAuditRecordSchema.parse(JSON.parse(lines[0]));
  assert.equal(record.action, 'launch');
  assert.equal(record.workspaceId, 'dogfood');
  assert.equal(record.runId, 'run-first-launch');
  assert.equal(record.outcome, 'accepted');
  assert.equal(record.persona, 'bob');
  assert.equal(record.routing.target, 'cocoder-product');
  assert.equal(record.routing.generality, 'generalizable');
  assert.ok(record.timestamp);
  await app.close();
});

test('C-S9: forward-only — legacy run dirs are not backfilled before first Oz launch', async () => {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-audit-record-'));
  const legacyRunDir = path.join(cocoderHome, 'local/workspaces/default/runs/run-legacy-unindexed');
  await mkdir(legacyRunDir, { recursive: true });
  await writeFile(path.join(legacyRunDir, 'startup-packet.json'), '{}\n');

  await assert.rejects(() => access(ozAuditLogPath(cocoderHome)), { code: 'ENOENT' });

  const { app, token } = await createOzServer({ cocoderHome, port: DEFAULT_PORT });
  await assert.rejects(() => access(ozAuditLogPath(cocoderHome)), { code: 'ENOENT' });

  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: await authHeaders(app, token),
    payload: {
      workspaceId: 'dogfood',
      runId: 'run-after-legacy',
      outcome: 'accepted'
    }
  });
  assert.equal(response.statusCode, 200);

  const lines = (await readFile(ozAuditLogPath(cocoderHome), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).runId, 'run-after-legacy');
  await app.close();
});

test('C-S9: POST /runs may invoke mock launch subprocess when launchExecutable is configured', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-audit-mock-'));
  const mockBin = path.join(tmpDir, 'mock-cocoder.mjs');
  await writeFile(
    mockBin,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n'
  );
  await chmod(mockBin, 0o755);

  const { app, token, cocoderHome } = await makeInstall({
    launchExecutable: process.execPath,
    launchArgvPrefix: [mockBin]
  });

  const workspaceRoot = path.join(tmpDir, 'my workspace');
  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: await authHeaders(app, token),
    payload: {
      workspaceId: 'sample-app',
      workspaceRoot,
      prioritySlug: 'v0.1-foundation',
      profile: 'cocoder/profiles/default.json',
      route: 'cocoder/routes/default.json',
      runId: 'run-mock-launch',
      outcome: 'accepted'
    }
  });
  assert.equal(response.statusCode, 200);

  const lines = (await readFile(ozAuditLogPath(cocoderHome), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).runId, 'run-mock-launch');
  await app.close();
});
