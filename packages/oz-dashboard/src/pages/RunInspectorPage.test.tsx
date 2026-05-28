import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RunInspectorPage } from "./RunInspectorPage.js";

describe("RunInspectorPage", () => {
  it("renders minimum viable inspector fields from evidence API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/auth/session")) {
          return new Response(JSON.stringify({ bearerToken: "b", csrfToken: "c" }), { status: 200 });
        }
        if (url.includes("/runs/run-001/evidence")) {
          return new Response(
            JSON.stringify({
              runId: "run-001",
              workspaceId: "demo",
              status: "running",
              topology: {
                laneCount: 1,
                lanes: [{ lane: "bob", sessionName: "bob-1", displayLabel: "Bob" }],
                socketName: "cocoder-demo"
              },
              flags: {
                statusMismatches: [],
                blockedPicker: [],
                rootCheck: { ok: true, uniqueRoots: ["/tmp/demo"] },
                issueCount: 0
              },
              evidencePaths: {
                runDir: "/tmp/run-001",
                launchJson: "/tmp/run-001/launch.json",
                statusJson: "/tmp/run-001/status.json",
                startupPacketJson: "/tmp/run-001/startup-packet.json",
                jobsDir: "/tmp/run-001/jobs",
                servicesDir: "/tmp/run-001/services"
              },
              services: [
                {
                  packetId: "run-summary-run-001",
                  serviceId: "run-summary",
                  mode: "read-only",
                  status: "PASS",
                  paths: {
                    packetJson: "/tmp/run-001/services/run-summary-run-001/packet.json",
                    resultJson: "/tmp/run-001/services/run-summary-run-001/result.json",
                    transcriptTxt: "/tmp/run-001/services/run-summary-run-001/transcript.txt"
                  }
                }
              ],
              collectedAt: "2026-05-23T12:00:00.000Z"
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );

    render(
      <MemoryRouter initialEntries={["/runs/run-001"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunInspectorPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Run Inspector")).toBeTruthy();
      expect(screen.getByText("running")).toBeTruthy();
      expect(screen.getByText("bob-1")).toBeTruthy();
      expect(screen.getByText("run-summary")).toBeTruthy();
      expect(screen.getByText(/\/tmp\/run-001\/launch.json/)).toBeTruthy();
    });
  });
});
