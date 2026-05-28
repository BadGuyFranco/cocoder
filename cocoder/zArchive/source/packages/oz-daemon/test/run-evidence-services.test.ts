import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOzServer, type OzServer } from "../src/server.js";

const PORT = 42002;
const WORKSPACE_ID = "service-ws";

let home: string;
let server: OzServer;

async function seedRegistry(): Promise<void> {
  await mkdir(path.join(home, "local"), { recursive: true });
  await writeFile(
    path.join(home, "local", "workspaces.json"),
    JSON.stringify({ version: "0.1", workspaces: [{ id: WORKSPACE_ID, path: "${COCODER_HOME}" }] }),
    "utf8"
  );
}

async function seedRun(runId: string): Promise<string> {
  const runDir = path.join(home, "local", "workspaces", WORKSPACE_ID, "runs", runId);
  const serviceDir = path.join(runDir, "services", "run-summary-fixture");
  await mkdir(path.join(runDir, "jobs"), { recursive: true });
  await mkdir(serviceDir, { recursive: true });
  await writeFile(path.join(runDir, "launch.json"), JSON.stringify({ runId, sessions: [] }), "utf8");
  await writeFile(path.join(runDir, "status.json"), JSON.stringify({ status: "running" }), "utf8");
  await writeFile(path.join(runDir, "startup-packet.json"), "{}", "utf8");
  await writeFile(path.join(serviceDir, "packet.json"), JSON.stringify({
    serviceId: "run-summary",
    mode: "read-only"
  }), "utf8");
  await writeFile(path.join(serviceDir, "result.json"), JSON.stringify({
    status: "PASS",
    serviceId: "run-summary"
  }), "utf8");
  await writeFile(path.join(serviceDir, "transcript.txt"), "service transcript", "utf8");
  return runDir;
}

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "oz-daemon-run-evidence-services-"));
  await seedRegistry();
  server = await createOzServer({
    cocoderHome: home,
    port: PORT,
    token: "test-bearer-token",
    csrfToken: "test-csrf-token"
  });
});

afterEach(async () => {
  await server.app.close();
  await rm(home, { recursive: true, force: true });
});

describe("GET /runs/:id/evidence service artifacts", () => {
  it("surfaces orchestration service packet, result, and transcript paths", async () => {
    const runDir = await seedRun("run-services-001");
    const response = await server.app.inject({
      method: "GET",
      url: "/runs/run-services-001/evidence",
      headers: { host: `127.0.0.1:${PORT}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.evidencePaths.servicesDir).toBe(path.join(runDir, "services"));
    expect(body.services).toEqual([
      {
        packetId: "run-summary-fixture",
        serviceId: "run-summary",
        mode: "read-only",
        status: "PASS",
        paths: {
          packetJson: path.join(runDir, "services/run-summary-fixture/packet.json"),
          resultJson: path.join(runDir, "services/run-summary-fixture/result.json"),
          transcriptTxt: path.join(runDir, "services/run-summary-fixture/transcript.txt")
        }
      }
    ]);
  });
});
