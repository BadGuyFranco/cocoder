import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOzServer, OZ_CSRF_HEADER } from "oz-daemon";

const DEFAULT_PORT = 7878;

async function fixtureInstall() {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), "cocoder-oz-priorities-"));
  const server = await createOzServer({ cocoderHome, port: DEFAULT_PORT });
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

const SAMPLE_PRIORITIES = `# Priorities

## Active

| Slug | Description | Status | Canon | Owner | Blocked on |
|---|---|---|---|---|---|
| [\`alpha\`](./priorities/alpha/README.md) | First active priority | Active | Expand | Bob | — |

## Draft

| Slug | Description | Status | Canon | Owner | Sequenced |
|---|---|---|---|---|---|
| [\`beta\`](./priorities/beta/README.md) | Draft item | Draft | — | Bob | Later |
`;

test("GET /workspaces/:id/priorities parses Active and Draft table rows", async () => {
  const { app, cocoderHome } = await fixtureInstall();
  const headers = await authHeaders(app);
  const workspaceRoot = path.join(cocoderHome, "workspaces", "demo");
  await mkdir(path.join(workspaceRoot, "cocoder"), { recursive: true });
  await writeFile(path.join(workspaceRoot, "cocoder/PRIORITIES.md"), SAMPLE_PRIORITIES);

  await app.inject({
    method: "POST",
    url: "/workspaces",
    headers,
    payload: {
      id: "demo",
      path: "${COCODER_HOME}/workspaces/demo"
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/workspaces/demo/priorities",
    headers: { host: hostHeader() }
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.workspaceId, "demo");
  assert.equal(body.priorities.length, 2);
  assert.deepEqual(body.priorities[0], {
    slug: "alpha",
    description: "First active priority",
    status: "Active",
    section: "Active",
    readmePath: "./priorities/alpha/README.md"
  });
  assert.equal(body.priorities[1].slug, "beta");
  assert.equal(body.priorities[1].section, "Draft");
  await app.close();
});

test("GET /workspaces/:id/priorities returns 404 when PRIORITIES.md is missing", async () => {
  const { app, cocoderHome } = await fixtureInstall();
  const headers = await authHeaders(app);
  const workspaceRoot = path.join(cocoderHome, "workspaces", "empty");
  await mkdir(workspaceRoot, { recursive: true });

  await app.inject({
    method: "POST",
    url: "/workspaces",
    headers,
    payload: {
      id: "empty",
      path: "${COCODER_HOME}/workspaces/empty"
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/workspaces/empty/priorities",
    headers: { host: hostHeader() }
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test("listWorkspacePriorities unit: ignores non-table lines under Active", async () => {
  const { listWorkspacePriorities } = await import("oz-daemon");
  const dir = await mkdtemp(path.join(os.tmpdir(), "cocoder-priorities-parser-"));
  await mkdir(path.join(dir, "cocoder"), { recursive: true });
  await writeFile(
    path.join(dir, "cocoder/PRIORITIES.md"),
    `# Priorities

## Active

*(none)*

## Draft

| Slug | Description | Status | Canon | Owner | Sequenced |
|---|---|---|---|---|---|
| [\`only-draft\`](./priorities/only-draft/README.md) | Draft only | Draft | — | Bob | Later |
`
  );
  const entries = await listWorkspacePriorities(dir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].slug, "only-draft");
});
