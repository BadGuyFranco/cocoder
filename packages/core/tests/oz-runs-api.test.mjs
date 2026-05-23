import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createOzServer, OZ_CSRF_HEADER, ozAuditLogPath } from 'oz-daemon';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ozDaemonSrcDir = path.join(repoRoot, 'packages/oz-daemon/src');
const TMUX_DISCIPLINE_PATTERNS = [
  /tmux\s+-L/,
  /child_process.*tmux/
];
const DEFAULT_PORT = 7878;

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

async function makeInstall(options = {}) {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-runs-api-'));
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

async function writeRegistry(cocoderHome, workspace) {
  const registryPath = path.join(cocoderHome, 'local/workspaces.json');
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify({
    version: '0.1',
    workspaces: [workspace]
  }, null, 2)}\n`);
}

async function seedRunFixture(cocoderHome, workspaceId, runId) {
  const runDir = path.join(cocoderHome, 'local/workspaces', workspaceId, 'runs', runId);
  await mkdir(path.join(runDir, 'jobs'), { recursive: true });
  await writeFile(path.join(runDir, 'launch.json'), `${JSON.stringify({
    runId,
    prioritySlug: 'v0.1-foundation',
    profile: 'cocoder/profiles/default.json',
    route: 'cocoder/routes/default.json',
    socketName: 'cocoder-orchestration',
    sessions: [{ lane: 'bob', sessionName: 'bob-test', displayLabel: 'Bob' }]
  }, null, 2)}\n`);
  await writeFile(path.join(runDir, 'status.json'), `${JSON.stringify({ status: 'running' }, null, 2)}\n`);
  await writeFile(path.join(runDir, 'startup-packet.json'), '{}\n');
  return runDir;
}

test('GET /runs returns aggregated runs across registered workspaces', async () => {
  const { app, cocoderHome } = await makeInstall();
  await writeRegistry(cocoderHome, {
    id: 'sample-app',
    path: '${COCODER_HOME}/workspaces/sample-app',
    tmuxSocket: 'cocoder-sample-app'
  });
  await seedRunFixture(cocoderHome, 'sample-app', 'run-list-001');

  const response = await app.inject({
    method: 'GET',
    url: '/runs',
    headers: { host: hostHeader() }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().runs.length, 1);
  assert.equal(response.json().runs[0].runId, 'run-list-001');
  assert.equal(response.json().runs[0].workspaceId, 'sample-app');
  assert.equal(response.json().runs[0].status, 'running');
  await app.close();
});

test('GET /runs/:id/evidence returns minimum viable inspector summary', async () => {
  const { app, cocoderHome } = await makeInstall();
  const workspaceRoot = path.join(cocoderHome, 'workspaces', 'sample-app');
  await mkdir(workspaceRoot, { recursive: true });
  await writeRegistry(cocoderHome, {
    id: 'sample-app',
    path: '${COCODER_HOME}/workspaces/sample-app'
  });
  const runDir = await seedRunFixture(cocoderHome, 'sample-app', 'run-evidence-001');

  const response = await app.inject({
    method: 'GET',
    url: '/runs/run-evidence-001/evidence',
    headers: { host: hostHeader() }
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.runId, 'run-evidence-001');
  assert.equal(body.status, 'running');
  assert.equal(body.topology.laneCount, 1);
  assert.equal(body.evidencePaths.runDir, runDir);
  assert.ok(body.collectedAt);
  await app.close();
});

test('POST /runs appends audit with spawn-failed outcome when launch subprocess exits non-zero', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-runs-launch-fail-'));
  const mockBin = path.join(tmpDir, 'mock-cocoder-fail.mjs');
  await writeFile(
    mockBin,
    '#!/usr/bin/env node\nconsole.error("launch failed");\nprocess.exit(2);\n'
  );

  const { app, token, cocoderHome } = await makeInstall({
    launchExecutable: process.execPath,
    launchArgvPrefix: [mockBin]
  });
  await writeRegistry(cocoderHome, {
    id: 'sample-app',
    path: '${COCODER_HOME}/workspaces/sample-app'
  });

  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: await authHeaders(app, token),
    payload: {
      workspaceId: 'sample-app',
      profile: 'cocoder/profiles/default.json',
      route: 'cocoder/routes/default.json',
      prioritySlug: 'v0.1-foundation',
      runId: 'run-spawn-failed'
    }
  });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().outcome, 'spawn-failed');

  const auditLine = JSON.parse((await readFile(ozAuditLogPath(cocoderHome), 'utf8')).trim());
  assert.equal(auditLine.outcome, 'spawn-failed');
  assert.equal(auditLine.runId, 'run-spawn-failed');
  await app.close();
});

test('POST /runs appends audit after successful mock launch subprocess', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-runs-launch-ok-'));
  const mockBin = path.join(tmpDir, 'mock-cocoder-ok.mjs');
  await writeFile(
    mockBin,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n'
  );

  const { app, token, cocoderHome } = await makeInstall({
    launchExecutable: process.execPath,
    launchArgvPrefix: [mockBin]
  });
  await writeRegistry(cocoderHome, {
    id: 'sample-app',
    path: '${COCODER_HOME}/workspaces/sample-app',
    tmuxSocket: 'cocoder-sample-app'
  });

  const response = await app.inject({
    method: 'POST',
    url: '/runs',
    headers: await authHeaders(app, token),
    payload: {
      workspaceId: 'sample-app',
      profile: 'cocoder/profiles/default.json',
      route: 'cocoder/routes/default.json',
      prioritySlug: 'v0.1-foundation',
      runId: 'run-launched',
      outcome: 'accepted'
    }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().outcome, 'accepted');
  assert.equal(response.json().stub, false);

  const auditLine = JSON.parse((await readFile(ozAuditLogPath(cocoderHome), 'utf8')).trim());
  assert.equal(auditLine.outcome, 'accepted');
  await app.close();
});

test('DELETE /runs/:runId appends audit after successful mock stop subprocess', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-runs-stop-ok-'));
  const mockBin = path.join(tmpDir, 'mock-cocoder-stop.mjs');
  await writeFile(
    mockBin,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n'
  );

  const { app, token, cocoderHome } = await makeInstall({
    stopExecutable: process.execPath,
    stopArgvPrefix: [mockBin]
  });

  const response = await app.inject({
    method: 'DELETE',
    url: '/runs/run-stop-001',
    headers: await authHeaders(app, token),
    payload: {
      workspaceId: 'sample-app',
      runDir: path.join(cocoderHome, 'local/workspaces/sample-app/runs/run-stop-001')
    }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().outcome, 'stopped');
  assert.equal(response.json().stub, false);

  const auditLine = JSON.parse((await readFile(ozAuditLogPath(cocoderHome), 'utf8')).trim());
  assert.equal(auditLine.action, 'stop');
  assert.equal(auditLine.outcome, 'stopped');
  await app.close();
});

test('multiplexer-observer: tmux argv patterns are confined to multiplexer-observer.ts', async () => {
  const files = await listSourceFiles(ozDaemonSrcDir);
  const violations = [];
  for (const filePath of files) {
    if (path.basename(filePath) === 'multiplexer-observer.ts') continue;
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const pattern of TMUX_DISCIPLINE_PATTERNS) {
        if (pattern.test(line)) {
          violations.push(`${path.relative(repoRoot, filePath)}:${index + 1} → ${line.trim()}`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, violations.join('\n'));
});
