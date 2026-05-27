import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOzServer, type OzServer } from "../src/server.js";

const PORT = 42001;

let home: string;
let server: OzServer;

async function seedRegistry(): Promise<void> {
  await mkdir(path.join(home, "local"), { recursive: true });
  await writeFile(
    path.join(home, "local", "workspaces.json"),
    JSON.stringify({
      version: "0.1",
      workspaces: [
        {
          id: "cocoder",
          path: "${COCODER_HOME}",
          description: "Primary: CoCoder repository"
        },
        {
          id: "scratch",
          path: "${COCODER_HOME}/cocoder/local/scratch"
        }
      ]
    }),
    "utf8"
  );
}

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "oz-daemon-workspaces-"));
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

describe("GET /workspaces", () => {
  it("returns registry descriptions when present and omits them when absent", async () => {
    const response = await server.app.inject({
      method: "GET",
      url: "/workspaces",
      headers: {
        host: `127.0.0.1:${PORT}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      workspaces: [
        {
          id: "cocoder",
          path: "${COCODER_HOME}",
          description: "Primary: CoCoder repository",
          resolvedPath: home
        },
        {
          id: "scratch",
          path: "${COCODER_HOME}/cocoder/local/scratch",
          resolvedPath: path.join(home, "cocoder/local/scratch")
        }
      ]
    });
  });
});
