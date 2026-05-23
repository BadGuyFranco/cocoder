import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  appendOzAuditRecord,
  createOzServer,
  OZ_CSRF_HEADER,
  ozAuditLogPath,
  parseOzAuditRecord
} from 'oz-daemon';

const DEFAULT_PORT = 7878;

async function makeInstall() {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-audit-'));
  const server = await createOzServer({ cocoderHome, port: DEFAULT_PORT });
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

async function readAuditLines(cocoderHome) {
  try {
    const raw = await readFile(ozAuditLogPath(cocoderHome), 'utf8');
    return raw.trim() ? raw.trim().split('\n') : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

test('C-S6: POST /runs appends one valid audit line per launch', async () => {
  const { app, token, cocoderHome } = await makeInstall();
  const before = await readAuditLines(cocoderHome);

  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: await authHeaders(app, token),
    payload: {
      workspaceId: 'sample-app',
      persona: 'bob',
      runId: 'run-test-launch',
      outcome: 'accepted',
      routing: { target: 'workspace-shared', generality: 'workspace-specific' }
    }
  });
  assert.equal(response.statusCode, 200);

  const after = await readAuditLines(cocoderHome);
  assert.equal(after.length, before.length + 1);

  const record = JSON.parse(after.at(-1));
  assert.equal(record.action, 'launch');
  assert.equal(record.workspaceId, 'sample-app');
  assert.equal(record.runId, 'run-test-launch');
  assert.equal(record.outcome, 'accepted');
  assert.equal(record.persona, 'bob');
  assert.ok(record.timestamp);
  assert.doesNotThrow(() => parseOzAuditRecord(record));
  await app.close();
});

test('C-S6: DELETE /runs/:runId appends one valid audit line per stop', async () => {
  const { app, token, cocoderHome } = await makeInstall();
  const before = await readAuditLines(cocoderHome);

  const response = await app.inject({
    method: 'DELETE',
    url: '/runs/run-test-stop',
    headers: await authHeaders(app, token),
    payload: {
      workspaceId: 'sample-app',
      persona: 'bob',
      outcome: 'stopped',
      routing: { target: 'workspace-shared', generality: 'workspace-specific' }
    }
  });
  assert.equal(response.statusCode, 200);

  const after = await readAuditLines(cocoderHome);
  assert.equal(after.length, before.length + 1);

  const record = JSON.parse(after.at(-1));
  assert.equal(record.action, 'stop');
  assert.equal(record.runId, 'run-test-stop');
  assert.equal(record.outcome, 'stopped');
  assert.doesNotThrow(() => parseOzAuditRecord(record));
  await app.close();
});

test('C-S6: appendOzAuditRecord refuses invalid record and writes nothing', async () => {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-audit-'));
  const auditPath = ozAuditLogPath(cocoderHome);
  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(auditPath, '', 'utf8');

  await assert.rejects(
    () => appendOzAuditRecord(cocoderHome, { action: 'launch' }),
    /Invalid Oz audit record/
  );

  const content = await readFile(auditPath, 'utf8');
  assert.equal(content, '');
});
