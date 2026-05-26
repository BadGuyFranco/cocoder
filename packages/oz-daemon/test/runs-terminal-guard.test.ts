import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOzServer, type OzServer } from "../src/server.js";
import { OZ_CSRF_HEADER } from "../src/csrf.js";

const PORT = 41999;
const TOKEN = "test-bearer-token";
const CSRF = "test-csrf-token";
const WORKSPACE_ID = "guard-ws";

let home: string;
let server: OzServer;

async function seedRun(runId: string, status: string): Promise<void> {
  const runDir = path.join(home, "local", "workspaces", WORKSPACE_ID, "runs", runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "launch.json"), JSON.stringify({ runId }), "utf8");
  await writeFile(path.join(runDir, "status.json"), JSON.stringify({ status }), "utf8");
}

function postRun(runId: string) {
  return server.app.inject({
    method: "POST",
    url: "/runs",
    headers: {
      host: `127.0.0.1:${PORT}`,
      authorization: `Bearer ${TOKEN}`,
      [OZ_CSRF_HEADER]: CSRF,
      "content-type": "application/json"
    },
    payload: { workspaceId: WORKSPACE_ID, runId }
  });
}

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "oz-daemon-guard-"));
  // Minimal workspace registry so resolveRunLocation can find the seeded runs.
  await mkdir(path.join(home, "local"), { recursive: true });
  await writeFile(
    path.join(home, "local", "workspaces.json"),
    JSON.stringify({ version: "0.1", workspaces: [{ id: WORKSPACE_ID, path: "${COCODER_HOME}" }] }),
    "utf8"
  );
  // No launchExecutable => stub mode; the guard must still fire before the stub path.
  server = await createOzServer({ cocoderHome: home, port: PORT, token: TOKEN, csrfToken: CSRF });
});

afterEach(async () => {
  await server.app.close();
  await rm(home, { recursive: true, force: true });
});

describe("POST /runs terminal-state command guard", () => {
  it("refuses launching new atom work against a terminal run", async () => {
    await seedRun("run-terminal-001", "complete");
    const response = await postRun("run-terminal-001");
    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error).toBe("terminal-run-locked");
    expect(body.status).toBe("complete");
  });

  it("allows launching against a non-terminal run", async () => {
    await seedRun("run-active-001", "running");
    const response = await postRun("run-active-001");
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
  });

  it("allows a fresh run whose id does not resolve to any existing run", async () => {
    const response = await postRun("run-brand-new-001");
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
  });
});
