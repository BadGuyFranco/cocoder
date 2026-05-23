import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createOzServer, OZ_CSRF_HEADER, ozAuditLogPath } from "oz-daemon";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_PORT = 7878;

const SAMPLE_PRIORITIES = `# Priorities

## Active

| Slug | Description | Status | Canon | Owner | Blocked on |
|---|---|---|---|---|---|
| [\`v0.1-foundation\`](./priorities/v0.1-foundation/README.md) | Ship v0.1 | Active | Expand | Bob | — |
`;

async function makeInstall(options = {}) {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), "cocoder-oz-e2e-"));
  const server = await createOzServer({ cocoderHome, port: DEFAULT_PORT, ...options });
  return { cocoderHome, ...server };
}

function hostHeader() {
  return `127.0.0.1:${DEFAULT_PORT}`;
}

async function authHeaders(app) {
  const session = await app.inject({
    method: "GET",
    url: "/auth/session",
    headers: { host: hostHeader() }
  });
  const { bearerToken, csrfToken } = session.json();
  return {
    host: hostHeader(),
    authorization: `Bearer ${bearerToken}`,
    [OZ_CSRF_HEADER]: csrfToken
  };
}

async function seedWorkspace(cocoderHome, workspaceId) {
  const workspaceRoot = path.join(cocoderHome, "workspaces", workspaceId);
  await mkdir(path.join(workspaceRoot, "cocoder"), { recursive: true });
  await writeFile(path.join(workspaceRoot, "cocoder/PRIORITIES.md"), SAMPLE_PRIORITIES);
  return workspaceRoot;
}

async function seedRunFixture(cocoderHome, workspaceId, runId) {
  const runDir = path.join(cocoderHome, "local/workspaces", workspaceId, "runs", runId);
  await mkdir(path.join(runDir, "jobs"), { recursive: true });
  await writeFile(
    path.join(runDir, "launch.json"),
    `${JSON.stringify({
      runId,
      prioritySlug: "v0.1-foundation",
      profile: "cocoder/profiles/default.json",
      route: "cocoder/routes/default.json",
      socketName: "cocoder-orchestration",
      sessions: [{ lane: "bob", sessionName: "bob-e2e", displayLabel: "Bob" }]
    }, null, 2)}\n`
  );
  await writeFile(path.join(runDir, "status.json"), `${JSON.stringify({ status: "running" }, null, 2)}\n`);
  await writeFile(path.join(runDir, "startup-packet.json"), "{}\n");
  return runDir;
}

test("oz dashboard API sequence: register → priorities → launch → list → evidence → stop", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cocoder-oz-e2e-mocks-"));
  const launchMock = path.join(tmpDir, "mock-launch.mjs");
  const stopMock = path.join(tmpDir, "mock-stop.mjs");
  await writeFile(
    launchMock,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n'
  );
  await writeFile(
    stopMock,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n'
  );

  const { app, cocoderHome } = await makeInstall({
    launchExecutable: process.execPath,
    launchArgvPrefix: [launchMock],
    stopExecutable: process.execPath,
    stopArgvPrefix: [stopMock]
  });
  const headers = await authHeaders(app);
  const workspaceId = "dogfood";
  const workspaceRoot = await seedWorkspace(cocoderHome, workspaceId);

  const register = await app.inject({
    method: "POST",
    url: "/workspaces",
    headers,
    payload: {
      id: workspaceId,
      name: "Dogfood",
      path: "${COCODER_HOME}/workspaces/dogfood",
      tmuxSocket: "cocoder-dogfood"
    }
  });
  assert.equal(register.statusCode, 201);
  assert.equal(register.json().resolvedPath, workspaceRoot);

  const priorities = await app.inject({
    method: "GET",
    url: `/workspaces/${workspaceId}/priorities`,
    headers: { host: hostHeader() }
  });
  assert.equal(priorities.statusCode, 200);
  assert.equal(priorities.json().priorities[0].slug, "v0.1-foundation");

  const runId = "run-e2e-001";
  const launch = await app.inject({
    method: "POST",
    url: "/runs",
    headers,
    payload: {
      workspaceId,
      profile: "cocoder/profiles/default.json",
      route: "cocoder/routes/default.json",
      prioritySlug: "v0.1-foundation",
      runId
    }
  });
  assert.equal(launch.statusCode, 200);
  assert.equal(launch.json().runId, runId);

  const runDir = await seedRunFixture(cocoderHome, workspaceId, runId);

  const runs = await app.inject({
    method: "GET",
    url: "/runs",
    headers: { host: hostHeader() }
  });
  assert.equal(runs.statusCode, 200);
  assert.equal(runs.json().runs.some((entry) => entry.runId === runId), true);

  const evidence = await app.inject({
    method: "GET",
    url: `/runs/${runId}/evidence`,
    headers: { host: hostHeader() }
  });
  assert.equal(evidence.statusCode, 200);
  assert.equal(evidence.json().runId, runId);
  assert.equal(evidence.json().topology.laneCount, 1);
  assert.equal(evidence.json().evidencePaths.runDir, runDir);

  const stop = await app.inject({
    method: "DELETE",
    url: `/runs/${runId}`,
    headers,
    payload: {
      workspaceId,
      runDir
    }
  });
  assert.equal(stop.statusCode, 200);
  assert.equal(stop.json().outcome, "stopped");

  const auditLines = (await readFile(ozAuditLogPath(cocoderHome), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(auditLines.length, 2);
  assert.equal(auditLines[0].action, "launch");
  assert.equal(auditLines[1].action, "stop");
  await app.close();
});

test("oz-e2e fixture uses real CoCoder repo root for debugger evidence import", async () => {
  await access(path.join(repoRoot, "packages/core/lib/debugger.mjs"));
});
